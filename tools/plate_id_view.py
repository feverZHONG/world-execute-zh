import sys
from PIL import Image
import numpy as np

AR = 1448 / 1086
S = 271


def best_fit(src, plate, zooms, tops, cxs):
    pim = Image.open(plate).convert('RGBA')
    B = np.asarray(pim.crop(pim.getbbox()).resize((S, int(S * AR)), Image.LANCZOS), dtype=np.float32)
    m = B[..., 3:4] / 255.0
    im = Image.open(src).convert('RGBA')
    bb = im.getbbox()
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    best = None
    for z in zooms:
        for top in tops:
            for cx in cxs:
                cw, ch = bw * z, bw * z * AR
                x0, y0 = bb[0] + bw * cx - cw / 2, bb[1] + bh * top
                if x0 < 0 or y0 < 0:
                    continue
                box = (int(x0), int(y0), int(x0 + cw), int(y0 + ch))
                A = np.asarray(im.crop(box).resize((S, int(S * AR)), Image.LANCZOS), dtype=np.float32)
                s = float((np.abs(A[..., :3] - B[..., :3]) * m).mean())
                if best is None or s < best[0]:
                    best = (s, z, top, cx, im, bb)
    return best, pim, B


def side_by_side(src, plate, out, zooms, tops, cxs):
    best, pim, B = best_fit(src, plate, zooms, tops, cxs)
    s, z, top, cx, im, bb = best
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    cw, ch = bw * z, bw * z * AR
    x0, y0 = int(bb[0] + bw * cx - cw / 2), int(bb[1] + bh * top)
    A = im.crop((x0, y0, x0 + int(cw), y0 + int(ch))).resize((543, 724), Image.LANCZOS)
    bimg = pim.crop(pim.getbbox()).resize((543, 724), Image.LANCZOS)
    bg = Image.new('RGB', (1096, 724), (150, 150, 150))
    bg.paste(A, (0, 0), A)
    bg.paste(bimg, (553, 0), bimg)
    bg.save(out)
    print('%-10s score %6.2f  zoom %.2f top %.2f cx %.2f -> %s' % (plate.split('\\')[-1], s, z, top, cx, out))


if __name__ == '__main__':
    zooms = [z / 100 for z in range(35, 96, 5)]
    tops = [t / 100 for t in range(0, 21, 2)]
    cxs = [c / 100 for c in range(35, 66, 3)]
    for name, src in (('f_bust', 'out/_lib/wr/12_西洋棋.png'), ('boy_bust', 'out/_lib/wr/15_红夹克.png'),
                      ('man_bust', 'out/_lib/wr/04_训练服.png')):
        side_by_side(src, 'out/_lib/character_bak/%s.png' % name, 'out/_lib/id_%s.png' % name, zooms, tops, cxs)
