"""反解每张画板的取框参数（zoom/top/cx），再按新尺寸重出。"""
import json
import sys
from PIL import Image
import numpy as np

SRC = {
    'f_bust': 'out/_lib/hnl_bust.png',
    'f_eye': None,
    'f_reach': 'out/_lib/hnl_bust.png',
    'f_profile': 'out/_lib/plate_profile.png',
    'boy_bust': 'out/_lib/plate_boy.png',
    'man_bust': 'out/_lib/plate_man.png',
    'cat_bust': 'out/_lib/plate_cat.png',
    'cat_paws': 'out/_lib/plate_paws.png',
}


def cut(im, bb, w, h, zoom, top, cx):
    bx, by, br, bbot = bb
    bw, bh = br - bx, bbot - by
    cw, ch = bw * zoom, bw * zoom * h / w
    x0, y0 = bx + bw * cx - cw / 2, by + bh * top
    box = (int(round(x0)), int(round(y0)), int(round(x0)) + int(round(cw)), int(round(y0)) + int(round(ch)))
    return im.crop(box).resize((w, h), Image.LANCZOS)


def score(a, b):
    A = np.asarray(a, dtype=np.float32)
    B = np.asarray(b, dtype=np.float32)
    m = (A[..., 3:4] / 255.0)
    d = np.abs(A[..., :3] - B[..., :3]) * m
    return float(d.mean())


def fit(name, src):
    plate = Image.open(f'assets/character/{name}.png').convert('RGBA')
    im = Image.open(src).convert('RGBA')
    bb = im.getbbox()
    if not bb:
        print(name, 'source empty'); return None
    best = None
    for zoom in [round(0.45 + 0.05 * i, 2) for i in range(0, 24)]:
        for top in [0.0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3]:
            for cx in (0.45, 0.5, 0.55):
                c = cut(im, bb, 1086, 1448, zoom, top, cx)
                s = score(plate, c)
                if best is None or s < best[0]:
                    best = (s, zoom, top, cx)
    print(f'{name:10s} {src:28s} score {best[0]:6.2f}  zoom {best[1]}  top {best[2]}  cx {best[3]}')
    return best


if __name__ == '__main__':
    res = {}
    for n, s in SRC.items():
        if not s:
            continue
        b = fit(n, s)
        if b: res[n] = {'src': s, 'score': b[0], 'zoom': b[1], 'top': b[2], 'cx': b[3]}
    json.dump(res, open('out/_lib/plate_fit.json', 'w'), indent=2, ensure_ascii=False)
