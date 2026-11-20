"""4K60 分段渲染：30 分钟一次整片太脆（上次跑到 6:10 就断了），改成分 12 段，每段约 1,086 帧（18.1 s）。
断在哪段就只重跑那一段；全部完成后用 ffmpeg concat -c copy 无损拼接，再核总帧数与音画同轴。
断点续跑的进度记在 out\\_4k_parts\\progress.json；每次循环顺带 SetThreadExecutionState 挡住系统休眠。
"""
import ctypes
import json
import os
import subprocess
import sys
import time

ROOT = r'E:\DCIM\doubaoWS\workspace\world-execute-中文版'
PARTS = os.path.join(ROOT, 'out', '_4k_parts')
FF = r'D:\Program Files\DownKyi-1.6.1\ffmpeg.exe'
TOTAL, CHUNK = 13017, 1086
PRE = -5.0


def keep_awake():
    k = ctypes.windll.kernel32
    k.SetThreadExecutionState(0x80000000 | 0x00000001 | 0x00000002)   # 连续 / 需要系统 / 需要显示


def song_time(frame):
    return PRE + frame / 60.0


def main():
    os.makedirs(PARTS, exist_ok=True)
    prog_path = os.path.join(PARTS, 'progress.json')
    prog = json.load(open(prog_path)) if os.path.exists(prog_path) else {'done': []}
    t0 = time.time()
    for f0 in range(0, TOTAL, CHUNK):
        idx = f0 // CHUNK
        out = os.path.join(PARTS, f'part_{idx:02d}.mp4')
        if idx in prog['done'] and os.path.exists(out) and os.path.getsize(out) > 0:
            continue
        f1 = min(f0 + CHUNK, TOTAL)
        keep_awake()
        cmd = ['node', os.path.join('export', 'export.mjs'),
               '--start', f'{song_time(f0):.5f}', '--end', f'{song_time(f1):.5f}',
               '--width', '3840', '--height', '2160', '--fps', '60',
               '--out', os.path.relpath(out, ROOT)]
        print(f'[chunk {idx:02d}] frames {f0}..{f1}  song {song_time(f0):.3f}..{song_time(f1):.3f}', flush=True)
        rc = subprocess.call(cmd, cwd=ROOT)
        if rc != 0 or not os.path.exists(out):
            print(f'[chunk {idx:02d}] FAILED rc={rc}', flush=True)
            sys.exit(1)
        prog['done'].append(idx)
        json.dump(prog, open(prog_path, 'w'))
        print(f'[chunk {idx:02d}] ok  {os.path.getsize(out)/1048576:.0f} MB  '
              f'({(time.time()-t0)/60:.1f} min so far)', flush=True)

    # 拼接
    lst = os.path.join(PARTS, 'list.txt')
    parts = sorted(f for f in os.listdir(PARTS) if f.startswith('part_') and f.endswith('.mp4'))
    assert len(parts) == (TOTAL + CHUNK - 1) // CHUNK, f'parts {len(parts)}'
    with open(lst, 'w', encoding='utf-8') as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    full = os.path.join(ROOT, 'out', 'world_execute_me_4k60.mp4')
    subprocess.check_call([FF, '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
                           '-i', lst, '-c', 'copy', '-y', full], cwd=PARTS)
    print(f'[concat] wrote {full}  {os.path.getsize(full)/1048576:.0f} MB', flush=True)


if __name__ == '__main__':
    main()
