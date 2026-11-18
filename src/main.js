// Page entry. One page, two modes sharing the same engine:
//   preview (default): real-time, t comes from the <audio> clock (or the seek bar when paused). t is SONG time: the film
//                      starts at -safety.preroll with a silent warning page, so the seek bar starts there too
//   export (?mode=export&w=..&h=..): no UI; Node drives window.__mv frame by frame
import { createEngine, loadSteps } from './engine/engine.js';
import { timecode } from './engine/util.js';

const qs = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const urlOf = (p) => '/' + p.split('/').map(encodeURIComponent).join('/');
const getJson = async (p) => {
  const r = await fetch(urlOf(p));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
};
const isExport = qs.get('mode') === 'export';

// ---- loading (preview only): a bar over the picture, one step per file, font and silhouette ------------------------
const boot = (() => {
  if (isExport) return { expect() {}, step() {}, fail() {}, done() {} };
  let total = 1, n = 0;
  return {
    expect(k) { total += k; },
    /** One more thing is loaded. Resolves once the page had the chance to repaint, so the bar is seen to move. */
    step(label) {
      n++;
      $('loadFill').style.width = `${(100 * n / total).toFixed(1)}%`;
      $('loadText').textContent = `${String(n).padStart(2, ' ')} / ${total}   ${label}`;
      if (document.visibilityState !== 'visible') return undefined;         // nobody is looking: nothing to wait for
      return new Promise((res) => { const id = setTimeout(res, 80); requestAnimationFrame(() => { clearTimeout(id); res(); }); });
    },
    fail(e) { $('loading').classList.add('failed'); $('loadText').textContent = `could not start: ${e.message}`; },
    done() { $('loading').hidden = true; },
  };
})();

let cfg, engine, width, height;
try {
  cfg = await getJson('config.json');
  // ?artsvg=<dir> takes the silhouettes from that folder as SVG instead of paths.art (未填则照旧用 PNG)
  if (qs.get('artsvg')) cfg.paths.artSvg = qs.get('artsvg');
  // ?art=<dir> 换一套剪影目录（试验新图时用，不动 assets/character）
  if (qs.get('art')) cfg.paths.art = qs.get('art');
  // ?pal=<file> 覆盖配色：文件形如 { "on": { "me": "#3e93ae", ... }, "warm": { ... } }，按状态逐项覆盖
  if (qs.get('pal')) {
    const ov = await getJson(qs.get('pal'));
    for (const [state, roles] of Object.entries(ov)) {
      if (state.startsWith('_') || !cfg.palettes[state]) continue;
      Object.assign(cfg.palettes[state], roles);
    }
  }
  boot.expect(2 + loadSteps(cfg));
  boot.step('config.json');
  const [featuresData, lyricsData] = await Promise.all([
    getJson(cfg.paths.features).then((d) => (boot.step('audio features'), d)),
    getJson(cfg.paths.lyrics).then((d) => (boot.step('lyric lines'), d)),
  ]);
  width = +qs.get('w') || cfg.video.previewWidth;
  height = +qs.get('h') || cfg.video.previewHeight;
  // ?lab=<set> renders the check cards of src/scenes/lab.js instead of the film (node export/export.mjs --lab <set> --sheet ...)
  engine = await createEngine({ canvas: $('view'), width, height, cfg, featuresData, lyricsData,
    // h264 mode encodes H.264 straight off the canvas, so the drawing buffer must keep its natural top-down
    // orientation; every other export mode reads pixels back and wants the flipped buffer instead
    flipY: isExport && (qs.get('frame') || 'raw') !== 'h264', lab: qs.get('lab'), onStep: isExport ? null : boot.step });
} catch (e) { boot.fail(e); throw e; }

if (isExport) setupExport(); else setupPreview();

// ---------------------------------------------------------------------------------
function setupExport() {
  document.body.classList.add('export');
  const buf = new Uint8Array(width * height * 4);
  // One WebSocket carries all frames; the Node side acks each frame once ffmpeg has consumed it.
  const ws = new WebSocket(`ws://${location.host}/__frames`);
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('frame socket failed')); });
  const send = (data) => new Promise((res, rej) => {
    ws.onmessage = res;
    ws.onclose = () => rej(new Error('frame socket closed'));
    ws.send(data);
  });
  // Frame transport. Raw RGBA is 8.3 MB per frame at 1080p and the socket tops out near 90 MB/s, so the film was
  // transport-bound (8.8 fps). Two ways out: pack the frame as an image (`png`/`jpeg`, ~20x smaller), or encode
  // H.264 in the page on the GPU and send the bitstream (~500x smaller) - ffmpeg then only remuxes (`-c copy`).
  const pack = qs.get('frame') || 'raw';                 // raw | png | jpeg | h264
  const Q = +(qs.get('q') || 0.95);                       // jpeg quality only
  const c2 = (pack === 'png' || pack === 'jpeg') ? new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true }) : null;
  const img = c2 ? c2.createImageData(width, height) : null;
  const packFrame = async () => {
    if (pack === 'raw') return buf;
    img.data.set(buf);                                   // readPixels gave top-down rows (flipY = export)
    c2.putImageData(img, 0, 0);
    const blob = await c2.canvas.convertToBlob({ type: pack === 'png' ? 'image/png' : 'image/jpeg', quality: Q });
    return new Uint8Array(await blob.arrayBuffer());
  };

  // ---- h264: the encoder runs in the page, only the bitstream leaves the browser -------------------------
  // The exporter calls exportRange once per 60-frame chunk, so the encoder lives across all of them: rebuilding
  // it per chunk would restart the stream (and a fresh encoder left the drain loop dead between chunks).
  const GOP = 60;                                        // one keyframe per second: seekable, and segments stay concatenable
  let enc = null, encQueue = [], encDone = false, encFail = null, encWaiters = [], encCount = 0, encT = 0, drainP = null;
  const wake = () => { const w = encWaiters.splice(0); for (const f of w) f(); };
  const waitQueue = () => new Promise((r) => encWaiters.push(r));
  function startEncoder(fps) {
    encCount = 0; encT = 0; encQueue.length = 0; encDone = false; encFail = null;
    enc = new VideoEncoder({
      output: (ch) => { encCount += 1; const b = new Uint8Array(ch.byteLength); ch.copyTo(b); encQueue.push(b); wake(); },
      error: (e) => { encFail = e; wake(); },
    });
    enc.configure({
      codec: 'avc1.4d0028', width, height,
      bitrate: Math.round(Math.max(8e6, width * height * fps * 0.2)),   // ~0.2 bit per pixel-second, hardware VBR settles lower on flat art
      framerate: fps, hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality',
      avc: { format: 'annexb' },                          // ffmpeg's raw h264 demuxer wants Annex B, not AVCC
    });
    drainP = drainEncoder();
  }
  async function drainEncoder() {
    while (!encDone || encQueue.length) {
      if (encFail) throw encFail;
      if (!encQueue.length) { await waitQueue(); continue; }
      const b = encQueue.shift(); wake();
      await send(b);
    }
  }
  // WebCodecs drops input frames once its own queue grows, so the producer must wait on encodeQueueSize too,
  // not only on the output queue. The timeout keeps a stalled encoder from hanging the export.
  const breathe = () => Promise.race([waitQueue(), new Promise((r) => setTimeout(r, 20))]);
  window.__mv = {
    ready: true,
    duration: engine.duration,
    renderer: engine.rendererInfo(),
    /** Render stills at arbitrary times (QA contact sheets). */
    async exportTimes(times) {
      await opened;
      for (const t of times) { engine.renderFrame(t); engine.readPixels(buf); await send(buf); }
      return times.length;
    },
    /** Render frames [from, to) at `fps` and send each one (raw RGBA, a packed image, or an H.264 bitstream) in order. */
    async exportRange(from, to, fps) {
      await opened;
      if (pack === 'h264') return exportRangeH264(from, to, fps);
      const ms = { render: 0, read: 0, send: 0 };       // profiling only; never affects the frames
      for (let i = from; i < to; i++) {
        const a = performance.now();
        engine.renderFrame(i / fps);
        const b = performance.now();
        engine.readPixels(buf);
        const c = performance.now();
        await send(await packFrame());
        ms.render += b - a; ms.read += c - b; ms.send += performance.now() - c;
      }
      for (const k in ms) ms[k] = +(ms[k] / (to - from)).toFixed(1);
      return ms;
    },
    /** h264 only: flush the page encoder after the last chunk (no-op otherwise). */
    finishExport: () => (pack === 'h264' ? finishExportH264() : Promise.resolve({ chunks: 0 })),
  };

  /** h264: encode off the canvas (no readPixels, no image packing), stream the bitstream, keep a small queue in flight. */
  async function exportRangeH264(from, to, fps) {
    if (typeof VideoEncoder === 'undefined') throw new Error('VideoEncoder is not available in this browser');
    if (!enc) startEncoder(fps);
    if (encFail) throw encFail;
    const ms = { render: 0, read: 0, send: 0, chunks: 0 };
    const dur = Math.round(1e6 / fps);
    for (let i = from; i < to; i++) {
      const a = performance.now();
      engine.renderFrame(i / fps);
      const b = performance.now();
      const frame = new VideoFrame($('view'), { timestamp: Math.round(encT++ * 1e6 / fps), duration: dur });
      const c = performance.now();
      enc.encode(frame, { keyFrame: (i - from) % GOP === 0 });
      frame.close();
      while (enc.encodeQueueSize > 4 || encQueue.length > 3) await breathe();
      ms.render += b - a; ms.read += c - b; ms.send += performance.now() - c;
    }
    ms.chunks = encCount;                                // cumulative chunks emitted so far
    for (const k of ['render', 'read', 'send']) ms[k] = +(ms[k] / (to - from)).toFixed(1);
    return ms;
  }
  /** Flush the page-side encoder once the last chunk has been rendered. Chunks must equal frames, or frames were dropped. */
  async function finishExportH264() {
    if (!enc) return { chunks: 0 };
    await enc.flush();
    encDone = true; wake();
    await drainP;
    if (encFail) throw encFail;
    enc.close();
    return { chunks: encCount };
  }
}

// ---------------------------------------------------------------------------------
function setupPreview() {
  const audio = $('audio'), seek = $('seek'), playBtn = $('play');
  const PRE = engine.preroll, D = engine.duration;      // the film runs from song time -PRE (silent warning page) to D
  audio.src = urlOf(cfg.paths.audio);
  seek.min = (-PRE).toFixed(3); seek.max = D.toFixed(3);

  const lim = (v) => Math.max(-PRE, Math.min(D, v));
  let t = lim(qs.has('t') ? +qs.get('t') || 0 : -PRE);   // current time while paused
  let lastDrawn = NaN, perf = 0, shown = '';
  // Two clocks (preview transport only: a frame still depends on t alone). While the song sounds, the <audio> element
  // is the clock. Before the song there is no audio clock, and there is none either when the sound cannot be had (no
  // file, the browser will not start it, nothing to play it on): then the preview runs on the wall clock, silently.
  //   wall = { t0, at }       running on the wall clock: song time t0 at performance.now() === at
  //   mute = { why, retry }   the sound is not used, and why; retry = try it again at the next press of play
  //   heard = { t, at }       the last time the audio clock was seen to move
  let wall = null, mute = null, heard = { t: -1, at: 0 };
  audio.currentTime = Math.max(0, t);

  const playing = () => wall !== null || (!audio.paused && !audio.ended);
  const now = () => (wall ? Math.min(mute ? D : 0, wall.t0 + (performance.now() - wall.at) / 1000) : !audio.paused && !audio.ended ? audio.currentTime : t);
  const label = () => { playBtn.textContent = playing() ? 'pause' : 'play'; };
  /** Start the sound at t (>= 0). If it will not start, the picture goes on without it rather than stand still. */
  const start = () => {
    heard = { t: -1, at: performance.now() };
    if (Math.abs(audio.currentTime - t) > 0.02) audio.currentTime = t;      // (the wall clock has run on without it)
    audio.play().catch((e) => {
      if (e.name === 'AbortError' || !audio.paused) return;                 // overtaken by a pause or a seek of ours
      mute = { why: e.name === 'NotAllowedError' ? 'the browser did not let the sound start: press pause, then play' : `no sound (${e.name})`, retry: true };
      wall = { t0: t, at: performance.now() }; label();
    });
  };
  /** Always reached from a click or a key: whatever only the user may start has to be started in here. */
  const play = () => {
    if (mute?.retry) mute = null;
    if (t >= D - 0.05) { t = 0; audio.currentTime = 0; }                    // at the end: once more, from the song
    if (mute) wall = { t0: t, at: performance.now() };
    else if (t < 0) {
      wall = { t0: t, at: performance.now() };
      // The song starts by itself when the page before it is over, and that is no longer inside this click. A browser
      // that lets only the user start sound must have seen this element started by the user once: started here and
      // stopped at once (no sound), it may be started later.
      audio.play().catch(() => {}); audio.pause();
    } else start();
    label();
  };
  const pause = () => { t = now(); wall = null; if (!audio.paused) audio.pause(); label(); };
  const setT = (v) => { const was = playing(); pause(); t = lim(v); audio.currentTime = Math.max(0, t); if (was) play(); };

  playBtn.onclick = () => (playing() ? pause() : play());
  audio.onplay = audio.onpause = () => { if (!wall && audio.paused && !audio.ended) t = audio.currentTime; label(); };
  audio.onended = () => { t = D; label(); };
  audio.onerror = () => {                                 // no file, or one the browser cannot play: the picture alone
    const was = playing();
    pause();
    mute = { why: `no sound: "${cfg.paths.audio}" is missing or cannot be played here`, retry: false };
    if (was) play();
  };
  seek.oninput = () => setT(+seek.value);
  seek.onchange = () => seek.blur();                      // after a drag the keys below are the page's again, not the slider's
  window.addEventListener('keydown', (e) => {
    const dir = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
    if (e.code === 'Space') { e.preventDefault(); playBtn.blur(); playBtn.click(); }    // (a focused button would click a second time)
    else if (dir) { e.preventDefault(); setT(now() + dir * (e.shiftKey ? 5 : 1)); }
    else if (e.key === ',') { pause(); setT(t - 1 / 60); }
    else if (e.key === '.') { pause(); setT(t + 1 / 60); }
  });

  const sound = () => (mute ? mute.why
    : audio.readyState < 2 ? 'loading…'
    : !audio.paused && !audio.ended && audio.readyState < 3 ? 'buffering…'
    : `${wall ? 'starts when the page before the song is over' : !audio.paused && !audio.ended ? 'playing' : 'ready'}   ${timecode(audio.duration)}`);

  function draw(now) {
    const t0 = performance.now();
    engine.renderFrame(now);
    perf = perf * 0.9 + (performance.now() - t0) * 0.1;
    const f = engine.features.sample(now - cfg.timing.offset), ly = engine.lyrics.state(now - cfg.timing.offset);
    if (document.activeElement !== seek) seek.value = now;
    $('clock').textContent = `${timecode(now)} / ${timecode(D)}`;
    $('iT').textContent = `${now.toFixed(3)} / ${Math.round(now * 60)}   (film ${timecode(now + PRE)})`;
    $('iLine').textContent = ly.index < 0 ? '-' : `${ly.index + 1} / ${engine.lyrics.lines.length}${ly.active ? '' : ' (ended)'}  "${ly.line.text}"`;
    $('iBeat').textContent = now < 0 ? 'before the song' : `beat ${f.beat} (${f.beatInBar + 1}/4)   bar ${f.bar}   ${engine.features.bpm} BPM`;
    const shot = engine.shotAt(now - cfg.timing.offset);
    $('iScene').textContent = shot ? `${engine.activeScenes(now - cfg.timing.offset).join(' → ')}   [${shot.state}]` : '-';
    $('iMoment').textContent = shot?.moment || '-';
    $('iPerf').textContent = `${perf.toFixed(1)} ms/frame @ ${width}x${height}   GPU: ${engine.rendererInfo()}`;
  }

  // requestAnimationFrame is only a repaint trigger; the frame content depends on t alone.
  function tick() {
    let n = now();
    if (wall && !mute && n >= 0) {                        // the page is over: the song starts
      wall = null; t = 0; n = 0;
      if (audio.currentTime !== 0) audio.currentTime = 0;
      start(); label();
    } else if (wall && n >= D) { wall = null; t = D; label(); }
    if (!wall && !audio.paused && !audio.ended) {         // the audio clock has to be seen to move
      const c = audio.currentTime, w = performance.now(), waiting = audio.seeking || audio.readyState < 3;
      if (c !== heard.t) heard = { t: c, at: w };
      else if (w - heard.at > (waiting ? 4000 : 2500)) {  // it stands still: go on without it rather than freeze
        t = c; audio.pause();
        mute = { why: `the sound ${waiting ? 'does not load' : 'does not advance (no output device?)'}: playing without it; pause, then play, tries again`, retry: true };
        wall = { t0: t, at: w }; label();
      }
    }
    if (n !== lastDrawn) { draw(n); lastDrawn = n; }
    const s = sound();
    if (s !== shown) { $('iAudio').textContent = shown = s; $('iAudio').classList.toggle('warn', !!mute); }
    requestAnimationFrame(tick);
  }
  tick();
  playBtn.disabled = false;
  boot.done();
  window.__preview = { engine, setT };   // handy for debugging from the console
}
