// live2d_art — 把 Live2D 模型渲成透明 PNG，再压成片子的三墨剪影。
//
// 工程里没有 PNG 解码器，所以两件事都借工程自己的静态服务 + 无头浏览器：
//   1) render：跑 tools/live2d_lib/render.html（pixi 6 + pixi-live2d-display 0.4 + 官方 Cubism Core），
//      把某条 motion 定格在第 t 秒、再叠手调参数，渲成 W×H 透明 PNG。
//   2) ink：读那张图，按色相/明度映射到 cream / orange / black 三墨（发→橙、皮肤白布→米白、
//      线稿与深色衣物→黑），可选裁切与缩放，写出符合规格单的 PNG-24。
//
//   node tools/live2d_art.mjs render --model l2d16.u --out out/plate.png --w 4096 --h 4096 --dump
//   node tools/live2d_art.mjs render --model l2d16.u --out out/p2.png --motion motions/Mgirl02_stand.motion3.json --t 1.2
//   node tools/live2d_art.mjs ink --in out/plate.png --out assets/_test_art/f_bust.png --w 2172 --h 2896 --crop 0,0,1600,2133 --dry
//
// 只处理本地素材；模型与产物都不可发布（双生视界/高奈利亚的版权）。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, startServer } from '../export/server.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);

const { server, url } = await startServer({ port: 5194 });
const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => null)
  ?? await chromium.launch({ headless: true });

const toUrl = (p) => '/' + path.relative(ROOT, path.resolve(p)).replace(/\\/g, '/');
const outPath = (p) => path.resolve(p);
const writePng = (dst, dataUrl) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
};

try {
  if (cmd === 'render') {
    const model = arg('model', '');
    if (!model) throw new Error('--model 必填（assets/live2d 下的目录名，如 l2d16.u）');
    const W = +arg('w', 4096), H = +arg('h', 4096);
    const dir = `assets/live2d/${model}`;
    const m3 = `${dir}/${model}.model3.json`;
    if (!fs.existsSync(path.join(ROOT, m3))) throw new Error(`没有 ${m3}`);
    const q = new URLSearchParams({
      model: toUrl(path.join(ROOT, m3)), w: String(W), h: String(H),
      pad: arg('pad', '0.94'), zoom: arg('zoom', '1'), ox: arg('ox', '0'), oy: arg('oy', '0'),
    });
    if (arg('box', '')) q.set('box', arg('box'));              // --box x,y,w,h（模型坐标）直接渲成成品尺寸
    if (arg('motion', '')) q.set('motion', arg('motion'));
    if (arg('t', '')) q.set('t', arg('t'));
    if (arg('params', '')) q.set('params', arg('params'));
    if (has('dump')) q.set('dump', '1');

    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
    page.on('pageerror', (e) => console.log('[page]', e.message));
    await page.goto(`${url}/tools/live2d_lib/render.html?${q}`);
    await page.waitForFunction('window.__READY__ === true || window.__ERR__', null, { timeout: 90000 });
    const err = await page.evaluate('window.__ERR__ || null');
    if (err) throw new Error(err.split('\n')[0]);
    for (const l of await page.evaluate('window.__LOG__')) console.log('  ' + l);
    const dataUrl = await page.evaluate("document.querySelector('canvas').toDataURL('image/png')");
    const dst = outPath(arg('out', `out/live2d_${model}.png`));
    writePng(dst, dataUrl);
    const kb = (fs.statSync(dst).size / 1024).toFixed(0);
    console.log(`→ ${dst}  ${W}x${H}  ${kb} KiB`);
  } else if (cmd === 'ink') {
    const inp = arg('in', '');
    if (!inp) throw new Error('--in 必填');
    const W = +arg('w', 2172), H = +arg('h', 2896);
    const crop = arg('crop', '');                              // 源像素 "x,y,w,h"
    const dry = has('dry');
    const CLEAN = +arg('clean', 2);                            // 5×5 众数清理遍数，0 关闭
    const KEY = +arg('keyline', 6);                            // 黑边宽度（输出 px），0 关闭
    const BLOCK = +arg('block', 1);                            // 降采样格：>1 只取形体（细节被平均掉）
    const dst = outPath(arg('out', dry ? 'out/_ink_dry.png' : 'out/ink.png'));

    const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
    page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
    await page.goto(`${url}/tools/probe.html`);
    const res = await page.evaluate(async ({ src, W, H, crop, CLEAN, KEY, BLOCK }) => {
      const bmp = await createImageBitmap(await (await fetch(src)).blob());
      const sw = bmp.width, sh = bmp.height;
      const rect = crop ? crop.split(',').map(Number) : [0, 0, sw, sh];
      const [cx, cy, cw, ch] = rect;
      const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
      c.width = W; c.height = H;
      g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, W, H);
      g.drawImage(bmp, cx, cy, cw, ch, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;

      const CREAM = [244, 224, 198], ORANGE = [220, 114, 63], BLACK = [36, 26, 21];
      const label = new Uint8Array(W * H);                     // 0 透明 / 1 cream / 2 orange / 3 black
      const classify = (r8, g8, b8) => {
        const r = r8 / 255, gg = g8 / 255, b = b8 / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), v = mx, s = mx === 0 ? 0 : (mx - mn) / mx;
        let h = 0; const d = mx - mn;
        if (d > 0) {
          if (mx === r) h = 60 * (((gg - b) / d) % 6); else if (mx === gg) h = 60 * (((b - r) / d) + 2); else h = 60 * (((r - gg) / d) + 4);
          if (h < 0) h += 360;
        }
        return v < 0.30 ? 3                                    // 近黑：线稿、深色布料
          : (h >= 150 && h <= 265 && s >= 0.12) ? 2            // 青蓝：头发 → 橙墨
            : s < 0.20 ? 1                                     // 白布、无彩 → 米白
              : (h >= 5 && h <= 55 && s < 0.42) ? 1             // 暖白：皮肤 → 米白
                : 2;                                           // 其余中间调 → 橙
      };
      if (BLOCK > 1) {
        // 两段式「只取形体」：
        //   ① 先降到 BLOCK 分之一，按格分类 → 细节（蕾丝、棋格、睫毛、高光）被平均掉，只剩几块大色域；
        //   ② 每个墨层单独用平滑放大放回原尺寸，再按 alpha≥128 阈值取形 —— 边缘是平滑曲线，不是马赛克台阶。
        const bw = Math.max(2, Math.round(W / BLOCK)), bh = Math.max(2, Math.round(H / BLOCK));
        const c2 = document.createElement('canvas'); c2.width = bw; c2.height = bh;
        const g2 = c2.getContext('2d', { willReadFrequently: true });
        g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
        g2.drawImage(c, 0, 0, W, H, 0, 0, bw, bh);
        const lp = g2.getImageData(0, 0, bw, bh).data;
        let low = new Uint8Array(bw * bh);
        for (let j = 0; j < bw * bh; j++) low[j] = lp[j * 4 + 3] < 110 ? 0 : classify(lp[j * 4], lp[j * 4 + 1], lp[j * 4 + 2]);
        // 低分辨率再清两遍 3×3 众数，去掉一两格的小岛
        for (let pass = 0; pass < 2; pass++) {
          const from = low, to = Uint8Array.from(from);
          for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
            const j = y * bw + x, own = from[j];
            if (own === 0) continue;
            const counts = [0, 0, 0, 0];
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) counts[from[j + dy * bw + dx]]++;
            let bi = own, bc = counts[own];
            for (let k = 1; k < 4; k++) if (counts[k] > bc && counts[k] >= 5) { bc = counts[k]; bi = k; }
            to[j] = bi;
          }
          low = to;
        }
        const up = document.createElement('canvas'); up.width = W; up.height = H;
        const gu = up.getContext('2d', { willReadFrequently: true });
        gu.imageSmoothingEnabled = true; gu.imageSmoothingQuality = 'high';
        const masks = [null, null, null, null];
        for (let k = 1; k <= 3; k++) {
          const mk = document.createElement('canvas'); mk.width = bw; mk.height = bh;
          const gk = mk.getContext('2d', { willReadFrequently: true });
          const id = gk.createImageData(bw, bh);
          for (let j = 0; j < bw * bh; j++) if (low[j] === k) { id.data[j * 4] = id.data[j * 4 + 1] = id.data[j * 4 + 2] = 255; id.data[j * 4 + 3] = 255; }
          gk.putImageData(id, 0, 0);
          gu.clearRect(0, 0, W, H);
          gu.drawImage(mk, 0, 0, bw, bh, 0, 0, W, H);
          const ud = gu.getImageData(0, 0, W, H).data;
          const m = new Uint8Array(W * H);
          for (let i = 0, n = W * H; i < n; i++) m[i] = ud[i * 4 + 3] >= 128 ? 1 : 0;
          masks[k] = m;
        }
        for (let i = 0, n = W * H; i < n; i++) label[i] = masks[3][i] ? 3 : masks[2][i] ? 2 : masks[1][i] ? 1 : 0;
      } else {
        for (let i = 0, n = W * H; i < n; i++) {
          if (px[i * 4 + 3] < 16) continue;
          label[i] = classify(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
        }
      }
      // 众数清理：5×5 各点取邻域票数最多的墨，压掉渐变带上的碎斑（腮红、肤色暗面、发际高光）
      let lab2 = Uint8Array.from(label);
      for (let pass = 0; pass < CLEAN; pass++) {
        const from = lab2, to = Uint8Array.from(from);
        for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
          const i = y * W + x, own = from[i];
          if (own === 0) continue;
          const counts = [0, 0, 0, 0];
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) counts[from[i + dy * W + dx]]++;
          let bi = own, bc = counts[own];
          for (let k = 1; k < 4; k++) if (counts[k] > bc && counts[k] >= 12) { bc = counts[k]; bi = k; }
          to[i] = bi;
        }
        lab2 = to;
      }
      // 黑边：把贴着实心外缘的一圈（KEY px）改成黑，补回原图那种墨线勾边
      if (KEY > 0) {
        let edge = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) edge[i] = lab2[i] === 0 ? 1 : 0;
        for (let r = 0; r < KEY; r++) {
          const to = Uint8Array.from(edge);
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            if (edge[i]) continue;
            if (edge[i - 1] || edge[i + 1] || edge[i - W] || edge[i + W]) to[i] = 1;
          }
          edge = to;
        }
        for (let i = 0; i < W * H; i++) if (lab2[i] !== 0 && edge[i]) lab2[i] = 3;
      }
      let solid = 0, bx0 = W, by0 = H, bx1 = -1, by1 = -1;
      const hits = [0, 0, 0, 0];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, L = lab2[i];
        if (L === 0) { px[i * 4 + 3] = 0; continue; }
        hits[L]++; solid++;
        const ink = L === 1 ? CREAM : L === 2 ? ORANGE : BLACK;
        px[i * 4] = ink[0]; px[i * 4 + 1] = ink[1]; px[i * 4 + 2] = ink[2]; px[i * 4 + 3] = 255;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
      g.putImageData(new ImageData(px, W, H), 0, 0);
      const bbox = solid ? { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } : null;
      return { dataUrl: c.toDataURL('image/png'), src: { w: sw, h: sh }, solid, hits, bbox };
    }, { src: toUrl(path.resolve(inp)), W, H, crop, CLEAN, KEY, BLOCK });

    if (res.bbox) {
      const m = { top: res.bbox.y, left: res.bbox.x, right: W - (res.bbox.x + res.bbox.w), bottom: H - (res.bbox.y + res.bbox.h) };
      console.log(`  source ${res.src.w}x${res.src.h} → ${W}x${H}  crop ${crop || 'whole'}`);
      console.log(`  覆盖 ${(res.solid / (W * H) * 100).toFixed(1)}%   cream ${(res.hits[1] / res.solid * 100).toFixed(1)}%  orange ${(res.hits[2] / res.solid * 100).toFixed(1)}%  black ${(res.hits[3] / res.solid * 100).toFixed(1)}%`);
      console.log(`  bbox ${res.bbox.w}x${res.bbox.h} @(${res.bbox.x},${res.bbox.y})  留白 上${(m.top / H * 100).toFixed(1)}% 左${(m.left / W * 100).toFixed(1)}% 右${(m.right / W * 100).toFixed(1)}% 下${(m.bottom / H * 100).toFixed(1)}%`);
    } else console.log('  空图：没有不透明像素');
    if (!dry) {
      writePng(dst, res.dataUrl);
      console.log(`→ ${dst}  ${(fs.statSync(dst).size / 1024).toFixed(0)} KiB`);
    } else console.log('  --dry：只量不写');
  } else {
    throw new Error('用法：node tools/live2d_art.mjs render|ink ...');
  }
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();                                             // 不关它 Node 会一直挂着不退
}
