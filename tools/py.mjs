#!/usr/bin/env node
// 跨平台 Python 入口：npm scripts 里不要再写 `.venv\Scripts\python` 这类写死路径。
// 解析顺序：$PYTHON → .venv/bin/python → .venv/Scripts/python.exe → python3 → python
//
//   node tools/py.mjs tools/analyze_audio.py
//
// Windows 与 Linux/macOS 同一套命令；找不到解释器时退出码 127。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function pythonCandidates() {
  const list = [];
  if (process.env.PYTHON) list.push(process.env.PYTHON);
  list.push(
    path.join(ROOT, '.venv', 'bin', 'python'),
    path.join(ROOT, '.venv', 'Scripts', 'python.exe'),
    'python3',
    'python',
  );
  return list;
}

/** 第一个真的能起来（`-c "import sys"` 返回 0）的解释器；都没有则 null。 */
export function resolvePython() {
  for (const c of pythonCandidates()) {
    if (path.isAbsolute(c)) {
      if (existsSync(c)) return c;
      continue;
    }
    const probe = spawnSync(c, ['-c', 'import sys'], { stdio: 'ignore' });
    if (probe.status === 0) return c;
  }
  return null;
}

/** 用解析到的解释器跑脚本，透传 stdio 与退出码；cwd 固定工程根（脚本里的相对路径按根算）。 */
export function runPython(args, { env = process.env, ...rest } = {}) {
  const py = resolvePython();
  if (!py) {
    console.error('[py] 找不到 Python：设 $PYTHON，或在工程根建 .venv（见 README「四、怎么跑」）。');
    return { status: 127, error: null };
  }
  return spawnSync(py, args, { stdio: 'inherit', cwd: ROOT, env, ...rest });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const r = runPython(process.argv.slice(2));
  if (r.error) console.error('[py]', r.error.message);
  process.exit(r.status ?? 1);
}
