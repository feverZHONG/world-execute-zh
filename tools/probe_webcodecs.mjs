// Probe: does this machine give WebCodecs a hardware H.264 encoder, and what does one frame cost?
//   node tools/probe_webcodecs.mjs            -> headless print
//   node tools/probe_webcodecs.mjs --headed   -> show the window (debug only)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer, ROOT } from '../export/server.mjs';

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const gpuArgs = ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--force_high_performance_gpu',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

const { server, url } = await startServer({ port: 5185 });
let browser;
for (const channel of [cfg.export.browserChannel, 'msedge', undefined]) {
  try { browser = await chromium.launch({ channel, headless: !process.argv.includes('--headed'), args: gpuArgs }); break; } catch { /* next */ }
}
if (!browser) { server.close(); throw new Error('no Chrome/Edge'); }

const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', (m) => { if (m.text().startsWith('[probe]')) console.log('  ' + m.text()); });
page.on('pageerror', (e) => console.log('[page error]', e.message));
await page.goto(`${url}/tools/probe_webcodecs.html`);
await page.waitForFunction(() => window.__probe && window.__probe.done, null, { timeout: 60000 });
const res = await page.evaluate(() => window.__probe.res);

console.log(JSON.stringify(res, null, 2));
await browser.close();
server.close();
