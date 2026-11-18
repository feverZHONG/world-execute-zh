"""识别每张画板真正取自哪套衣服：把 24 套的 3000 渲图按相对包围盒的取框规则切一遍，
与现画板（备份）比像素差，取最小者。取框规则与 plate_refit.py 同定义：裁切宽 = 包围盒宽 × zoom。
"""
import glob
import os
from PIL import Image
import numpy as np

AR = 1448 / 1086
PLATES = ['f_bust', 'f_profile', 'f_reach', 'f_eye', 'boy_bust', 'man_bust', 'cat_bust', 'cat_paws']
ZOOMS = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9]
TOPS = [0.0, 0.02, 0.05, 0.1]
CXS = [0.45, 0.5, 0.55]
S = 181  # 比对用的小尺寸，够判断内容是否同一张


def thumb(im, box):
    return np.asarray(im.crop(box).resize((S, int(S * AR)), Image.LANCZOS), dtype=np.float32)


def main():
    refs = {}
    for name in PLATES:
        p = f'out/_lib/character_bak/{name}.png'
        im = Image.open(p).convert('RGBA')
        bb = im.getbbox()
        refs[name] = (thumb(im, bb), bb, im.size)

    srcs = sorted(glob.glob('out/_lib/wr/*.png'))
    bbs = {}
    for p in srcs:
        im = Image.open(p).convert('RGBA')
        bbs[p] = (im.getbbox(), im)

    for name in PLATES:
        B, pbb, psize = refs[name]
        m = B[..., 3:4] / 255.0
        best = []
        for p in srcs:
            bb, im = bbs[p]
            bw, bh = bb[2] - bb[0], bb[3] - bb[1]
            for z in ZOOMS:
                cw, ch = bw * z, bw * z * AR
                for top in TOPS:
                    for cx in CXS:
                        x0, y0 = bb[0] + bw * cx - cw / 2, bb[1] + bh * top
                        if x0 < 0 or y0 < 0 or x0 + cw > im.size[0] or y0 + ch > im.size[1]:
                            continue
                        A = thumb(im, (int(x0), int(y0), int(x0 + cw), int(y0 + ch)))
                        s = float((np.abs(A[..., :3] - B[..., :3]) * m).mean())
                        best.append((s, os.path.basename(p), z, top, cx))
        best.sort()
        print(f'--- {name} (现画板 {psize[0]}x{psize[1]})')
        for b in best[:3]:
            print('    score %6.2f  %-22s zoom %.2f top %.2f cx %.2f' % b)


main()
