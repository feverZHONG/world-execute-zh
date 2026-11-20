// Offline exporter: headless Chrome (GPU) renders frame by frame, raw RGBA frames are
// streamed straight into ffmpeg's stdin (no image files on disk), audio is muxed from the wav.
//
//   video:  node export/export.mjs [--start s] [--end s] [--width w] [--height h] [--fps n]
//                                  [--out file.mp4] [--codec auto|h264_nvenc|libx264] [--cq n] [--headed]
//                                  [--frame raw|png|jpeg|h264] [--q 0.95] [--ffmpeg path\to\ffmpeg.exe]
//           --frame says how a frame travels: raw RGBA (lossless, 8.3 MB), a packed png/jpeg image, or an H.264
//           bitstream encoded in the page by the GPU (avc1.4d0028, Annex B) which ffmpeg only remuxes.
//           Times are SONG time (audio start = 0). The film itself starts at -safety.preroll (config.json) with a
//           silent warning page, and that is where an export starts unless --start says otherwise; the audio is
//           then delayed by the same amount. The file records the song time of its first frame (mv_start=... in the
//           `comment` tag) so that tools/check_sync.py and tools/check_flash.py can report song times.
//   QA contact sheet (one PNG of stills, for checking shots without exporting a video):
//           node export/export.mjs --sheet out/qa.png --times 12.5,13,13.5 [--cols 4] [--width 960 --height 540]
//           node export/export.mjs --sheet out/qa.png --from 29.4 --to 44.6 --step 0.923
//   check cards (src/scenes/lab.js) instead of the film: add --lab <set>, e.g. --lab inks --times 0,1,2
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { ROOT, startServer } from './server.mjs';
import { frameSocketHandler } from './wsframes.mjs';
import { ensureLyrics } from '../tools/fill_lyrics.mjs';

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const features = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.paths.features), 'utf8'));
// the lyric lines come from your own lyric file (the repository has none); stop here, before any output is touched, if they cannot be had
try { ensureLyrics({ quiet: true }); } catch (e) { console.error(e.message); process.exit(1); }

// ---- arguments -------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const SHEET = arg('sheet', null);
const LAB = arg('lab', null);                         // --lab <set>: the check cards of src/scenes/lab.js, one per second from t = 0
const ARTSVG = arg('artsvg', '');                     // --artsvg <dir>: take the silhouettes from that folder as SVG (raster_to_svg.mjs removed 2026-11-20; kept for a vector delivery from the artist)
const ARTDIR = arg('art', '');                        // --art <dir>: use another silhouette folder (test plates, without touching assets/character)
const PAL = arg('pal', '');                           // --pal <file>: override palette roles per state (out/_pal/*.json)
const W = +arg('width', SHEET ? 960 : cfg.video.width), H = +arg('height', SHEET ? 540 : cfg.video.height), FPS = +arg('fps', cfg.video.fps);
const PRE = cfg.safety?.preroll ?? 0;                 // seconds of film before the song
const START = Math.max(-PRE, +arg('start', LAB ? 0 : -PRE)), END = Math.min(+arg('end', features.meta.duration), features.meta.duration);
const OUT = path.resolve(ROOT, SHEET || arg('out', `out/export_${W}x${H}_${FPS}.mp4`));
// --frame raw|png|jpeg: how one frame travels from the page to ffmpeg. Raw RGBA is lossless but 8.3 MB per frame at
// 1080p, and the socket tops out near 90 MB/s (8.8 fps, transport-bound); a packed image is ~20x smaller.
const FRAME = arg('frame', 'raw');
const FRAME_Q = arg('q', '0.95');
const BPP = arg('bpp', null);                           // h264 only: bits-per-pixel-second knob; raise it to verify how much the film loses
const bppQuery = BPP ? `&bpp=${encodeURIComponent(BPP)}` : '';
const firstFrame = Math.round(START * FPS), lastFrame = Math.round(END * FPS);   // [first, last)
if (W % 2 || H % 2) throw new Error('width/height must be even for yuv420p');

let times = null;                                    // sheet mode: explicit list of timestamps
if (SHEET) {
  if (arg('times')) times = arg('times').split(',').map(Number);
  else { times = []; for (let t = +arg('from', 0); t <= +arg('to', 10) + 1e-6; t += +arg('step', 1)) times.push(+t.toFixed(4)); }
}
const total = SHEET ? times.length : lastFrame - firstFrame;

// ---- ffmpeg ----------------------------------------------------------------------
function findFfmpeg() {
  const want = arg('ffmpeg', process.env.FFMPEG || cfg.export.ffmpeg || '');
  if (want && fs.existsSync(want)) return want;                                 // explicit build wins (nvenc needs a recent one)
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';          // system ffmpeg wins
  const p = createRequire(import.meta.url)('ffmpeg-static');
  if (p && fs.existsSync(p)) return p;
  throw new Error('ffmpeg not found. Install it, or run: node node_modules/ffmpeg-static/install.js');
}
const FFMPEG = findFfmpeg();

function pickCodec() {
  const want = arg('codec', cfg.export.codec);
  if (want !== 'auto' && want !== 'h264_nvenc') return want;
  // Real probe: encode a few frames at the target size. Fails if driver/GPU/resolution is unsupported.
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=${FPS}`,
    '-frames:v', '5', '-c:v', 'h264_nvenc', '-f', 'null', '-']);
  if (r.status === 0) return 'h264_nvenc';
  console.warn('[export] h264_nvenc unavailable -> falling back to libx264');
  return 'libx264';
}

/** --cq N overrides the quality value of the configured encoder args (smaller files for previews). */
function quality(list, flag) {
  const q = arg('cq', null), out = [...list], i = out.indexOf(flag);
  if (q != null && i >= 0) out[i + 1] = String(q);
  return out;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const rawIn = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`];
let ffArgs, CODEC = 'png';
if (SHEET) {
  const cols = +arg('cols', 4), rows = Math.ceil(total / cols);
  ffArgs = [...rawIn, '-framerate', '1', '-i', 'pipe:0', '-vf', `tile=${cols}x${rows}:padding=6:color=0x303030`, '-frames:v', '1', OUT];
} else {
  CODEC = FRAME === 'h264' ? 'copy' : pickCodec();
  // input: raw RGBA frames, a stream of packed images (ffmpeg decodes them before our filters), or an Annex B
  // H.264 bitstream encoded in the page (nothing to decode - it is copied straight into the container)
  const frameIn = FRAME === 'raw'
    ? [...rawIn, '-framerate', String(FPS)]
    : FRAME === 'h264'
      ? ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'h264', '-framerate', String(FPS)]
      : ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', FRAME === 'png' ? 'png' : 'mjpeg'];
  // audio: the song from max(0, start); if the export starts before the song, it is delayed by that lead (in samples: exact)
  // --mute writes a silent track of exactly the video's length instead. Segmented 4K rendering uses it: a slice that
  // starts inside the 5 s preroll would ask for a negative audio length (ffmpeg: "Value -3.000000 for parameter
  // 'durationi' out of range"), and the segments get one continuous audio track at concat time anyway.
  const MUTE = argv.includes('--mute');
  const lead = Math.max(0, -firstFrame / FPS), aStart = Math.max(0, firstFrame / FPS);
  const VIDEO_OUT = CODEC === 'copy'
    ? ['-c:v', 'copy']                                   // already encoded (and already yuv420p) in the page
    : ['-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuv420p',
       '-c:v', CODEC, ...(CODEC === 'h264_nvenc' ? quality(cfg.export.nvenc, '-cq') : quality(cfg.export.x264, '-crf'))];
  ffArgs = [
    ...frameIn, '-thread_queue_size', '64', '-i', 'pipe:0',
    ...(MUTE
      ? ['-f', 'lavfi', '-t', String(total / FPS), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']
      : ['-ss', String(aStart), '-t', String(total / FPS - lead), '-i', path.join(ROOT, cfg.paths.audio)]),
    '-map', '0:v', '-map', '1:a',
    // adelay takes one value per channel; the `all` option does not exist in older ffmpeg builds (this machine's 4.2)
    ...(lead > 0 && !MUTE ? ['-af', `adelay=${Array(Math.max(2, features.meta.channels ?? 2)).fill(Math.round(lead * features.meta.sampleRate) + 'S').join('|')}`] : []),
    '-metadata', `comment=mv_start=${(firstFrame / FPS).toFixed(6)}`,
    ...VIDEO_OUT,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    // `-shortest` would trim the last frames when the AAC track is a hair shorter than the video (copy mode), so
    // only the re-encode paths use it; the audio is already bounded by its own -t
    ...(CODEC === 'copy' || MUTE ? [] : ['-shortest']),
    ...cfg.export.audio, '-movflags', '+faststart', OUT,
  ];
}
const ff = spawn(FFMPEG, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise((res, rej) => ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
ff.stdin.on('error', (e) => { console.error('[ffmpeg stdin]', e.message); });

// ---- frame sink: page -> WebSocket -> ffmpeg stdin (frames never touch the disk) ---
// --frames <dir> is the exception, used only for quality checks: it writes each frame as delivered (png/jpeg bytes)
let received = 0, failed = null;
const DUMP = arg('frames', null), dumpDir = DUMP ? path.resolve(ROOT, DUMP) : null;
let dumpN = 0;
if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true });
const onUpgrade = frameSocketHandler({
  frameBytes: FRAME === 'raw' ? W * H * 4 : 0,          // 0 = packed frames: variable message size
  // resolve only once ffmpeg has taken the frame; the page waits for that before sending the next
  onFrame: (frame) => new Promise((res, rej) => {
    if (dumpDir) fs.writeFileSync(path.join(dumpDir, `f${String(dumpN++).padStart(3, '0')}.${FRAME === 'png' ? 'png' : 'jpg'}`), frame);
    ff.stdin.write(frame, (e) => (e ? rej(e) : (received++, res())));
  }),
  onError: (e) => { failed = e; },
});

// ---- browser ---------------------------------------------------------------------
const { server, url } = await startServer({ port: 5180, onUpgrade });
const gpuArgs = ['--ignore-gpu-blocklist', '--enable-gpu',
  ...(process.platform === 'linux' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--force_high_performance_gpu']),
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
let browser;
const EXEC = process.env.CHROME_PATH || '';                 // 本机无系统 Chrome：指向 chrome-headless-shell
for (const channel of (EXEC ? [undefined] : [cfg.export.browserChannel, 'chrome', 'msedge', undefined])) {
  try { browser = await chromium.launch({ channel, executablePath: EXEC || undefined, headless: !argv.includes('--headed'), args: gpuArgs }); break; } catch { /* try next */ }
}
if (!browser) throw new Error('No Chrome/Edge found for Playwright (set export.browserChannel in config.json or CHROME_PATH)');

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { failed = e; console.error('[page error]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto(`${url}/?mode=export&w=${W}&h=${H}&frame=${FRAME}&q=${FRAME_Q}${LAB ? `&lab=${encodeURIComponent(LAB)}` : ''}${ARTSVG ? `&artsvg=${encodeURIComponent(ARTSVG)}` : ''}${ARTDIR ? `&art=${encodeURIComponent(ARTDIR)}` : ''}${PAL ? `&pal=${encodeURIComponent(PAL)}` : ''}${bppQuery}`);
  await page.waitForFunction(() => window.__mv && window.__mv.ready, null, { timeout: 60000 });
  const renderer = await page.evaluate(() => window.__mv.renderer);
  if (/swiftshader|llvmpipe|basic render/i.test(renderer)) console.warn('[export] WARNING: software WebGL - GPU not in use');

  if (SHEET) {
    await page.evaluate((ts) => window.__mv.exportTimes(ts), times);
    if (failed) throw failed;
  } else {
    console.log(`[export] ${W}x${H} @ ${FPS}fps  frames ${firstFrame}..${lastFrame - 1} (${total})  song time ${(firstFrame / FPS).toFixed(3)}..${(lastFrame / FPS).toFixed(3)} s  codec=${CODEC}`);
    console.log(`[export] renderer: ${renderer}`);
    const t0 = Date.now(), chunk = cfg.export.chunkFrames;   // (wall clock is used for the progress display only)
    for (let a = firstFrame; a < lastFrame; a += chunk) {
      const b = Math.min(lastFrame, a + chunk);
      const ms = await page.evaluate(([x, y, fps]) => window.__mv.exportRange(x, y, fps), [a, b, FPS]);
      if (failed) throw failed;
      const done = b - firstFrame, rate = done / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r[export] ${done}/${total} frames  ${rate.toFixed(1)} fps  eta ${Math.ceil((total - done) / rate)}s  ` +
        `(ms/frame: render ${ms.render} read ${ms.read} send ${ms.send})   `);
    }
    process.stdout.write('\n');
    if (FRAME === 'h264') {
      const fin = await page.evaluate(() => window.__mv.finishExport());
      if (fin.chunks !== total) throw new Error(`h264: the page emitted ${fin.chunks} chunks for ${total} frames - frames were dropped`);
      console.log(`[export] h264: ${fin.chunks} chunks, one per frame`);
    }
  }
} finally {
  ff.stdin.end();
  await browser.close();
  server.close();
}
await ffDone;
console.log(`[export] wrote ${path.relative(ROOT, OUT)}  (${received} frames, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
