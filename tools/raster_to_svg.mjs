// raster_to_svg — 把三墨剪影 PNG 转成 SVG（三块累进版，按印刷顺序 cream → orange → black）。
//
// 不给「出图」加活：它只把已经画好的位图变成矢量，用的是引擎自己的分离与描线代码（art.js 的 _prepareInk +
// trace.js 的 outline/smoothPath），所以描出来的边界和片子里正在用的是同一条。用途有两个：
//   1. 验证 SVG 能不能进管线（assets/character_svg/*.svg，配 --artsvg 跑一遍对比）；
//   2. 将来画师只交干净的三墨 PNG，这里的矢量化由工程接手，画师不必碰矢量工具链。
//
//   node tools/raster_to_svg.mjs [--in assets/character] [--out assets/character_svg] [--bake 2000]
//                               [--bake-long f_eye=3000,f_reach=3000] [--only f_bust,f_eye]
//
// 注意：位图矢量化只去掉「放大时的模糊」，不会增加细节。要真正吃到矢量的好处，得让画师按矢量画（或画得更大）。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, startServer } from '../export/server.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const IN_DIR = (arg('in', 'assets/character') || '').replace(/\\/g, '/');
const OUT_DIR = (arg('out', 'assets/character_svg') || '').replace(/\\/g, '/');
const BAKE = +arg('bake', 2000);
const BAKE_LONG = Object.fromEntries((arg('bake-long', 'f_eye=3000,f_reach=3000') || '').split(',')
  .filter(Boolean).map((s) => s.split('=').map((v) => v.trim())).map(([k, v]) => [k, +v]));
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const NAMES = ['f_bust', 'f_profile', 'f_reach', 'f_eye', 'boy_bust', 'man_bust', 'cat_bust', 'cat_paws'];

fs.mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
const { server, url } = await startServer({ port: 5191 });
const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => chromium.launch({ headless: true }));
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto(`${url}/tools/probe.html`);
  const todo = (ONLY.length ? ONLY : NAMES);
  const svgs = await page.evaluate(async ({ names, dir, bake, bakeLong }) => {
    const { Art } = await import('/src/engine/art.js');
    const { outline, smoothPath } = await import('/src/engine/trace.js');
    const art = new Art();
    const out = {};
    for (const name of names) {
      const img = new Image();
      img.src = `/${dir}/${name}.png`;
      await img.decode();
      art._prepareInk(name, img);                                   // 引擎自己的分离：三块累进 mask + 描线
      const K = art.ink[name], W = K.w, H = K.h;
      const target = bakeLong[name] ?? bake;
      const s = target / Math.max(W, H);
      const bw = Math.round(W * s), bh = Math.round(H * s);
      const parts = [];
      for (let k = 0; k < 3; k++) {
        const cv = K.mask[k], g = cv.getContext('2d', { willReadFrequently: true });
        const px = g.getImageData(0, 0, W, H).data;
        const cover = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) cover[i] = px[i * 4 + 3];   // mask canvases carry the coverage in alpha
        const loops = outline(cover, W, H, { eps: 0.25, minArea: 10 });
        const rec = { moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, segs: 0, d: [] };
        const f = (v) => { const r = Math.round(v * 100) / 100; return String(r); };
        rec.moveTo = (x, y) => { rec.segs++; rec.d.push(`M${f(x)} ${f(y)}`); };
        rec.lineTo = (x, y) => { rec.segs++; rec.d.push(`L${f(x)} ${f(y)}`); };
        rec.quadraticCurveTo = (cx, cy, x, y) => { rec.segs++; rec.d.push(`Q${f(cx)} ${f(cy)} ${f(x)} ${f(y)}`); };
        rec.closePath = () => rec.d.push('Z');
        smoothPath(loops, rec);
        parts.push({ k, loops: loops.length, segs: rec.segs, d: rec.d.join('') });
      }
      const hex = K.rgb.map((c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
      const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="0 0 ${W} ${H}">\n`
        + `<!-- ${name}: ${W}x${H} 源，烘焙 ${bw}x${bh}；三块累进版（cream → orange → black），由 art.js 分离 + trace.js 描线生成，勿手改 -->\n`;
      const body = parts.map((p) => `<path fill="${hex[p.k]}" fill-rule="nonzero" d="${p.d}"/>`).join('\n');
      out[name] = { svg: head + body + '\n</svg>\n', w: W, h: H, bw, bh, loops: parts.map((p) => p.loops), segs: parts.map((p) => p.segs) };
    }
    return out;
  }, { names: todo, dir: IN_DIR, bake: BAKE, bakeLong: BAKE_LONG });

  for (const [name, s] of Object.entries(svgs)) {
    const file = path.join(ROOT, OUT_DIR, `${name}.svg`);
    fs.writeFileSync(file, s.svg);
    const kb = Math.round(fs.statSync(file).size / 1024);
    console.log(`${name}.svg  ${s.w}x${s.h} → 烘焙 ${s.bw}x${s.bh}  ${kb} KB  轮廓 ${s.loops.join('/')}  段 ${s.segs.join('/')}`);
  }
  console.log(`\n写入 ${OUT_DIR}/（${Object.keys(svgs).length} 张）`);
} finally {
  await browser.close?.();
  server.close();
}
