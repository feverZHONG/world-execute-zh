// art_filter — 把任意一张图「滤镜」成片子的三墨剪影（cream / orange / black），不再靠画、也不靠描。
//
// 思路：片子要的从来不是"某一张画"，而是"这套三墨语言"。所以把转换做成一层滤镜：
//   任何输入（Live2D 渲染、截图、照片、旧图）→ 平滑 → 分类到三墨 → 去碎斑 → 按规格尺寸出 PNG-24。
// 与 tools/live2d_art.mjs ink 的区别：那个是人肉按 Live2D 调的（HSV 语义 + block 降采样）；
// 这个是通用滤镜，加了双边平滑（保边去纹理）、可选 k3 明度三分（对没有色相语义的图也能用）、
// 小连通块剔除，并直接按 --w/--h cover 到交付尺寸。
//
//   node tools/art_filter.mjs --in out/_ref/bust_reg3.png --out out/_ref/f_bust.png --w 2172 --h 2896
//   node tools/art_filter.mjs --in a.png --out b.png --mode k3 --smooth 3 --clean 2 --min-area 400
//   node tools/art_filter.mjs --in assets/character/f_bust.png --out out/_ref/rt.png --w 1086 --h 1448 --dry
//
// 参数：
//   --in / --out         输入图 / 输出 PNG（默认 out/art_filter.png）
//   --w --h              输出尺寸（默认 2172×2896，按 cover 铺满，不拉伸）
//   --mode hsv|k3        hsv=按色相语义分墨（默认，发→橙、白布→米白、深色→黑）；k3=按明度三分（通用）
//   --skin cream|black   皮肤走哪一墨（默认 cream；原片是无脸设计，可走 black）
//   --smooth n           双边平滑遍数（默认 2，0 关闭）
//   --sig σ             双边平滑的亮度容差（默认 14；越大越"糊掉纹理"、越保不住细节边界）
//   --clean n            3×3 众数清理遍数（默认 2）
//   --min-area px        小于该像素数的连通块直接丢掉（默认 0 关闭；2172×2896 建议 300~800）
//   --dry                只量不写
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, startServer } from '../export/server.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);

const INP = arg('in', '');
if (!INP) { console.error('--in 必填'); process.exit(2); }
const W = +arg('w', 2172), H = +arg('h', 2896);
const MODE = arg('mode', 'hsv');
const SKIN = arg('skin', 'cream');
const SMOOTH = +arg('smooth', 2);
const SIG = +arg('sig', 14);
const CLEAN = +arg('clean', 2);
const MINA = +arg('min-area', 0);
const dry = has('dry');
const OUT = path.resolve(arg('out', dry ? 'out/_filter_dry.png' : 'out/art_filter.png'));

const toUrl = (p) => '/' + path.relative(ROOT, path.resolve(p)).replace(/\\/g, '/');

const { server, url } = await startServer({ port: 5195 });
const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => null)
  ?? await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
  await page.goto(`${url}/tools/probe.html`);

  const res = await page.evaluate(async ({ src, W, H, MODE, SKIN, SMOOTH, SIG, CLEAN, MINA }) => {
    const bmp = await createImageBitmap(await (await fetch(src)).blob());
    const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
    c.width = W; c.height = H;
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, W, H);
    // cover：短边铺满、长边居中裁，绝不拉伸（规格要求 3:4 / 1:1）
    const k = Math.max(W / bmp.width, H / bmp.height);
    const dw = bmp.width * k, dh = bmp.height * k;
    g.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const img = g.getImageData(0, 0, W, H);
    const px = img.data;
    const n = W * H;

    // 形体只认 alpha，滤镜只决定"里面填哪一墨" —— 不缩边、不出锯齿
    const solid = new Uint8Array(n);
    for (let i = 0; i < n; i++) solid[i] = px[i * 4 + 3] >= 40 ? 1 : 0;

    // ① 双边平滑：保边去纹理（照片的皮肤毛孔、Live2D 的渐变噪点、截图压缩块都会被压平，边界不动）
    let R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0; i < n; i++) { R[i] = px[i * 4]; G[i] = px[i * 4 + 1]; B[i] = px[i * 4 + 2]; }
    const s2 = 2 * SIG * SIG;
    for (let pass = 0; pass < SMOOTH; pass++) {
      const R2 = Float32Array.from(R), G2 = Float32Array.from(G), B2 = Float32Array.from(B);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const j = y * W + x;
        if (!solid[j]) continue;
        const l0 = 0.299 * R[j] + 0.587 * G[j] + 0.114 * B[j];
        let sr = 0, sg = 0, sb = 0, sw = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = j + dy * W + dx;
          if (!solid[q]) continue;
          const lq = Math.abs(l0 - (0.299 * R[q] + 0.587 * G[q] + 0.114 * B[q]));
          const wt = Math.exp(-(lq * lq) / s2);
          sr += R[q] * wt; sg += G[q] * wt; sb += B[q] * wt; sw += wt;
        }
        if (sw > 0) { R2[j] = sr / sw; G2[j] = sg / sw; B2[j] = sb / sw; }
      }
      R = R2; G = G2; B = B2;
    }

    // ② 分墨
    const CREAM = [244, 224, 198], ORANGE = [220, 114, 63], BLACK = [36, 26, 21];
    const label = new Uint8Array(n);                       // 0 透明 / 1 cream / 2 orange / 3 black
    if (MODE === 'k3') {
      // 明度三分：对没有色相语义的图（照片、截图）也能出三墨，只是语义靠明暗，不靠"发/布"
      const samp = [];
      for (let i = 0; i < n; i += 7) if (solid[i]) samp.push(i);
      const lv = (i) => 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
      samp.sort((a, b) => lv(a) - lv(b));
      const cent = [samp[(samp.length * 0.2) | 0], samp[(samp.length * 0.55) | 0], samp[(samp.length * 0.9) | 0]]
        .map((i) => [R[i], G[i], B[i]]);
      for (let it = 0; it < 8; it++) {
        const sum = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
        for (const i of samp) {
          let bi = 0, bd = 1e9;
          for (let k2 = 0; k2 < 3; k2++) {
            const d = (R[i] - cent[k2][0]) ** 2 + (G[i] - cent[k2][1]) ** 2 + (B[i] - cent[k2][2]) ** 2;
            if (d < bd) { bd = d; bi = k2; }
          }
          sum[bi][0] += R[i]; sum[bi][1] += G[i]; sum[bi][2] += B[i]; sum[bi][3]++;
        }
        for (let k2 = 0; k2 < 3; k2++) if (sum[k2][3]) cent[k2] = [sum[k2][0] / sum[k2][3], sum[k2][1] / sum[k2][3], sum[k2][2] / sum[k2][3]];
      }
      const order = [0, 1, 2].sort((a, b) => (0.299 * cent[a][0] + 0.587 * cent[a][1] + 0.114 * cent[a][2])
        - (0.299 * cent[b][0] + 0.587 * cent[b][1] + 0.114 * cent[b][2]));
      for (let i = 0; i < n; i++) {
        if (!solid[i]) continue;
        let bi = 0, bd = 1e9;
        for (let k2 = 0; k2 < 3; k2++) {
          const d = (R[i] - cent[k2][0]) ** 2 + (G[i] - cent[k2][1]) ** 2 + (B[i] - cent[k2][2]) ** 2;
          if (d < bd) { bd = d; bi = k2; }
        }
        // 最暗 → 黑；最亮 → 米白；中间 → 橙（照片也读得顺）
        label[i] = bi === order[0] ? 3 : bi === order[2] ? 1 : 2;
      }
    } else {
      for (let i = 0; i < n; i++) {
        if (!solid[i]) continue;
        const r = R[i] / 255, gg = G[i] / 255, b = B[i] / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), v = mx, s = mx === 0 ? 0 : (mx - mn) / mx;
        let h = 0; const d = mx - mn;
        if (d > 0) {
          if (mx === r) h = 60 * (((gg - b) / d) % 6);
          else if (mx === gg) h = 60 * (((b - r) / d) + 2);
          else h = 60 * (((r - gg) / d) + 4);
          if (h < 0) h += 360;
        }
        label[i] = v < 0.30 ? 3
          : (h >= 150 && h <= 265 && s >= 0.12) ? 2
            : s < 0.20 ? 1
              : (h >= 5 && h <= 55 && s < 0.42) ? (SKIN === 'black' ? 3 : 1)
                : 2;
      }
    }

    // ③ 3×3 众数清理：碎斑、单像素噪点
    for (let pass = 0; pass < CLEAN; pass++) {
      const to = Uint8Array.from(label);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const j = y * W + x, own = label[j];
        if (!own) continue;
        const cnt = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[label[j + dy * W + dx]]++;
        let bi = own, bc = cnt[own];
        for (let k2 = 1; k2 < 4; k2++) if (cnt[k2] > bc && cnt[k2] >= 5) { bc = cnt[k2]; bi = k2; }
        to[j] = bi;
      }
      label.set(to);
    }

    // ④ 小连通块剔除（4 邻域，会临时借一个栈，不打乱 label 的其他语义）
    if (MINA > 0) {
      const seen = new Uint8Array(n), stack = new Int32Array(Math.min(n, 1 << 22));
      for (let i = 0; i < n; i++) {
        if (!label[i] || seen[i]) continue;
        const own = label[i];
        let sp = 0, cnt = 0;
        stack[sp++] = i; seen[i] = 1;
        const comp = [];
        while (sp > 0) {
          const j = stack[--sp]; comp.push(j); cnt++;
          const x = j % W;
          if (x > 0 && label[j - 1] === own && !seen[j - 1]) { seen[j - 1] = 1; stack[sp++] = j - 1; }
          if (x < W - 1 && label[j + 1] === own && !seen[j + 1]) { seen[j + 1] = 1; stack[sp++] = j + 1; }
          if (j - W >= 0 && label[j - W] === own && !seen[j - W]) { seen[j - W] = 1; stack[sp++] = j - W; }
          if (j + W < n && label[j + W] === own && !seen[j + W]) { seen[j + W] = 1; stack[sp++] = j + W; }
        }
        if (cnt < MINA) for (const j of comp) label[j] = 0;
      }
    }

    // ⑤ 出图（只允许三墨 + 全透明；alpha 一律 255，符合规格单"主体 alpha 255 / 外部 0"）
    const out = new ImageData(W, H);
    const od = out.data;
    const PICK = [null, CREAM, ORANGE, BLACK];
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1, solidCnt = 0;
    const hits = { cream: 0, orange: 0, black: 0 };
    for (let i = 0; i < n; i++) {
      const L = label[i];
      if (!L) continue;
      const rgb = PICK[L], o = i * 4;
      od[o] = rgb[0]; od[o + 1] = rgb[1]; od[o + 2] = rgb[2]; od[o + 3] = 255;
      solidCnt++;
      hits[L === 1 ? 'cream' : L === 2 ? 'orange' : 'black']++;
      const x = i % W, y = (i / W) | 0;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    g.putImageData(out, 0, 0);
    const bbox = solidCnt ? { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } : null;
    return { dataUrl: c.toDataURL('image/png'), src: { w: bmp.width, h: bmp.height }, solidCnt, hits, bbox, W, H };
  }, { src: toUrl(INP), W, H, MODE, SKIN, SMOOTH, SIG, CLEAN, MINA });

  const pct = (v) => (v / (res.solidCnt || 1) * 100).toFixed(1) + '%';
  console.log(`  source ${res.src.w}x${res.src.h} → ${res.W}x${res.H} cover  mode=${MODE} skin=${SKIN} smooth=${SMOOTH} clean=${CLEAN} minArea=${MINA}`);
  console.log(`  覆盖 ${(res.solidCnt / (res.W * res.H) * 100).toFixed(1)}%  cream ${pct(res.hits.cream)}  orange ${pct(res.hits.orange)}  black ${pct(res.hits.black)}`);
  if (res.bbox) {
    const b = res.bbox, m = { 上: b.y, 左: b.x, 右: res.W - (b.x + b.w), 下: res.H - (b.y + b.h) };
    console.log(`  bbox ${b.w}x${b.h} @(${b.x},${b.y})  留白 上${(m.上 / res.H * 100).toFixed(1)}% 左${(m.左 / res.W * 100).toFixed(1)}% 右${(m.右 / res.W * 100).toFixed(1)}% 下${(m.下 / res.H * 100).toFixed(1)}%`);
  }
  if (dry) { console.log('  --dry：只量不写'); } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(res.dataUrl.slice(res.dataUrl.indexOf(',') + 1), 'base64'));
    console.log(`→ ${OUT}  ${res.W}x${res.H}  ${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB`);
  }
} catch (e) {
  console.error('失败：', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.close();
}
