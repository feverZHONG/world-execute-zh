"""在 24 套 3000 渲图里，按结构梯度给一张画板找最像的套装（粗定位，只看谁是谁）。"""
import glob
import sys
from PIL import Image
import numpy as np

AR = 1448 / 1086
name = sys.argv[1]
ar = float(sys.argv[2]) if len(sys.argv) > 2 else AR

plate = Image.open('out/_lib/character_bak/%s.png' % name).convert('RGBA')


def edges(img, S, ar):
    g = np.asarray(img.resize((S, int(S * ar)), Image.LANCZOS).convert('L'), dtype=np.float32)
    gx, gy = np.diff(g, axis=1)[:-1, :], np.diff(g, axis=0)[:, :-1]
    return np.sqrt(gx * gx + gy * gy)


S = 96
E = edges(plate, S, ar)
res = []
for p in sorted(glob.glob('out/_lib/wr/[0-9][0-9]_*.png')):
    im = Image.open(p).convert('RGBA')
    bb = im.getbbox()
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    best = None
    for z in [z / 100 for z in range(35, 106, 5)]:
        for top in [t / 100 for t in range(-5, 26, 5)]:
            for cx in [c / 100 for c in range(40, 62, 4)]:
                cw, ch = bw * z, bw * z * ar
                x0, y0 = bb[0] + bw * cx - cw / 2, bb[1] + bh * top
                if x0 < 0 or y0 < 0 or x0 + cw > im.size[0] or y0 + ch > im.size[1]:
                    continue
                A = edges(im.crop((x0, y0, x0 + cw, y0 + ch)), S, ar)
                s = float(np.abs(A - E).mean())
                if best is None or s < best[0]:
                    best = (s, z, top, cx)
    res.append((best[0], p.split('\\')[-1], best[1], best[2], best[3]))

res.sort()
print('==', name)
for r in res[:4]:
    print('  %6.2f  %-20s zoom %.2f top %.2f cx %.2f' % r)
