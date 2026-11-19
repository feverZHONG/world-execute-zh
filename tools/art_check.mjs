// art_check — measure the eight three-ink silhouettes and check a replacement set against the framed-original baseline.
//
// No PNG decoder among the project's dependencies, so the measuring happens where the film already decodes images:
// a headless browser on the project's own static server. Nothing here draws a frame; it only reads pixels.
//
//   node tools/art_check.mjs              # measure assets/character, compare with docs/archive/v4/art/baseline.json
//   node tools/art_check.mjs --baseline   # (re)write that baseline from the files currently in place
//   node tools/art_check.mjs --dir <p> --json out/art.json --strict
//
// What it reports, per image: pixel size, alpha make-up (dust / soft edge / solid), the ink colours actually in the
// file, how much of the body is outside those inks, the figure's bounding box and its margins, and — against the
// baseline — how far the framing of that figure has moved. Registration onto f_bust (chin / flower / collar) cannot be
// measured from pixels; the bbox delta is only a mechanical first guess for art.js REGISTER, the eyes still decide.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ROOT, startServer } from '../export/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const ART_DIR = (arg('dir', 'assets/character') || '').replace(/\\/g, '/');
const BASE_FILE = arg('baselineFile', 'docs/archive/v4/art/baseline.json');
const JSON_OUT = arg('json', null);
const STRICT = argv.includes('--baseline') ? false : argv.includes('--strict');

const NAMES = ['f_bust', 'f_profile', 'f_reach', 'f_eye', 'boy_bust', 'man_bust', 'cat_bust', 'cat_paws'];
// targets from docs/v4/WANTED_ART.md §规格建议: busts ≥2000 px long side, close-ups ≥3000; ≥5 % clear on top/left/right
const TARGET_LONG = { f_eye: 3000, f_reach: 3000 };
const TARGET_LONG_DEFAULT = 2000;
const MARGIN_MIN = 0.05;
const INK_SEEDS = [[244, 224, 198], [220, 114, 63], [36, 26, 21]];
const INK_NAMES = ['cream', 'orange', 'black'];
// the seven levels art.js separates each family into (light -> dark); art may be drawn in 3 inks or in all 7
const LEVEL_SEEDS = [[244, 224, 198], [217, 187, 152], [240, 144, 96], [220, 114, 63], [143, 58, 30], [36, 26, 21], [20, 16, 13]];
const LEVEL_FAM = ['cream', 'cream', 'orange', 'orange', 'orange', 'black', 'black'];

const { server, url } = await startServer({ port: 5190 });
const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => null)
  ?? await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${url}/config.json`);                        // any same-origin document will do: this one is inert
  const measured = await page.evaluate(async ({ names, dir, seeds, lseeds, lfam }) => {
    const out = {};
    for (const name of names) {
      let bmp;
      try { bmp = await createImageBitmap(await (await fetch(`/${dir}/${name}.png`)).blob()); }
      catch { out[name] = { error: 'not found or not a decodable image' }; continue; }
      const w = bmp.width, h = bmp.height;
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, w, h).data, N = w * h;
      let zero = 0, dust = 0, soft = 0, solid = 0, aModal = 0;
      const aCount = new Map();
      let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
      for (let i = 0; i < N; i++) {
        const a = px[i * 4 + 3];
        if (a === 0) { zero++; continue; }
        if (a < 16) { dust++; continue; }
        if (a < 250) soft++; else { solid++; aCount.set(a, (aCount.get(a) ?? 0) + 1); }
        const x = i % w, y = (i - x) / w;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
      for (const [a, n] of aCount) if (n > (aCount.get(aModal) ?? 0)) aModal = a;
      // ink colours: mean of the solid pixels nearest each seed (same 40-unit radius art.js uses at load)
      const sum = seeds.map(() => [0, 0, 0, 0]);
      let outside = 0, solidChecked = 0;
      for (let i = 0; i < N; i += 2) {
        if (px[i * 4 + 3] < 250) continue;
        solidChecked++;
        const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
        let best = -1, bd = 40 * 40, dMin = Infinity;
        for (let k = 0; k < 3; k++) {
          const d = (r - seeds[k][0]) ** 2 + (gg - seeds[k][1]) ** 2 + (b - seeds[k][2]) ** 2;
          if (d < dMin) dMin = d;
          if (d < bd) { bd = d; best = k; }
        }
        if (dMin > 60 * 60) outside++;
        if (best >= 0) { const s = sum[best]; s[0] += r; s[1] += gg; s[2] += b; s[3]++; }
      }
      const inks = {};
      seeds.forEach((_s, k) => { const s = sum[k]; inks[['cream', 'orange', 'black'][k]] = s[3] ? [Math.round(s[0] / s[3]), Math.round(s[1] / s[3]), Math.round(s[2] / s[3])] : null; });
      // the seven levels: which of them the file actually carries, and how much of the body each covers
      const lv = lseeds.map(() => 0), famShare = { cream: 0, orange: 0, black: 0 };
      let outside7 = 0;
      for (let i = 0; i < N; i += 2) {
        if (px[i * 4 + 3] < 250) continue;
        const r = px[i * 4], g2 = px[i * 4 + 1], b2 = px[i * 4 + 2];
        let best = -1, bd = Infinity;
        for (let k = 0; k < lseeds.length; k++) {
          const d = (r - lseeds[k][0]) ** 2 + (g2 - lseeds[k][1]) ** 2 + (b2 - lseeds[k][2]) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
        if (bd > 60 * 60) { outside7++; continue; }
        if (bd > 24 * 24) continue;                       // a blend, not an ink: an anti-aliased edge is not a level
        lv[best]++; famShare[lfam[best]]++;
      }
      const total7 = lv.reduce((a, b) => a + b, 0) || 1;
      const levels = lv.map((n, k) => ({ k, fam: lfam[k], rgb: lseeds[k], share: +(n / total7 * 100).toFixed(1) })).filter((x) => x.share >= 1.5);
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
      out[name] = {
        w, h, dust, soft, solid, zero, aModal,
        dustPct: +(dust / N * 100).toFixed(3),
        outsidePct: solidChecked ? +(outside / solidChecked * 100).toFixed(2) : 0,
        inks,
        levels,
        palette: levels.length,
        outsidePct7: solidChecked ? +(outside7 / solidChecked * 100).toFixed(2) : 0,
        bbox: { x: bx0, y: by0, w: bw, h: bh },
        // framing, normalised so two drawings of the same pose at different resolutions can be compared
        frame: { cx: +((bx0 + bw / 2) / w).toFixed(4), cy: +((by0 + bh / 2) / h).toFixed(4), fw: +(bw / w).toFixed(4), fh: +(bh / h).toFixed(4) },
        margins: { top: +(by0 / h * 100).toFixed(1), bottom: +((h - by1 - 1) / h * 100).toFixed(1), left: +(bx0 / w * 100).toFixed(1), right: +((w - bx1 - 1) / w * 100).toFixed(1) },
      };
      bmp.close?.();
    }
    return out;
  }, { names: NAMES, dir: ART_DIR, seeds: INK_SEEDS, lseeds: LEVEL_SEEDS, lfam: LEVEL_FAM });

  fs.mkdirSync(path.join(ROOT, path.dirname(BASE_FILE)), { recursive: true });
  const basePath = path.join(ROOT, BASE_FILE);
  const problems = [], notes = [];
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  if (argv.includes('--baseline')) {
    fs.writeFileSync(basePath, JSON.stringify(measured, null, 1));
    console.log(`baseline written: ${BASE_FILE}  (${NAMES.length} images)`);
  }

  const base = !argv.includes('--baseline') && fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : null;
  const rows = [];
  for (const name of NAMES) {
    const m = measured[name];
    if (!m || m.error) { problems.push(`${name}: ${m?.error ?? 'not measured'}`); rows.push([name, '—', '—', '缺图或损坏']); continue; }
    const long = Math.max(m.w, m.h), target = TARGET_LONG[name] ?? TARGET_LONG_DEFAULT;
    const ideas = [];
    if (long < target) notes.push(`${name}: 长边 ${long} px < 目标 ${target} px（重画时按目标给）`);
    if (m.dustPct > 0.2) notes.push(`${name}: alpha<16 的残点 ${m.dustPct}%（应清成 0）`);
    if (m.aModal < 255) notes.push(`${name}: 主体 alpha 众数 ${m.aModal}（理想 255）`);
    if ((m.outsidePct7 ?? m.outsidePct) > 1) notes.push(`${name}: ${m.outsidePct7 ?? m.outsidePct}% 的实体像素不在三墨 / 七阶范围内（渐变 / 第四色 / 锈色）`);
    const side = Math.min(m.margins.top, m.margins.left, m.margins.right);
    if (side < MARGIN_MIN * 100) notes.push(`${name}: 上/左/右最小留白 ${side}% < 5%（会被迫贴边使用）`);
    if (base?.[name]?.frame) {
      const b = base[name].frame, dc = Math.hypot(m.frame.cx - b.cx, m.frame.cy - b.cy) * Math.max(m.w, m.h);
      const ds = Math.max(Math.abs(m.frame.fw / b.fw - 1), Math.abs(m.frame.fh / b.fh - 1));
      ideas.push(`相对原图：位移约 ${Math.round(dc)} px（源分辨率），尺度 ${(1 + ds).toFixed(3)} 倍`);
      if (dc > 0.05 * Math.max(m.w, m.h) || ds > 0.05) problems.push(`${name}: 构图相对原图移动过大（位移 ${Math.round(dc)} px / 尺度差 ${pct(ds)}），配准要重测`);
    }
    rows.push([name, `${m.w}x${m.h}`, `${m.palette ?? 3} 阶 / dust ${m.dustPct}% / a=${m.aModal}`, `留白 上${m.margins.top} 左${m.margins.left} 右${m.margins.right}%`, ideas[0] ?? '']);
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${ART_DIR}  (${NAMES.length} 张)`);
  console.log([pad('图', 11), pad('尺寸', 12), pad('alpha', 26), pad('留白', 26), '配准'].join(''));
  for (const r of rows) console.log(r.map((s, i) => pad(s, [11, 12, 26, 26, 0][i])).join(''));
  if (notes.length) { console.log('\n规格提醒（不挡出片，重画时照做）:'); notes.forEach((n) => console.log('  - ' + n)); }
  if (problems.length) { console.log('\n必须处理:'); problems.forEach((n) => console.log('  - ' + n)); }
  console.log(problems.length ? `\n结果: ${problems.length} 项必须处理` : '\n结果: 通过');

  if (JSON_OUT) { fs.writeFileSync(path.join(ROOT, JSON_OUT), JSON.stringify(measured, null, 1)); console.log(`json: ${JSON_OUT}`); }
  if ((STRICT && notes.length) || problems.length) process.exitCode = 1;
} finally {
  await browser.close?.();
  server.close();
}
