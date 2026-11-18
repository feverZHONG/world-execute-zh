import numpy as np
from PIL import Image


def crop(src, zoom=0.75, top=0.0, cx=0.5, w=1086):
    im = Image.open(src).convert('RGBA')
    bb = im.getbbox()
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    cw, ch = bw * zoom, bw * zoom * 1448 / 1086
    x0, y0 = bb[0] + bw * cx - cw / 2, bb[1] + bh * top
    box = (int(x0), int(y0), int(x0 + cw), int(y0 + ch))
    return im.crop(box).resize((w, int(w * 1448 / 1086)), Image.LANCZOS)


def sharp(img):
    a = np.asarray(img.convert('L'), dtype=np.float32)
    gx, gy = np.diff(a, axis=1), np.diff(a, axis=0)
    return float(np.sqrt((gx[:-1, :] ** 2 + gy[:, :-1] ** 2) / 2).mean())


a = crop('out/_lib/plate_boy.png')      # 3000 渲图 -> 1086
b = crop('out/_lib/big_boy9.png')       # 5760 渲图 -> 1086
print('3000 -> 1086 edge %.2f' % sharp(a))
print('5760 -> 1086 edge %.2f' % sharp(b))
bg = Image.new('RGB', (1086 * 2 + 10, 1448), (210, 210, 210))
bg.paste(a, (0, 0), a)
bg.paste(b, (1096, 0), b)
bg.save('out/_lib/src_cmp.png')
for nm, img in (('a', a), ('b', b)):
    img.crop((330, 260, 730, 520)).resize((800, 520), Image.NEAREST).save('out/_lib/eye_%s.png' % nm)
print('ok')
