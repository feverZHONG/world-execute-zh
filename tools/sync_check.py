"""check_sync 的替身：只查「音画同轴」这件事——mp4 里的声轨相对原曲是否正好前置 preroll（5 s）。
用 ffmpeg 把两条音轨解成 22050 Hz 单声道 wav，算 10 ms 步长的 RMS 包络，做互相关求延迟。
落盘全部在 out/_lib/dbg（不碰 C 盘）。
"""
import json
import subprocess
import wave

import numpy as np

FF = r'D:\Program Files\DownKyi-1.6.1\ffmpeg.exe'
MP4 = r'out\preview_1080p60.mp4'
SRC = json.load(open('config.json', encoding='utf-8'))['paths']['audio']
OUT = 'out/_lib/dbg'


def load(path, tmp, extra=()):
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', *extra, '-i', path,
                    '-ac', '1', '-ar', '22050', '-f', 'wav', '-y', tmp], check=True)
    w = wave.open(tmp, 'rb')
    n = w.getnframes()
    a = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    w.close()
    return a


def env(a, hop=220):
    m = len(a) // hop * hop
    r = np.sqrt((a[:m].reshape(-1, hop) ** 2).mean(axis=1) + 1e-12)
    r = r - r.mean()
    return r


mp4 = load(MP4, f'{OUT}/sync_mp4.wav')
src = load(SRC, f'{OUT}/sync_src.wav')
e1, e2 = env(mp4), env(src)
n = 1 << int(np.ceil(np.log2(len(e1) + len(e2))))

# 只看前 70 s（含 preroll 与第一段副歌，信号最强），避免整曲循环导致的相关峰混淆
k = 7000
c = np.fft.irfft(np.fft.rfft(e1[:k], n) * np.conj(np.fft.rfft(e2[:k], n)), n)
lag = int(np.argmax(c[:len(c) // 2]))          # mp4 相对原曲的延迟（包络帧）
step = 220 / 22050.0
print(f'mp4 时长 {len(mp4)/22050:.3f} s，原曲 {len(src)/22050:.3f} s')
print(f'互相关峰 lag = {lag} 帧 = {lag*step:.3f} s（应为 +5.000 s，即 preroll）')
print(f'偏差 {lag*step - 5.0:+.3f} s')
