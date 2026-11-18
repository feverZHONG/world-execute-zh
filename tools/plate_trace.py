"""给剩下三张画板找源头：拿候选渲图逐个试取框，先小图快筛再确认。"""
import glob
import os
from PIL import Image
import numpy as np

PLATES = ['f_bust', 'f_reach', 'cat_paws', 'f_eye']
CAND = sorted(glob.glob('out/_lib/*.png'))


def cut(im, bb, w, h, zoom, top, cx):
    bx, by, br, bbot = bb
    bw, bh = br - bx, bbot - by
    cw, ch = bw * zoom, bw * zoom * h / w
    x0, y0 = bx + bw * cx - cw / 2, by + bh * top
    return im.crop((int(round(x0)), int(round(y0)), int(round(x0)) + max(1, int(round(cw))), int(round(y0)) + max(1, int(round(ch)))))


def score(a, b):
    A = np.asarray(a.resize((b.width, b.height), Image.LANCZOS), dtype=np.float32)
    B = np.asarray(b, dtype=np.float32)
    m = (B[..., 3:4] / 255.0)
    return float((np.abs(A[..., :3] - B[..., :3]) * m).mean())


for name in PLATES:
    plate = Image.open(f'assets/character/{name}.png').convert('RGBA')
    small = plate.resize((181, 241), Image.LANCZOS)
    best = None
    for p in CAND:
        try:
            im = Image.open(p)
        except Exception:
            continue
        if im.mode not in ('RGBA', 'LA', 'P'):
            continue
        if max(im.size) < 1500:
            continue
        im = im.convert('RGBA')
        bb = im.getbbox()
        if not bb:
            continue
        for zoom in [round(0.4 + 0.05 * i, 2) for i in range(0, 18)]:
            for top in (0.0, 0.02, 0.05, 0.1):
                for cx in (0.45, 0.5, 0.55):
                    s = score(cut(im, bb, 1086, 1448, zoom, top, cx), small)
                    if best is None or s < best[0]:
                        best = (s, os.path.basename(p), zoom, top, cx, im.size)
    print(f'{name:10s} {best[1]:26s} score {best[0]:6.2f} zoom {best[2]} top {best[3]} cx {best[4]} src {best[5]}', flush=True)
