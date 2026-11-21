#!/usr/bin/env node
// QA 门禁（跨平台版）：闪光安全 + 音画同步。与 tools/check.cmd 同一步骤、同一默认值，
// Windows 与 Linux/macOS 都能跑（check.cmd 保留给直接双击的老用法）。
//
//   npm run check                 -> out/preview_1080p60.mp4
//   npm run check:4k              -> out/world_execute_me_4k60.mp4
//   node tools/check.mjs out/x.mp4
//
// check_sync.py 要 librosa：本机装在 .pydeps（pip install --target，不入库），
// 所以这里把它挂进 PYTHONPATH，而不是要求一套 venv。
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPython } from './py.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = { ...process.env };
env.PYTHONPATH = [path.join(ROOT, '.pydeps'), env.PYTHONPATH].filter(Boolean).join(path.delimiter);
if (!env.NUMBA_CACHE_DIR) env.NUMBA_CACHE_DIR = path.join(os.tmpdir(), 'numba');

const mp4 = process.argv[2] || path.join('out', 'preview_1080p60.mp4');
const steps = [
  ['flash', 'check_flash.py'],
  ['sync', 'check_sync.py'],
];

for (const [label, script] of steps) {
  console.log(`[check] ${label}: ${mp4}`);
  const r = runPython([path.join(ROOT, 'tools', script), mp4], { env });
  if (r.status !== 0) {
    console.log('[check] FAIL');
    process.exit(1);
  }
}
console.log('[check] PASS');
