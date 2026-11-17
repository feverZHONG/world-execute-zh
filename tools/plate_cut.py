"""从 Live2D 渲图里裁出项目交付尺寸的画板（默认 1086×1448）。

渲图是透明底、全身或半身；本项目八张画板都是竖幅胸像/半身。裁法是：
宽 = 人物包围盒宽 × zoom，高 = 宽 × 目标比例，顶对齐包围盒顶端再往下压 top 比例。

用法：
  python tools/plate_cut.py --in out/_lib/plate_cat.png --out out/_lib/cut_cat.png
  python tools/plate_cut.py --in X.png --out Y.png --w 1254 --h 1254 --zoom 1.0 --top 0.02
"""
import argparse
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', dest='dst', required=True)
    ap.add_argument('--w', type=int, default=1086)
    ap.add_argument('--h', type=int, default=1448)
    ap.add_argument('--zoom', type=float, default=1.12, help='裁切宽 = 包围盒宽 × zoom')
    ap.add_argument('--top', type=float, default=0.02, help='顶端下压量（相对包围盒高）')
    ap.add_argument('--cx', type=float, default=0.5, help='水平中心（0..1，相对包围盒）')
    ap.add_argument('--debug', action='store_true')
    a = ap.parse_args()

    im = Image.open(a.src).convert('RGBA')
    bb = im.getbbox()
    if not bb:
        raise SystemExit('空图：' + a.src)
    bx, by, br, bbot = bb
    bw, bh = br - bx, bbot - by

    cw = bw * a.zoom
    ch = cw * a.h / a.w
    x0 = bx + bw * a.cx - cw / 2
    y0 = by + bh * a.top

    out = Image.new('RGBA', (a.w, a.h), (0, 0, 0, 0))
    left, top = int(round(x0)), int(round(y0))
    box = (left, top, left + int(round(cw)), top + int(round(ch)))
    piece = im.crop(box).resize((a.w, a.h), Image.LANCZOS)
    out.alpha_composite(piece)
    out.save(a.dst, optimize=True)
    if a.debug:
        print('bbox', bb, '裁切框', box, '->', a.dst)


if __name__ == '__main__':
    main()
