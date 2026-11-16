// art_dims — 量一遍「剪影进管线时的真实源尺寸」：源 W×H、设计基准（REF）、换算系数、长宽比偏差，
// 顺带把 loadArt 自己的告警（gold viewBox 缺 width/height、长宽比不对、分辨率不够）原样打出来。
//
//   node tools/art_dims.mjs                       # 当前 config 的 PNG 一套
//   node tools/art_dims.mjs --svg assets/character_svg    # 同一套的矢量版（缺的自动回落 PNG）
//
// 判读：sx/sy 就是「设计单位 → 源像素」的系数。八张 PNG 全是 1.000 说明还没换图；换了大图之后这里应当 >1，
// 且 sx 与 sy 相等（不等=长宽比被改了，片子里每一处裁切都会被拉扁）。aspx 一列偏离 0 超过 2% 即告警。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, startServer } from '../export/server.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SVG = (arg('svg', '') || '').replace(/\\/g, '/');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

const { server, url } = await startServer({ port: 5192 });
const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => chromium.launch({ headless: true }));
try {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto(`${url}/tools/probe.html`);
  const rows = await page.evaluate(async ({ paths }) => {
    const { loadArt } = await import('/src/engine/art.js');
    const art = await loadArt({ paths });
    return Object.entries(art.ink).map(([name, K]) => ({
      name, w: K.w, h: K.h, rw: K.ref.w, rh: K.ref.h,
      sx: +K.ref.sx.toFixed(3), sy: +K.ref.sy.toFixed(3),
    }));
  }, { paths: { ...cfg.paths, artSvg: SVG || undefined } });

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${SVG ? `vector: ${SVG}` : `raster: ${cfg.paths.art}`}\n`);
  console.log(pad('name', 12) + pad('source', 14) + pad('design', 12) + pad('sx', 8) + pad('sy', 8) + 'aspect');
  for (const r of rows) {
    const ar = r.w / r.h, dar = r.rw / r.rh, dev = (ar / dar - 1) * 100;
    console.log(pad(r.name, 12) + pad(`${r.w}x${r.h}`, 14) + pad(`${r.rw}x${r.rh}`, 12)
      + pad(r.sx, 8) + pad(r.sy, 8) + (Math.abs(dev) > 2 ? `${dev.toFixed(1)}%  <-- 拉伸` : `${dev.toFixed(1)}%`));
  }
  const notes = logs.filter((l) => l.startsWith('[art]'));
  console.log(notes.length ? `\n告警 / 载入记录 (${notes.length}):` : '\n无告警');
  for (const l of notes) console.log('  ' + l);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
