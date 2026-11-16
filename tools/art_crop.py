#!/usr/bin/env python
"""把一张原生立绘裁成剪影位（八张那个尺寸），直接给引擎用——不过滤镜、不重上色。

用法:
    python tools/art_crop.py --src <立绘.png> --out assets/character_raw --spec tools/art_crop_spec.json
    python tools/art_crop.py --src <立绘.png> --out out/_ref --spec tools/art_crop_spec.json --only f_eye --dry

spec 是 JSON:
    {
      "f_bust":   { "box": [x0, y0, x1, y1], "size": [1086, 1448] },   // box = 源图像素；也可写 "box": "head" 这类预置
      "f_eye":    { "box": [..], "size": [1254, 1254] }
    }
"box": null 表示用整张图按 size 等比缩放。
裁完清一遍 alpha<16 的残点（源图边缘的灰白残留），不做别的处理。
"""
import argparse, json, os, sys
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--spec', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()

    im = Image.open(a.src)
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    W, H = im.size
    spec = json.load(open(a.spec, encoding='utf-8'))
    os.makedirs(a.out, exist_ok=True)

    only = [s.strip() for s in a.only.split(',') if s.strip()]
    for name, s in spec.items():
        if only and name not in only:
            continue
        box = s.get('box')
        size = tuple(s.get('size', [1086, 1448]))
        if box is None:
            box = [0, 0, W, H]
        # 归一化（0..1）写法也认
        if all(0 <= v <= 1 for v in box):
            box = [box[0] * W, box[1] * H, box[2] * W, box[3] * H]
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        crop = im.crop((x0, y0, x1, y1))
        if s.get('fit'):
            # 贴着主体收一圈，再按 size 的比例补边——原图里那些白边不该占剪影位
            bb = crop.getchannel('A').getbbox()
            if bb:
                crop = crop.crop(bb)
                w, h = crop.size
                want = size[0] / size[1]
                if w / h > want:                                  # 太宽：上下补
                    nh = int(round(w / want))
                    pad = (nh - h) // 2
                    out = Image.new('RGBA', (w, nh), (0, 0, 0, 0))
                    out.paste(crop, (0, pad))
                else:                                             # 太高：左右补
                    nw = int(round(h * want))
                    pad = (nw - w) // 2
                    out = Image.new('RGBA', (nw, h), (0, 0, 0, 0))
                    out.paste(crop, (pad, 0))
                crop = out
        crop = crop.resize(size, Image.LANCZOS)
        # 清残点：源图边缘常有一圈 alpha 很低的灰白
        px = crop.load()
        for y in range(size[1]):
            for x in range(size[0]):
                if px[x, y][3] < 16:
                    px[x, y] = (0, 0, 0, 0)
        print(f'{name:10s} {x1-x0}x{y1-y0} @({x0},{y0}) -> {size[0]}x{size[1]}')
        if not a.dry:
            p = os.path.join(a.out, f'{name}.png')
            crop.save(p, optimize=True)
            print(f'           {p}  {os.path.getsize(p)//1024} KiB')


if __name__ == '__main__':
    sys.exit(main())
