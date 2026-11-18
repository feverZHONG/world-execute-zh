"""在高分辨率渲图里找出现有画板的位置（按结构梯度比对，对平移/缩放敏感），按原生像素重出。"""
import argparse
from PIL import Image
import numpy as np

AR = 1448 / 1086


def edges(img, S, ar):
    g = np.asarray(img.resize((S, int(S * ar)), Image.LANCZOS).convert('L'), dtype=np.float32)
    gx, gy = np.diff(g, axis=1)[:-1, :], np.diff(g, axis=0)[:, :-1]
    return np.sqrt(gx * gx + gy * gy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--plate', required=True)
    ap.add_argument('--out', default='')
    ap.add_argument('--cap', type=int, default=2172)
    ap.add_argument('--ar', type=float, default=AR)
    a = ap.parse_args()
    ar = a.ar

    pim = Image.open(a.plate).convert('RGBA')
    full = Image.open(a.src).convert('RGBA')
    bb = full.getbbox()
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]

    def run(S, zs, tops, cxs):
        E = edges(pim, S, ar)
        best = None
        for z in zs:
            for top in tops:
                for cx in cxs:
                    cw, ch = bw * z, bw * z * ar
                    x0, y0 = bb[0] + bw * cx - cw / 2, bb[1] + bh * top
                    if x0 < 0 or y0 < 0 or x0 + cw > full.size[0] or y0 + ch > full.size[1]:
                        continue
                    A = edges(full.crop((x0, y0, x0 + cw, y0 + ch)), S, ar)
                    s = float(np.abs(A - E).mean())
                    if best is None or s < best[0]:
                        best = (s, z, top, cx)
        return best

    b = run(96, [z / 100 for z in range(50, 81, 2)], [t / 100 for t in range(-3, 16, 2)],
            [c / 100 for c in range(40, 63, 2)])
    s0, z0, t0, c0 = b
    print('  粗搜 score %.2f zoom %.2f top %.2f cx %.2f' % (s0, z0, t0, c0))
    b = run(220, [z0 + d / 1000 for d in range(-20, 21, 4)], [t0 + d / 1000 for d in range(-20, 21, 4)],
            [c0 + d / 1000 for d in range(-20, 21, 4)])
    s, z, top, cx = b

    cw, ch = bw * z, bw * z * ar
    x0, y0 = bb[0] + bw * cx - cw / 2, bb[1] + bh * top
    print('%-14s score %5.2f  zoom %.3f top %.3f cx %.3f  crop %.0f px' % (a.plate.split('\\')[-1], s, z, top, cx, cw))
    if a.out:
        outw = min(a.cap, int(round(cw)))
        c = full.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch)))
        if outw != c.width:
            c = c.resize((outw, int(outw * ar)), Image.LANCZOS)
        c.save(a.out)
        print('   -> %s %dx%d' % (a.out, c.width, c.height))


main()
