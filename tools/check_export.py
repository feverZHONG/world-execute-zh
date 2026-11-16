"""导出文件最小自检：ffprobe 元数据 + 音频互相关（成片音轨 vs 源 wav）+ 抽帧。

本机没有 librosa / cv2，上游的 tools/check_sync.py、tools/check_flash.py 跑不起来（它们要 librosa，
check_flash 要 cv2）。这里只做三件用 numpy + ffmpeg 就能做的事：

  1. 时长 / 帧数 / 分辨率 / fps / `comment` 里的 mv_start：确认 preroll 与总长对得上
  2. 音轨滞后：成片音轨与源 wav 做 FFT 互相关，报偏移毫秒（>20 ms 就该查 --start / adelay）
  3. 抽帧：按【歌时间】抽若干张 PNG 落到 out/，人工看一眼（片内时间 = 歌时间 + preroll）

用法：
  python tools/check_export.py out/wem_zh_1080p60.mp4 [--frames 0,45.4,193.5] [--outdir out/check]

歌时间 = 音频起点 0；成片第 0 帧是歌时间 -preroll（config.json safety.preroll）。
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
PRE = float(CFG.get("safety", {}).get("preroll", 0))
FF = "ffmpeg"
FFPROBE = "ffprobe"


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, check=True, **kw)


def probe(mp4):
    r = run([FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(mp4)], text=True)
    d = json.loads(r.stdout)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), {})
    tags = d["format"].get("tags", {})
    mv_start = None
    m = tags.get("comment", "")
    if "mv_start=" in m:
        mv_start = float(m.split("mv_start=")[1].split()[0])
    return {
        "w": int(v["width"]), "h": int(v["height"]),
        "fps": v["r_frame_rate"], "frames": int(v.get("nb_frames", 0)),
        "duration": float(d["format"]["duration"]),
        "audio": f'{a.get("sample_rate")} Hz / {a.get("channels")} ch' if a else "none",
        "mv_start": mv_start,
    }


def pcm(args, ar=8000):
    """decode to mono s16 @ ar via ffmpeg pipe."""
    raw = subprocess.run([FF, "-v", "error", *args, "-ac", "1", "-ar", str(ar), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def lag_seconds(x, y, max_lag=0.5, sr=8000, window=8.0):
    """lag of x against y in seconds (positive = x is later). Linear cross-correlation, both signs."""
    w = min(len(x), len(y), int(window * sr))
    if w < sr:
        return float("nan")
    a = x[:w].copy(); b = y[:w].copy()
    a -= a.mean(); b -= b.mean()
    size = 1 << int(np.ceil(np.log2(2 * w - 1)))
    c = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    lags = np.arange(size)
    lags[lags > size // 2] -= size                      # wrap the second half round to negative lags
    keep = np.abs(lags) <= int(max_lag * sr)
    k = int(lags[keep][np.argmax(c[keep])])
    return k / sr


def main():
    ap = ["--frames", "--outdir", "--audio-window"]
    argv = sys.argv[1:]
    mp4 = Path(argv[0]) if argv and not argv[0].startswith("--") else None
    if mp4 is None:
        print("用法: python tools/check_export.py <mp4> [--frames t1,t2] [--outdir out/check]"); return 2
    frames = []
    if "--frames" in argv:
        frames = [float(t) for t in argv[argv.index("--frames") + 1].split(",") if t.strip()]
    outdir = ROOT / (argv[argv.index("--outdir") + 1] if "--outdir" in argv else "out/check")
    win = float(argv[argv.index("--audio-window") + 1]) if "--audio-window" in argv else 20.0
    outdir.mkdir(parents=True, exist_ok=True)

    info = probe(mp4)
    song_len = float(json.loads((ROOT / CFG["paths"]["features"]).read_text(encoding="utf-8"))["meta"]["duration"])
    print(f"文件        {mp4.name}")
    print(f"画面        {info['w']}x{info['h']} @ {info['fps']}  {info['frames']} 帧")
    print(f"时长        {info['duration']:.3f} s   （应有的 {song_len + PRE:.3f} s = 歌 {song_len:.3f} + preroll {PRE:g}）")
    print(f"音轨        {info['audio']}")
    print(f"mv_start    {info['mv_start']} s  （应 = -{PRE:g}）")

    # audio: film starts at mv_start, the song begins PRE seconds in
    mv = info["mv_start"] if info["mv_start"] is not None else -PRE
    lead = -mv                                   # silence before the song inside the file
    A = pcm(["-ss", f"{lead:.6f}", "-t", str(win), "-i", str(mp4)])
    B = pcm(["-t", str(win), "-i", str(ROOT / CFG["paths"]["audio"])])
    lag = lag_seconds(A, B, max_lag=0.5)
    print(f"音轨滞后    {lag * 1000:+.1f} ms  （正 = 成片的歌比源晚；>20 ms 值得查 --start / adelay）")

    for t in frames:
        v = lead + t                              # film time = song time + preroll
        png = outdir / f"check_{t:g}s.png"
        run([FF, "-y", "-v", "error", "-ss", f"{max(0.0, v):.6f}", "-i", str(mp4), "-frames:v", "1", str(png)])
        print(f"抽帧        {png.relative_to(ROOT)}   （歌 {t:g} s / 片内 {v:.3f} s）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
