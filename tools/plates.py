"""画板工具：从 Live2D 渲图裁出片子用的画板，并把"这张画板从哪来"一并留档。

渲图（tools/live2d_art.mjs render）现在会在 PNG 旁边写一份同名 .json，记下模型、画布、pad/zoom、
motion/t、包围盒。本工具读这份 .json，因此画板可以随时按同一构图重出 —— 2026-11-18 之前
取框参数靠口口相传，结果八张画板与文档记载的套装全部对不上，只能回头拟合。

子命令（代码英文，注释中文）：
  cut    按包围盒相对坐标裁一张画板，写 assets/character/<name>.json 留档
  refit  拿现成画板去拟合渲图，反解出取框参数（旧画板没留参数时的唯一办法）
  pair   旧画板 / 新画板 并排出对照图
  sheet  多张画板拼一张缩略总表
  who    在一堆渲图里找出某张画板最像哪一套
  native 列出所有画板的来源与原生像素

用法：
  python tools/plates.py cut  --render out/_lib/wr/big_16.png --name f_bust --zoom 0.66 --top 0.02
  python tools/plates.py refit --plate out/_lib/character_bak/f_bust.png --render out/_lib/wr/big_16.png --bake f_bust
  python tools/plates.py pair --name f_bust --new out/_lib/hi_f_bust.png
  python tools/plates.py sheet --out out/_lib/plates_sheet.png
  python tools/plates.py who --plate boy_bust --dir out/_lib/wr
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLATE_DIR = os.path.join(ROOT, 'assets', 'character')
BAK_DIR = os.path.join(ROOT, 'out', '_lib', 'character_bak')
AR = 1448 / 1086            # 竖幅画板的默认宽高比（高/宽）
CAP = 2172                  # 成品宽上限 = 2× 设计基准 1086


# ---------- 基础 ----------

def sidecar_of(png):
    p = os.path.splitext(png)[0] + '.json'
    if os.path.exists(p):
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    return None


def bbox_of(im):
    bb = im.getbbox()
    if not bb:
        raise SystemExit('渲图是空的：没有 alpha')
    return bb


def crop_box(bb, zoom, top, cx, ar):
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    cw = bw * zoom
    ch = cw * ar
    return int(round(bb[0] + bw * cx - cw / 2)), int(round(bb[1] + bh * top)), int(round(cw)), int(round(ch))


def thumb(im, box, w, ar):
    return im.crop(box).resize((w, int(w * ar)), Image.LANCZOS)


def edges(img, w, ar):
    g = np.asarray(img.convert('L').resize((w, int(w * ar)), Image.LANCZOS), dtype=np.float32)
    gx, gy = np.diff(g, axis=1)[:-1, :], np.diff(g, axis=0)[:, :-1]
    return np.sqrt(gx * gx + gy * gy)


def fit(reference_im, src_im, ar, coarse=96, fine=220):
    """在 src 里找 reference 的取框参数。两级搜索，按结构（梯度）比对，对平移/缩放敏感。"""
    E = edges(reference_im, coarse, ar)
    bb = bbox_of(src_im)
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]

    def run(S, zs, tops, cxs):
        target = E if S == coarse else edges(reference_im, S, ar)
        best = None
        for z in zs:
            for top in tops:
                for cx in cxs:
                    x, y, cw, ch = crop_box(bb, z, top, cx, ar)
                    if x < 0 or y < 0 or x + cw > src_im.size[0] or y + ch > src_im.size[1]:
                        continue
                    A = edges(src_im.crop((x, y, x + cw, y + ch)), S, ar)
                    s = float(np.abs(A - target).mean())
                    if best is None or s < best[0]:
                        best = (s, z, top, cx)
        return best

    b = run(coarse, [z / 100 for z in range(35, 111, 3)], [t / 100 for t in range(-6, 27, 3)],
            [c / 100 for c in range(38, 64, 2)])
    s0, z0, t0, c0 = b
    b = run(fine, [z0 + d / 1000 for d in range(-30, 31, 5)], [t0 + d / 1000 for d in range(-20, 21, 5)],
            [c0 + d / 1000 for d in range(-20, 21, 5)])
    return b


def write_provenance(name, plate_path, render, params, size, src_px, extra=None):
    src = sidecar_of(render) if render else None
    rec = {
        'kind': 'plate',
        'plate': os.path.relpath(plate_path, ROOT).replace('\\', '/'),
        'size': list(size),
        'crop': {'zoom': round(params[0], 4), 'top': round(params[1], 4), 'cx': round(params[2], 4), 'ar': round(AR, 4)},
        'nativePx': int(src_px),
        'render': os.path.relpath(render, ROOT).replace('\\', '/') if render else None,
        'renderSidecar': src,
        **(extra or {}),
    }
    out = os.path.join(PLATE_DIR, name + '.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return out


# ---------- 子命令 ----------

def cmd_cut(a):
    src = Image.open(a.render).convert('RGBA')
    bb = bbox_of(src)
    x, y, cw, ch = crop_box(bb, a.zoom, a.top, a.cx, a.ar)
    piece = src.crop((x, y, x + cw, y + ch))
    w = min(a.cap, piece.width) if a.cap else piece.width
    if w != piece.width:
        piece = piece.resize((w, int(w * a.ar)), Image.LANCZOS)
    dst = os.path.join(PLATE_DIR, a.name + '.png')
    piece.save(dst)
    print('%s -> %s %dx%d（取框 %dx%d）' % (a.render, dst, piece.width, piece.height, cw, ch))
    print('  留档 ' + write_provenance(a.name, dst, a.render, (a.zoom, a.top, a.cx), piece.size, cw))


def cmd_refit(a):
    plate = Image.open(a.plate).convert('RGBA')
    src = Image.open(a.render).convert('RGBA')
    ar = a.ar
    s, z, top, cx = fit(plate, src, ar)
    bb = bbox_of(src)
    x, y, cw, ch = crop_box(bb, z, top, cx, ar)
    print('score %.2f  zoom %.3f  top %.3f  cx %.3f  -> 取框 %dx%d' % (s, z, top, cx, cw, ch))
    print('  判定：score<5 同一构图；5~15 有几十像素平移；>20 取框/姿势不是一回事')
    if a.bake:
        piece = src.crop((x, y, x + cw, y + ch))
        w = min(a.cap, piece.width)
        if w != piece.width:
            piece = piece.resize((w, int(w * ar)), Image.LANCZOS)
        dst = os.path.join(PLATE_DIR, a.bake + '.png')
        piece.save(dst)
        print('  baked -> %s %dx%d' % (dst, piece.width, piece.height))
        print('  留档 ' + write_provenance(a.bake, dst, a.render, (z, top, cx), piece.size, cw,
                                          {'refitFrom': os.path.relpath(a.plate, ROOT).replace('\\', '/'),
                                           'refitScore': round(s, 2)}))


def cmd_pair(a):
    new = a.new
    if not os.path.exists(new):
        raise SystemExit('没有 ' + new)
    old = os.path.join(BAK_DIR, a.name + '.png')
    W, H = 543, 724
    sheet = Image.new('RGB', (W * 2 + 8, H), (150, 150, 150))
    im = Image.open(new).convert('RGBA').resize((W, H), Image.LANCZOS)
    sheet.paste(im, (0, 0), im)
    old_im = Image.open(old).convert('RGBA').resize((W, H), Image.LANCZOS)
    sheet.paste(old_im, (W + 8, 0), old_im)
    out = a.out or os.path.join(ROOT, 'out', '_lib', 'cmp_%s.png' % a.name)
    sheet.save(out)
    print('ok', out)


def cmd_sheet(a):
    names = a.names.split(',') if a.names else ['f_bust', 'f_eye', 'f_profile', 'f_reach',
                                                'boy_bust', 'man_bust', 'cat_bust', 'cat_paws']
    W, H = 300, 400
    sheet = Image.new('RGB', (W * 4 + 6, (H + 18) * 2), (32, 32, 36))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        p = os.path.join(PLATE_DIR, n + '.png')
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert('RGBA')
        im.thumbnail((W, H))
        x, y = (i % 4) * (W + 2), (i // 4) * (H + 18)
        sheet.paste(im, (x, y + 16), im)
        d.text((x + 2, y + 2), '%s %s' % (n, Image.open(p).size), fill=(235, 235, 235))
    out = a.out or os.path.join(ROOT, 'out', '_lib', 'plates_sheet.png')
    sheet.save(out)
    print('ok', out)


def cmd_who(a):
    plate = Image.open(a.plate if os.path.isabs(a.plate) or os.path.sep in a.plate
                       else os.path.join(BAK_DIR, a.plate + '.png')).convert('RGBA')
    res = []
    for p in sorted(glob.glob(os.path.join(ROOT, a.dir, '[0-9][0-9]_*.png'))):
        s, z, top, cx = fit(plate, Image.open(p).convert('RGBA'), a.ar, coarse=80, fine=120)
        res.append((s, os.path.basename(p), z, top, cx))
    res.sort()
    for r in res[:a.top]:
        print('  %6.2f  %-22s zoom %.2f top %.2f cx %.2f' % r)


def cmd_native(a):
    print('%-12s %-14s %-8s %s' % ('画板', '尺寸', '原生宽', '来源'))
    for p in sorted(glob.glob(os.path.join(PLATE_DIR, '*.png'))):
        name = os.path.basename(p)[:-4]
        rec = sidecar_of(p)
        size = Image.open(p).size
        if not rec:
            print('%-12s %-14s %-8s %s' % (name, '%dx%d' % size, '?', '（无留档，旧版 1086 时期）'))
            continue
        px = rec.get('nativePx')
        if px is None and rec.get('renderSidecar'):
            rs = sidecar_of(os.path.join(ROOT, rec['renderSidecar']))
            if rs and rs.get('bboxW'):
                px = int(round(rs['bboxW'] * rec['crop']['zoom']))
        print('%-12s %-14s %-8s %s (zoom %.2f top %.2f)' % (name, '%dx%d' % size, px if px else '?',
                                                           rec.get('render'), rec['crop']['zoom'], rec['crop']['top']))


def main():
    ap = argparse.ArgumentParser(description='画板工具：裁 / 反解 / 对照 / 总表 / 认人 / 台账')
    sub = ap.add_subparsers(dest='cmd', required=True)

    c = sub.add_parser('cut', help='按包围盒相对坐标裁画板并留档')
    c.add_argument('--render', required=True)
    c.add_argument('--name', required=True)
    c.add_argument('--zoom', type=float, default=0.75)
    c.add_argument('--top', type=float, default=0.0)
    c.add_argument('--cx', type=float, default=0.5)
    c.add_argument('--ar', type=float, default=AR)
    c.add_argument('--cap', type=int, default=CAP)
    c.set_defaults(fn=cmd_cut)

    r = sub.add_parser('refit', help='拿现成画板拟合渲图，反解取框参数')
    r.add_argument('--plate', required=True)
    r.add_argument('--render', required=True)
    r.add_argument('--ar', type=float, default=AR)
    r.add_argument('--bake', default='', help='给个画板名就把结果盖进 assets/character/<名>.png')
    r.add_argument('--cap', type=int, default=CAP)
    r.set_defaults(fn=cmd_refit)

    p = sub.add_parser('pair', help='新旧画板并排对照')
    p.add_argument('--name', required=True)
    p.add_argument('--new', required=True)
    p.add_argument('--out', default='')
    p.set_defaults(fn=cmd_pair)

    s = sub.add_parser('sheet', help='画板缩略总表')
    s.add_argument('--names', default='')
    s.add_argument('--out', default='')
    s.set_defaults(fn=cmd_sheet)

    w = sub.add_parser('who', help='在渲图堆里找这张画板最像哪一套')
    w.add_argument('--plate', required=True)
    w.add_argument('--dir', default='out/_lib/wr')
    w.add_argument('--ar', type=float, default=AR)
    w.add_argument('--top', type=int, default=4)
    w.set_defaults(fn=cmd_who)

    n = sub.add_parser('native', help='画板台账（尺寸 / 原生像素 / 来源）')
    n.set_defaults(fn=cmd_native)

    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
