"""4K60 母版：按小段（默认 120 帧＝2 s）渲染，逐段重试，最后 concat 视频 + 单独合成一条连续音轨。

为什么要落到 2 s 一段：本机 4K 走的是 raw RGBA 通道（每帧 33 MB 过 socket），实测浏览器会中途静默退出
（两次分别死在第 420、第 120 帧，事件日志里没有任何崩溃记录）。段越小丢的越少，且每段都重启一次
browser/node 进程，绕开"跑久了就死"。段内带 --mute（静音轨），因为进了 preroll 的段会向 ffmpeg 要负数
时长；音频不跟着段走：每段单独 AAC 编码会在接缝留编码器 priming，2 s 一段会很难听，所以最后用原 WAV
一次性编码一条连续音轨。
"""
import ctypes
import json
import os
import subprocess
import sys
import time

ROOT = r'E:\DCIM\doubaoWS\workspace\world-execute-中文版'
PARTS = os.path.join(ROOT, 'out', '_4k_seg')
FF = r'D:\Program Files\DownKyi-1.6.1\ffmpeg.exe'
FFPROBE = 'ffprobe'
TOTAL, SEG, FPS, PRE = 13017, 120, 60, -5.0
AUDIO = '音頻&歌詞/Mili - world.execute (me) ;.wav'
RETRY = 4


def keep_awake():
    k = ctypes.windll.kernel32
    k.SetThreadExecutionState(0x80000000 | 0x00000001 | 0x00000002)


def frames_of(path):
    r = subprocess.run([FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                        '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path],
                       capture_output=True, text=True)
    try:
        return int(r.stdout.strip())
    except ValueError:
        return -1


def main():
    os.makedirs(PARTS, exist_ok=True)
    prog_path = os.path.join(PARTS, 'progress.json')
    prog = json.load(open(prog_path)) if os.path.exists(prog_path) else {'done': []}
    keep_awake()
    t0 = time.time()
    nseg = (TOTAL + SEG - 1) // SEG
    for f0 in range(0, TOTAL, SEG):
        idx = f0 // SEG
        out = os.path.join(PARTS, f's{idx:03d}.mp4')
        f1 = min(f0 + SEG, TOTAL)
        if idx in prog['done'] and frames_of(out) == f1 - f0:
            continue
        if os.path.exists(out):
            os.remove(out)
        for attempt in range(1, RETRY + 1):
            keep_awake()
            cmd = ['node', os.path.join('export', 'export.mjs'),
                   '--start', f'{PRE + f0 / FPS:.5f}', '--end', f'{PRE + f1 / FPS:.5f}',
                   '--width', '3840', '--height', '2160', '--fps', '60', '--mute',
                   '--out', os.path.relpath(out, ROOT)]
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            if r.returncode == 0 and frames_of(out) == f1 - f0:
                break
            tail = ((r.stderr or '') + (r.stdout or '')).strip().splitlines()
            print(f'[s{idx:03d}] attempt {attempt} failed rc={r.returncode} :: '
                  f'{tail[-1][:110] if tail else "no output"}', flush=True)
            if os.path.exists(out):
                os.remove(out)
            time.sleep(3)
        else:
            print(f'[s{idx:03d}] GAVE UP', flush=True)
            sys.exit(1)
        prog['done'].append(idx)
        json.dump(prog, open(prog_path, 'w'))
        if idx % 10 == 0 or idx == nseg - 1:
            el = (time.time() - t0) / 60
            print(f'[s{idx:03d}] {len(prog["done"])}/{nseg} segs, {f1}/{TOTAL} frames, {el:.1f} min elapsed',
                  flush=True)

    # ---- concat video only ----------------------------------------------------------
    lst = os.path.join(PARTS, 'list.txt')
    segs = sorted(f for f in os.listdir(PARTS) if f.startswith('s') and f.endswith('.mp4'))
    assert len(segs) == nseg, f'segments {len(segs)} != {nseg}'
    with open(lst, 'w', encoding='utf-8') as f:
        for s in segs:
            f.write(f"file '{s}'\n")
    vcat = os.path.join(PARTS, 'video_only.mp4')
    subprocess.check_call([FF, '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
                           '-i', lst, '-an', '-c:v', 'copy', '-y', vcat], cwd=PARTS)
    n = frames_of(vcat)
    print(f'[concat] frames={n} (expect {TOTAL})', flush=True)
    assert n == TOTAL, f'concat frames {n} != {TOTAL}'

    # ---- one continuous audio track + mux -------------------------------------------
    full = os.path.join(ROOT, 'out', 'world_execute_me_4k60.mp4')
    dur = TOTAL / FPS
    lead = int(round(-PRE * 44100))
    subprocess.check_call([FF, '-hide_banner', '-loglevel', 'error',
                           '-i', vcat, '-i', os.path.join(ROOT, AUDIO),
                           '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
                           '-af', f'adelay={lead}S|{lead}S,apad',
                           '-c:a', 'aac', '-b:a', '320k', '-t', f'{dur:.3f}',
                           '-movflags', '+faststart', '-y', full])
    print(f'[mux] {full}  {os.path.getsize(full) / 1048576:.0f} MB', flush=True)


if __name__ == '__main__':
    main()
