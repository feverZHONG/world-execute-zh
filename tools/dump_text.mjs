// 抓片内所有被画出的文字（用于中文化查漏）：给 fillText 挂钩子，按 0.5 秒网格扫全片。
//   node tools/dump_text.mjs [--step 0.5] [--from -4] [--to 209] [--out out/_lib/text_dump.json]
// 帧数据直接丢弃，只留文字与时间。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, startServer } from '../export/server.mjs';
import { frameSocketHandler } from '../export/wsframes.mjs';

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const features = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.paths.features), 'utf8'));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const STEP = +arg('step', 0.5);
const FROM = +arg('from', -(cfg.safety?.preroll ?? 0));
const TO = +arg('to', features.meta.duration);
const OUT = path.resolve(ROOT, arg('out', 'out/_lib/text_dump.json'));
const W = 640, H = 360;

const times = [];
for (let t = FROM; t <= TO + 1e-6; t += STEP) times.push(+t.toFixed(3));

const onUpgrade = frameSocketHandler({ frameBytes: W * H * 4, onFrame: () => Promise.resolve(), onError: (e) => console.error('[ws]', e) });
const { server, url } = await startServer({ port: 5181, onUpgrade });
let browser;
for (const channel of [cfg.export.browserChannel, 'msedge', undefined]) {
  try { browser = await chromium.launch({ channel, headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] }); break; } catch { /* next */ }
}
if (!browser) throw new Error('no browser');
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto(`${url}/?mode=export&w=${W}&h=${H}`);
  await page.waitForFunction(() => window.__mv && window.__mv.ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__dumpT = 0;
    window.__dump = [];
    const hook = (proto) => {
      if (!proto) return;
      const orig = proto.fillText;
      proto.fillText = function (str, x, y, ...rest) {
        const s = String(str);
        if (s.trim()) window.__dump.push({ t: window.__dumpT, s, x: Math.round(x), y: Math.round(y) });
        return orig.call(this, str, x, y, ...rest);
      };
    };
    hook(CanvasRenderingContext2D.prototype);
    hook(window.OffscreenCanvasRenderingContext2D && window.OffscreenCanvasRenderingContext2D.prototype);
    const mv = window.__mv;
    const one = mv.exportTimes.bind(mv);
    mv.exportTimes = async (ts) => {
      const list = Array.isArray(ts) ? ts : [ts];
      let n = 0;
      for (const t of list) { window.__dumpT = t; n += await one([t]); }
      return n;
    };
  });
  const t0 = Date.now();
  for (let i = 0; i < times.length; i += 10) {
    await page.evaluate((ts) => window.__mv.exportTimes(ts), times.slice(i, i + 10));
    const done = Math.min(times.length, i + 10);
    process.stdout.write(`\r[dump] ${done}/${times.length}  ${((Date.now() - t0) / done).toFixed(0)} ms/t   `);
  }
  process.stdout.write('\n');
  const dump = await page.evaluate(() => window.__dump);
  fs.writeFileSync(OUT, JSON.stringify(dump, null, 0));
  console.log(`[dump] ${dump.length} 次绘制 -> ${path.relative(ROOT, OUT)}`);
} finally {
  await browser.close();
  server.close();
}
