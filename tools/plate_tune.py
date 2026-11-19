"""把「新画板」的取框调到跟「旧画板」严丝合缝：在画板空间里直接搜参数。

plate_refit 反解出来的是近似值（梯度法在彩图上有偏），差个几像素在这种极端特写里就是明显位移。
这里不再反解，直接"裁一遍、比一次 alpha"，按 mean|Δalpha| 收敛。

  python tools/plate_tune.py --render out/_lib/wr/reach5760b.png --old f_reach --zoom 0.470 --top 0 --cx 0.475
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plates import AR, BAK_DIR, ROOT, bbox_of, crop_box   # noqa: E402

DW = 1086


def plate_mask(im, w=DW, h=int(DW * AR)):
    """旧版：只比 alpha。紧贴脸的取框 alpha 几乎满幅，scale 上没有梯度，容易漂到错的最小值。"""
    return np.asarray(im.resize((w, h), Image.LANCZOS))[:, :, 3].astype(np.float32) / 255.0


def plate_luma(im, w=DW, h=int(DW * AR)):
    """比亮度（alpha 打底，避免透明区黑底色捣乱）。"""
    sm = im.resize((w, h), Image.LANCZOS)
    arr = np.asarray(sm, dtype=np.float32)
    a = arr[:, :, 3:4] / 255.0
    rgb = arr[:, :, :3] / 255.0
    luma = (rgb[:, :, 0] * 0.299 + rgb[:, :, 1] * 0.587 + rgb[:, :, 2] * 0.114)[:, :, None]
    return (luma * a)[:, :, 0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', required=True)
    ap.add_argument('--old', required=True)
    ap.add_argument('--zoom', type=float, required=True)
    ap.add_argument('--top', type=float, default=0.0)
    ap.add_argument('--cx', type=float, default=0.5)
    ap.add_argument('--rounds', type=int, default=3)
    ap.add_argument('--metric', choices=('alpha', 'luma'), default='luma')
    ap.add_argument('--step', type=float, default=0.012, help='初轮每步（zoom/top/cx 共用，%g）')
    a = ap.parse_args()

    src = Image.open(os.path.join(ROOT, a.render) if not os.path.isabs(a.render) else a.render).convert('RGBA')
    bb = bbox_of(src)
    metric = plate_luma if a.metric == 'luma' else plate_mask
    old = metric(Image.open(os.path.join(BAK_DIR, a.old + '.png')).convert('RGBA'))

    def cost(z, t, c):
        x, y, cw, ch = crop_box(bb, z, t, c, AR)
        if x < 0 or y < 0 or x + cw > src.size[0] or y + ch > src.size[1]:
            return 1e9
        cut = src.crop((int(x), int(y), int(x + cw), int(y + ch)))
        return float(np.abs(metric(cut) - old).mean())

    z, t, c = a.zoom, a.top, a.cx
    best = cost(z, t, c)
    steps = (a.step, a.step, a.step)
    for _ in range(a.rounds):
        dz, dt, dc = steps
        improved = True
        while improved:
            improved = False
            for nz, nt, nc in ((z + dz, t, c), (z - dz, t, c), (z, t + dt, c), (z, t - dt, c),
                               (z, t, c + dc), (z, t, c - dc), (z + dz, t + dt, c + dc), (z - dz, t - dt, c - dc)):
                s = cost(nz, nt, nc)
                if s < best - 1e-5:
                    best, z, t, c, improved = s, nz, nt, nc, True
        steps = tuple(x / 3 for x in steps)
    print('失配 %.5f  --zoom %.4f --top %.4f --cx %.4f' % (best, z, t, c))


if __name__ == '__main__':
    main()
