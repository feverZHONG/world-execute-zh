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

// 素材库里的目录名不一定等于 model3 名（有「【奈乐】泳装.model3.json」这种），所以按目录找：
//   1) 显式 --model3 优先；2) <目录名>.model3.json；3) 目录里第一个 *.model3.json。
function resolveModel3(dir, explicit) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) throw new Error(`没有模型目录：${dir}`);
  if (explicit) {
    const f = path.join(abs, explicit);
    if (!fs.existsSync(f)) throw new Error(`--model3 指的文件不存在：${explicit}`);
    return path.relative(ROOT, f).replace(/\\/g, '/');
  }
  const cands = fs.readdirSync(abs).filter((f) => f.endsWith('.model3.json'));
  if (!cands.length) throw new Error(`${dir} 里没有 .model3.json`);
  const base = path.basename(dir) + '.model3.json';
  const pick = cands.includes(base) ? base : cands[0];
  if (!cands.includes(base)) console.log(`  (目录名与 model3 不同，用 ${pick})`);
  return path.relative(ROOT, path.join(abs, pick)).replace(/\\/g, '/');
}

try {
  if (cmd === 'render') {
    const model = arg('model', '');
    if (!model) throw new Error('--model 必填（如 assets/live2d 下的 l2d16.u，或素材库里的 高奈利亚/l2d16.u）');
    const W = +arg('w', 4096), H = +arg('h', 4096);
    const LIB = (arg('lib', 'assets/live2d_lib') || '').replace(/\\/g, '/');
    const dir = `${LIB}/${model}`;
    const m3 = resolveModel3(dir, arg('model3', ''));
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
    if (has('drawables')) q.set('drawables', '1');            // 列出 drawable 名，供按层分组
    if (arg('hide', '')) q.set('hide', arg('hide'));           // 按部件名（不区分大小写、子串）关掉若干层
    if (arg('only', '')) q.set('only', arg('only'));           // 只留匹配的部件层（逗号分隔）

    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
    page.on('pageerror', (e) => console.log('[page]', e.message));
    await page.goto(`${url}/tools/live2d_lib/render.html?${q}`);
    await page.waitForFunction('window.__READY__ === true || window.__ERR__', null, { timeout: 90000 });
    const err = await page.evaluate('window.__ERR__ || null');
    if (err) throw new Error(err.split('\n')[0]);
    for (const l of await page.evaluate('window.__LOG__')) console.log('  ' + l);
    const dataUrl = await page.evaluate("document.querySelector('canvas').toDataURL('image/png')");
    const dst = outPath(arg('out', `out/live2d_${model.replace(/[\\/]/g, '_')}.png`));
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
    const SKIN = arg('skin', 'cream');                          // 皮肤走哪一墨：cream（默认）/ black（贴近原片无脸设计）
    const FACELESS = has('faceless');                           // 去五官：把头部里被皮肤包住的封闭块（眉/眼/鼻影/嘴）填成皮肤墨
    const FACEH = +arg('face-h', 0.45);                         // 去五官时作用的头部高度占比（从图顶算）
    const ERASE = arg('erase', '');                             // 手工抹除：输出像素 "x,y,w,h"（多块用 ; 分隔），填成皮肤墨
    const BLUE = +arg('blue', 0.12);                            // 蓝色（头发）判成橙墨所需的最低饱和度；调小可吃掉发面高光留下的白洞
    const ISLAND = +arg('island', 0);                           // 小于这个像素数的墨块并回周围主墨（治碎斑，0 关闭）
    const MED = +arg('median', 0);                              // 墨标号的中值滤波半径（大形化，0 关闭）
    const SIL = has('silhouette');                              // 真剪影：只认外轮廓，填一整块墨，沿外缘描黑边
    const FILL = arg('fill', 'orange');                         // 剪影的墨：orange（默认）/ cream / black
    const STROKE = +arg('stroke', 6);                           // 剪影黑边宽度（输出 px），0 不描
    const CORE = arg('core', 'off');                            // 剪影内芯的墨：orange / cream / black / off（不做层次）
    const INSET = +arg('inset', 40);                            // 内芯相对外形的内缩距离（输出 px）
    const HOLES = arg('holes', '1') === '1';                    // 被外形包住的空隙填黑（默认开）
    const dst = outPath(arg('out', dry ? 'out/_ink_dry.png' : 'out/ink.png'));

    const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
    page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
    await page.goto(`${url}/tools/probe.html`);
    const res = await page.evaluate(async ({ src, W, H, crop, CLEAN, KEY, BLOCK, SKIN, FACELESS, FACEH, ERASE, BLUE, ISLAND, MED, SIL, FILLINK, STROKE, COREINK, INSET, HOLES }) => {
      const bmp = await createImageBitmap(await (await fetch(src)).blob());
      const sw = bmp.width, sh = bmp.height;
      const rect = crop ? crop.split(',').map(Number) : [0, 0, sw, sh];
      const [cx, cy, cw, ch] = rect;
      const CREAM = [244, 224, 198], ORANGE = [220, 114, 63], BLACK = [36, 26, 21];
      // 真剪影（--silhouette）：只认 alpha 外形，填一整块墨，沿外缘描一圈黑边。
      // 描边在 2× 超采样网格上做，最后缩回输出尺寸 —— 边缘才是原画那种平滑墨线，不是硬台阶。
      if (SIL) {
        const SS2 = 2, W2 = W * SS2, H2 = H * SS2;
        const c2 = document.createElement('canvas'); c2.width = W2; c2.height = H2;
        const g2 = c2.getContext('2d', { willReadFrequently: true });
        g2.imageSmoothingQuality = 'high';
        g2.clearRect(0, 0, W2, H2);
        g2.drawImage(bmp, cx, cy, cw, ch, 0, 0, W2, H2);
        const p2 = g2.getImageData(0, 0, W2, H2).data;
        const lab = new Uint8Array(W2 * H2);
        for (let i = 0, n = W2 * H2; i < n; i++) lab[i] = p2[i * 4 + 3] >= 128 ? FILLINK : 0;
        // 层次（可选）：外形一种墨、内芯另一种墨、被外形包住的空隙填黑。
        // 层次只来自三个可控制的东西（内缩距离、两种墨、空隙），不来自像素分类，所以不会长碎斑。
        if (HOLES) {                                             // 被外形包住、不与画布边界连通的透明区 → 黑
          const ext = new Uint8Array(W2 * H2), st = [];
          const push = (i) => { if (lab[i] === 0 && !ext[i]) { ext[i] = 1; st.push(i); } };
          for (let x = 0; x < W2; x++) { push(x); push((H2 - 1) * W2 + x); }
          for (let y = 0; y < H2; y++) { push(y * W2); push(y * W2 + W2 - 1); }
          while (st.length) {
            const i = st.pop(), x = i % W2;
            if (x > 0) push(i - 1);
            if (x < W2 - 1) push(i + 1);
            if (i >= W2) push(i - W2);
            if (i + W2 < W2 * H2) push(i + W2);
          }
          for (let i = 0; i < W2 * H2; i++) if (lab[i] === 0 && !ext[i]) lab[i] = 3;
        }
        if (INSET > 0 && COREINK > 0) {                          // 外形内缩 INSET px 的部分 → 第二墨
          let m = new Uint8Array(W2 * H2);
          for (let i = 0; i < W2 * H2; i++) m[i] = lab[i] === FILLINK ? 1 : 0;
          const steps = Math.round(INSET * SS2);
          for (let r = 0; r < steps; r++) {
            const to = Uint8Array.from(m);
            for (let y = 1; y < H2 - 1; y++) for (let x = 1; x < W2 - 1; x++) {
              const i = y * W2 + x;
              if (!m[i]) continue;
              if (!m[i - 1] || !m[i + 1] || !m[i - W2] || !m[i + W2]) to[i] = 0;
            }
            m = to;
          }
          for (let i = 0; i < W2 * H2; i++) if (m[i]) lab[i] = COREINK;
        }
        const ST = Math.max(0, Math.round(STROKE * SS2));
        if (ST > 0) {
          let edge = new Uint8Array(W2 * H2);
          for (let i = 0; i < W2 * H2; i++) edge[i] = lab[i] === 0 ? 1 : 0;
          for (let r = 0; r < ST; r++) {
            const to = Uint8Array.from(edge);
            for (let y = 1; y < H2 - 1; y++) for (let x = 1; x < W2 - 1; x++) {
              const i = y * W2 + x;
              if (edge[i]) continue;
              if (edge[i - 1] || edge[i + 1] || edge[i - W2] || edge[i + W2]) to[i] = 1;
            }
            edge = to;
          }
          for (let i = 0; i < W2 * H2; i++) if (lab[i] !== 0 && edge[i]) lab[i] = 3;
        }
        const hits = [0, 0, 0, 0];
        let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
        for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
          const i = y * W2 + x, L = lab[i];
          if (L === 0) { p2[i * 4 + 3] = 0; continue; }
          hits[L]++;
          const ink = L === 1 ? CREAM : L === 2 ? ORANGE : BLACK;
          p2[i * 4] = ink[0]; p2[i * 4 + 1] = ink[1]; p2[i * 4 + 2] = ink[2]; p2[i * 4 + 3] = 255;
          if (L !== 3) {                                  // bbox 只量外形，不含描边
            const xo = (x / SS2) | 0, yo = (y / SS2) | 0;
            if (xo < bx0) bx0 = xo; if (xo > bx1) bx1 = xo;
            if (yo < by0) by0 = yo; if (yo > by1) by1 = yo;
          }
        }
        g2.putImageData(new ImageData(p2, W2, H2), 0, 0);
        const cOut = document.createElement('canvas'); cOut.width = W; cOut.height = H;
        const gOut = cOut.getContext('2d'); gOut.imageSmoothingQuality = 'high';
        gOut.drawImage(c2, 0, 0, W2, H2, 0, 0, W, H);
        const bbox = bx1 >= 0 ? { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } : null;
        const solid = (hits[1] + hits[2] + hits[3]) / (SS2 * SS2);
        return { dataUrl: cOut.toDataURL('image/png'), src: { w: sw, h: sh }, solid, hits, bbox, sil: true };
      }
      const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
      c.width = W; c.height = H;
      g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, W, H);
      g.drawImage(bmp, cx, cy, cw, ch, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;

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
          : (h >= 150 && h <= 265 && s >= BLUE) ? 2           // 青蓝：头发 → 橙墨（阈值放低才吃得掉发面高光）
            : s < 0.20 ? 1                                     // 白布、无彩 → 米白
              : (h >= 5 && h <= 55 && s < 0.42) ? (SKIN === 'black' ? 3 : 1)   // 暖白：皮肤 → 米白（原片无脸，皮肤走黑更贴原设计）
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
      // 去五官（--faceless）：片子要的是"无脸"剪影，而模型天生有眉、眼、鼻影、嘴，
      // 这些小块都被皮肤包住 —— 标准补洞：从 ROI 边界泛洪非皮肤像素，只留在外面；
      // 到不了外面的非皮肤实心块就是"洞"，一律填成皮肤墨。
      if (FACELESS) {
        const SKINFILL = SKIN === 'black' ? 3 : 1;
        const roiH = Math.max(2, Math.min(H, Math.round(H * FACEH)));
        const reach = new Uint8Array(W * roiH);
        const stack = new Int32Array(W * roiH); let sp = 0;
        const push = (i) => { if (!reach[i]) { reach[i] = 1; stack[sp++] = i; } };
        for (let x = 0; x < W; x++) { push(x); push((roiH - 1) * W + x); }
        for (let y = 0; y < roiH; y++) { push(y * W); push(y * W + W - 1); }
        while (sp > 0) {
          const i = stack[--sp], x = i % W, y = (i - x) / W;
          if (x > 0 && lab2[i - 1] !== 1 && !reach[i - 1]) { reach[i - 1] = 1; stack[sp++] = i - 1; }
          if (x < W - 1 && lab2[i + 1] !== 1 && !reach[i + 1]) { reach[i + 1] = 1; stack[sp++] = i + 1; }
          if (y > 0 && lab2[i - W] !== 1 && !reach[i - W]) { reach[i - W] = 1; stack[sp++] = i - W; }
          if (y < roiH - 1 && lab2[i + W] !== 1 && !reach[i + W]) { reach[i + W] = 1; stack[sp++] = i + W; }
        }
        for (let i = 0; i < W * roiH; i++) if (lab2[i] !== 0 && lab2[i] !== 1 && !reach[i]) lab2[i] = SKINFILL;
      }
      // 手工抹除（--erase）：脸上的五官不是"洞"（头发压着脸，泛洪穿过去了），
      // 那就给一条确定的出口 —— 由人给框，工具只负责按框填成皮肤墨。
      if (ERASE) {
        const SKINFILL = SKIN === 'black' ? 3 : 1;
        for (const seg of ERASE.split(';')) {
          const [ex, ey, ew, eh] = seg.split(',').map(Number);
          if (![ex, ey, ew, eh].every((v) => Number.isFinite(v))) continue;
          const x0 = Math.max(0, Math.round(ex)), y0 = Math.max(0, Math.round(ey));
          const x1 = Math.min(W - 1, Math.round(ex + ew)), y1 = Math.min(H - 1, Math.round(ey + eh));
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const i = y * W + x;
            if (lab2[i] !== 0) lab2[i] = SKINFILL;
          }
          // 框里的透明小洞也要堵上（只堵左右有实心像素的），否则后面的 blackline 会把洞边勾成黑点
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const i = y * W + x;
            if (lab2[i] !== 0) continue;
            const l = x > x0 && lab2[i - 1] !== 0, r = x < x1 && lab2[i + 1] !== 0;
            if (l || r) lab2[i] = SKINFILL;
          }
        }
      }
      // 大形化（--median r）：对墨标号做中值滤波，把边界推成连续的大块面。
      // 碎斑不是"噪点"而是"小色块"，island 是按面积砍，median 是按邻域投票，两者互补。
      if (MED > 0) {
        const src = Uint8Array.from(lab2), out = Uint8Array.from(lab2);
        const cnt = [0, 0, 0, 0];
        for (let y = MED; y < H - MED; y++) for (let x = MED; x < W - MED; x++) {
          cnt[0] = cnt[1] = cnt[2] = cnt[3] = 0;
          for (let dy = -MED; dy <= MED; dy++) {
            const row = (y + dy) * W + x;
            for (let dx = -MED; dx <= MED; dx++) cnt[src[row + dx]]++;
          }
          const i = y * W + x, own = src[i];
          let bi = 0, bc = -1;
          for (let k = 0; k < 4; k++) if (cnt[k] > bc) { bc = cnt[k]; bi = k; }
          if (bi !== 0) out[i] = bi; else out[i] = own;            // 透明占多数时保留原值，不扩洞
        }
        for (let i = 0; i < W * H; i++) lab2[i] = out[i];
      }
      // 去碎斑（--island）：把小于阈值的整块墨并回它周围占多数的墨。
      // 和 --block 是两件事：block 是"看不清就不画"，island 是"看得清但太小就不留"。
      // 用它是为了在全分辨率分类（边缘平滑）之下，把蕾丝、花纹、发高光这些细碎块吃掉。
      if (ISLAND > 0) {
        const seen = new Uint8Array(W * H);
        const stack = new Int32Array(W * H);
        for (let start = 0; start < W * H; start++) {
          if (seen[start]) continue;
          const own = lab2[start];
          seen[start] = 1;
          let sp = 0; stack[sp++] = start;
          const comp = []; const nb = [0, 0, 0, 0];
          let touchesBorder = false;
          while (sp > 0) {
            const i = stack[--sp]; comp.push(i);
            const x = i % W, y = (i - x) / W;
            if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesBorder = true;
            if (x > 0) { const j = i - 1; if (lab2[j] === own) { if (!seen[j]) { seen[j] = 1; stack[sp++] = j; } } else nb[lab2[j]]++; }
            if (x < W - 1) { const j = i + 1; if (lab2[j] === own) { if (!seen[j]) { seen[j] = 1; stack[sp++] = j; } } else nb[lab2[j]]++; }
            if (y > 0) { const j = i - W; if (lab2[j] === own) { if (!seen[j]) { seen[j] = 1; stack[sp++] = j; } } else nb[lab2[j]]++; }
            if (y < H - 1) { const j = i + W; if (lab2[j] === own) { if (!seen[j]) { seen[j] = 1; stack[sp++] = j; } } else nb[lab2[j]]++; }
          }
          if (own !== 0 && comp.length < ISLAND) {
            // 小色块 → 并回周围占多数的墨
            let bi = 0, bc = -1;
            for (let k = 0; k < 4; k++) if (nb[k] > bc) { bc = nb[k]; bi = k; }
            for (const i of comp) lab2[i] = bi;
          } else if (own === 0 && !touchesBorder && comp.length < ISLAND) {
            // 形状内部的透明小洞 → 用周围主墨堵上（否则 blackline 会沿洞勾出一圈黑点）
            let bi = 0, bc = 0;
            for (let k = 1; k < 4; k++) if (nb[k] > bc) { bc = nb[k]; bi = k; }
            if (bi !== 0) for (const i of comp) lab2[i] = bi;
          }
        }
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
    }, { src: toUrl(path.resolve(inp)), W, H, crop, CLEAN, KEY, BLOCK, SKIN, FACELESS, FACEH, ERASE, BLUE, ISLAND, MED, SIL, FILLINK: (FILL === 'cream' ? 1 : FILL === 'black' ? 3 : 2), STROKE, COREINK: (CORE === 'cream' ? 1 : CORE === 'orange' ? 2 : CORE === 'black' ? 3 : 0), INSET, HOLES });

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
