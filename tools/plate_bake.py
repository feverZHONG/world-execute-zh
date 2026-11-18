"""按源头最大像素重出画板：取框参数已反解，能出多大就出多大（上限 2172 宽）。

带一个容差：f_bust 当年“裁掉最后一行”，纯参数拟合会有 1 行偏移，所以加 ±6 px 平移搜索。
"""
import json
import sys
from PIL import Image
import numpy as np

CAP = 2172            # 2 倍设计基准，超过这个尺寸对 1080p 没有意义，对 4K 也够
FIT = {
    'f_profile': ('out/_lib/plate_profile.png', 0.6, 0.0, 0.5),
    'boy_bust': ('out/_lib/plate_boy.png', 0.75, 0.0, 0.5),
    'man_bust': ('out/_lib/plate_man.png', 0.75, 0.0, 0.5),
    'cat_bust': ('out/_lib/plate_cat.png', 0.75, 0.0, 0.5),
    'cat_paws': ('out/_lib/plate_paws7.png', 0.9, 0.0, 0.5),
}


def crop_box(im, zoom, top, cx, ar, dx=0, dy=0):
    bb = im.getbbox()
    bx, by, br, bbot = bb
    bw, bh = br - bx, bbot - by
    cw, ch = bw * zoom, bw * zoom * ar
    x0, y0 = bx + bw * cx - cw / 2 + dx, by + bh * top + dy
    return (int(round(x0)), int(round(y0)), int(round(x0 + cw)), int(round(y0 + ch)))


def fit_shift(name, src, zoom, top, cx):
    """在 (±6, ±6) 内微调，取最贴近现画板的一组。"""
    plate = Image.open(f'assets/character/{name}.png').convert('RGBA').resize((271, 361), Image.LANCZOS)
    im = Image.open(src).convert('RGBA')
    B = np.asarray(plate, dtype=np.float32)
    best = None
    for dx in range(-6, 7, 2):
        for dy in range(-6, 7, 2):
            box = crop_box(im, zoom, top, cx, 1448 / 1086, dx, dy)
            c = im.crop(box).resize((271, 361), Image.LANCZOS)
            A = np.asarray(c, dtype=np.float32)
            m = (B[..., 3:4] / 255.0)
            s = float((np.abs(A[..., :3] - B[..., :3]) * m).mean())
            if best is None or s < best[0]:
                best = (s, dx, dy)
    return best


def bake(name, src, zoom, top, cx, dx=0, dy=0):
    im = Image.open(src).convert('RGBA')
    ar = 1448 / 1086
    bx, by, br, bbot = im.getbbox()
    bw = br - bx
    natural = int(round(bw * zoom))                 # 取框在源图里的真实宽度
    w = min(CAP, natural)
    if w < 1086:
        w = 1086                                    # 比现画板还小就保持原尺寸（不降级）
    h = int(round(w * ar))
    box = crop_box(im, zoom, top, cx, ar, dx, dy)
    out = im.crop(box).resize((w, h), Image.LANCZOS)
    out.save(f'assets/character/{name}.png', optimize=True)
    return w, h, natural


if __name__ == '__main__':
    for name, (src, zoom, top, cx) in FIT.items():
        print(name, 'bake ->', bake(name, src, zoom, top, cx), flush=True)
    for name, src, zoom, top, cx in (
        ('f_bust', 'out/_lib/hnl_bust.png', 0.65, 0.02, 0.5),
        ('f_reach', 'out/_lib/hnl_bust.png', 0.45, 0.1, 0.5),
    ):
        s, dx, dy = fit_shift(name, src, zoom, top, cx)
        print(f'{name} shift fit score {s:.2f} dx {dx} dy {dy}', flush=True)
        print(name, 'bake ->', bake(name, src, zoom, top, cx, dx, dy), flush=True)
