# -*- coding: utf-8 -*-
"""art_intake — 收图流水线：把外来的剪影图规整到本片的交付规格与基准构图。

为什么要有这一步：片子里的每个数（regions.json 的关键点、场景里的裁切框、art.js 的
REGISTER 位移）都写在 1086×1448 / f_eye 1254×1254 这套「设计基准」上。换图后如果构图
漂了，裁切会切到别的地方去——不是画得不好，是位置不对。所以图一到，先规整到基准框，
再谈好看不好看。

一条命令做四件事：
  1. 规整：按基线 bbox 把主体放到同一个位置（fit），或只缩放不改构图（asis）
  2. 清通道：alpha<16 的残点清零、>=250 的补成 255（规格要求主体 255、外面 0）
  3. 量墨：三墨/七阶各覆盖多少、有多少像素落在墨之外（换算成占比）
  4. 出报告：与基线比 cx / cy / fw / fh 的偏差，并给 REGISTER 的机械初值

用法：

  # 先看（写到 assets/_intake，不动 assets/character）
  python tools/art_intake.py --src "<收图目录>"

  # 只处理某几张
  python tools/art_intake.py --src "<收图目录>" --keys f_bust,f_eye

  # 图已经自己排好版了，只缩放、不重新构图
  python tools/art_intake.py --src "<收图目录>" --mode asis

  # 三墨之外的颜色一律吸附到最近的墨（图不是严格三墨时用；会变硬边）
  python tools/art_intake.py --src "<收图目录>" --snap

  # 确认没问题后装库（原图会备份到 assets/character_prev/）
  python tools/art_intake.py --src "<收图目录>" --install

  # 规整完直接出进片对比静帧（同一秒，新图 vs 现在这套）
  python tools/art_intake.py --src "<收图目录>" --preview 20,66.5,166.5,170.2

图怎么命名：<key>.png，八张 key 见 NAMES；只交其中几张也行（其余保持原样）。
输入可以是任意尺寸、任意分辨率；只要带透明通道、主体不贴满四边（fit 模式要靠留白找边界）。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES = ['f_bust', 'f_profile', 'f_reach', 'f_eye', 'boy_bust', 'man_bust', 'cat_bust', 'cat_paws']
BASELINE = os.path.join(ROOT, 'docs', 'v4', 'art', 'baseline.json')
# 设计基准（= art.js 的 REF 表）：换图后这些坐标一个数都不用改
REF = {n: (1086, 1448) for n in NAMES}
REF['f_eye'] = (1254, 1254)
# 交付长边下限（规格单第二节）：会做特写的两张要 3000，其余 2000
MIN_LONG = {'f_eye': 3000, 'f_reach': 3000}
# 原图被画布切掉的一边：fit 时贴着这一边放，不要居中（否则会把切口顶进画面）
CUT = {'f_reach': 'bottom', 'cat_paws': 'top', 'f_eye': 'bleed'}
# 三墨（规格单）：交付值，判定的种子
INK3 = np.array([[244, 224, 198], [220, 114, 63], [36, 26, 21]], dtype=np.float32)
INK3_NAME = ['cream', 'orange', 'black']
# 七阶（剪影规格第十节）
INK7 = np.array([[244, 224, 198], [217, 187, 152], [240, 144, 96], [220, 114, 63],
                 [143, 58, 30], [36, 26, 21], [20, 16, 13]], dtype=np.float32)
INK7_FAM = ['cream', 'cream', 'orange', 'orange', 'orange', 'black', 'black']

INK_RADIUS = 40.0          # 与 art.js 载入时同类：离种子 40 以内算这种墨
OUT_RADIUS = 60.0          # 超过这个距离 = 落在墨之外（规格之外的第四种颜色）


def load_rgba(path: str) -> Image.Image:
    im = Image.open(path)
    if im.mode not in ('RGBA', 'LA'):
        raise SystemExit(f'{os.path.basename(path)}：不是带透明通道的图（mode={im.mode}），规格要 PNG-24 + alpha')
    return im.convert('RGBA')


def clean_alpha(a: np.ndarray) -> np.ndarray:
    """alpha<16 的残点清零，>=250 的补成 255（中间的抗锯齿薄带原样留着，规格允许 1–2 px）。"""
    a = a.copy()
    a[a < 16] = 0
    a[a >= 250] = 255
    return a


def measure(px: np.ndarray):
    """量墨与构图。px = (H,W,4) uint8。返回统计字典（与 art_check 同口径）。"""
    a = px[..., 3]
    H, W = a.shape
    solid_m = a >= 250
    ys, xs = np.nonzero(a > 0)
    if len(xs) == 0:
        raise SystemExit('这张图是空的：alpha 全为 0')
    bbox = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))

    rgb = px[::2, ::2, :3].astype(np.float32)                 # 每两个像素取一个，与 art_check 同口径
    keep = solid_m[::2, ::2]
    cols = rgb[keep]                                          # 只算实心像素，一次算完，不逐像素循环
    checked = int(cols.shape[0])
    lv, fam = np.zeros(7, dtype=np.int64), {'cream': 0, 'orange': 0, 'black': 0}
    if checked:
        d3 = np.sqrt(((INK3[None, :, :] - cols[:, None, :]) ** 2).sum(axis=2)).min(axis=1)
        out3 = int((d3 > OUT_RADIUS).sum())
        d7 = np.sqrt(((INK7[None, :, :] - cols[:, None, :]) ** 2).sum(axis=2))
        k = d7.argmin(axis=1)
        near = d7[np.arange(checked), k] <= 24
        np.add.at(lv, k[near], 1)
        for i in range(7):
            fam[INK7_FAM[i]] += int(lv[i])
    else:
        out3 = 0
    total7 = int(lv.sum()) or 1
    levels = [{'rgb': [int(v) for v in INK7[k]], 'fam': INK7_FAM[k], 'share': round(lv[k] / total7 * 100, 1)}
              for k in range(7) if lv[k] / total7 * 100 >= 1.5]
    return {
        'w': W, 'h': H, 'bbox': bbox,
        'dustPct': round(float(((a > 0) & (a < 16)).mean() * 100), 3),
        'softPct': round(float(((a >= 16) & (a < 250)).mean() * 100), 3),
        'solidPct': round(float(solid_m.mean() * 100), 2),
        'outsidePct': round(out3 / max(1, checked) * 100, 2),
        'palette': len(levels), 'levels': levels, 'famShare': fam,
    }


def frame_of(m: dict):
    W, H = m['w'], m['h']
    x, y, w, h = m['bbox']
    return {'cx': round((x + w / 2) / W, 4), 'cy': round((y + h / 2) / H, 4),
            'fw': round(w / W, 4), 'fh': round(h / H, 4)}


def margins_of(m: dict):
    W, H = m['w'], m['h']
    x, y, w, h = m['bbox']
    return {'top': round(y / H * 100, 1), 'bottom': round((H - y - h) / H * 100, 1),
            'left': round(x / W * 100, 1), 'right': round((W - x - w) / W * 100, 1)}


def out_size(name: str, scale: float):
    """输出尺寸：按设计基准 × scale，但长边不低于该 key 的下限（向上取整，免得差 1 px 卡验收）。"""
    dw, dh = REF[name]
    s = max(scale, MIN_LONG.get(name, 2000) / max(dw, dh))
    return int(math.ceil(dw * s)), int(math.ceil(dh * s))


def fit_to_baseline(im: Image.Image, name: str, base: dict, W: int, H: int) -> Image.Image:
    """把主体按基线 bbox 放到同一位置：等比缩放（取宽/高里更紧的那一个），再贴边对齐。"""
    a = np.array(im)[..., 3]
    ys, xs = np.nonzero(a > 0)
    bx, by, bw, bh = int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
    content = im.crop((bx, by, bx + bw, by + bh))

    s = W / REF[name][0]                                  # 设计 px → 输出 px
    tx, ty = base['bbox']['x'] * s, base['bbox']['y'] * s
    tw, th = base['bbox']['w'] * s, base['bbox']['h'] * s
    k = min(tw / bw, th / bh)                              # 等比，两轴都装得下
    nw, nh = max(1, int(round(bw * k))), max(1, int(round(bh * k)))
    content = content.resize((nw, nh), Image.LANCZOS)

    cut = CUT.get(name)
    px = tx + (tw - nw) / 2
    if cut == 'bottom':
        py = ty + th - nh
    elif cut == 'top':
        py = ty
    else:
        py = ty + (th - nh) / 2

    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.paste(content, (int(round(px)), int(round(py))))
    return canvas


def as_is(im: Image.Image, name: str, W: int, H: int) -> Image.Image:
    """不动构图：整张按 cover 缩放到输出尺寸（会把溢出部分切掉）。"""
    s = max(W / im.width, H / im.height)
    nw, nh = int(round(im.width * s)), int(round(im.height * s))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.paste(im2, ((W - nw) // 2, (H - nh) // 2))
    return canvas


def snap_to_inks(im: Image.Image, levels: int) -> Image.Image:
    """把每个像素吸到最近的墨：>=128 的一律变实心纯墨，其余清零。图不是严格三墨时用。"""
    px = np.array(im)
    seeds = INK3 if levels <= 3 else INK7
    a = px[..., 3]
    keep = a >= 128
    rgb = px[..., :3]
    new = np.zeros_like(rgb)
    idx = np.nonzero(keep.ravel())[0]
    flat = rgb.reshape(-1, 3)[idx].astype(np.float32)
    for c0 in range(0, len(idx), 400_000):                    # 分块算，别把整张图乘三份
        chunk = flat[c0:c0 + 400_000]
        best = ((chunk[:, None, :] - seeds[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
        new.reshape(-1, 3)[idx[c0:c0 + 400_000]] = seeds[best].astype(np.uint8)
    out_a = np.where(keep, 255, 0).astype(np.uint8)
    return Image.fromarray(np.dstack([new, out_a]).astype(np.uint8), 'RGBA')


def compare(base: dict, m: dict):
    f, bf = frame_of(m), base['frame']
    return {k: round(f[k] - bf[k], 4) for k in ('cx', 'cy', 'fw', 'fh')}


def register_hint(name: str, base: dict, m: dict):
    """REGISTER 的机械初值：尺度 = 主体高度比，位移 = bbox 中心差（设计 px）。
    这只对「同一个姿势、换了个画法」有效；换了姿势必须靠肉眼/三点配准，不能照抄。"""
    if name in ('f_bust', 'f_profile', 'f_reach', 'f_eye'):
        return None
    s = base['bbox']['h'] / max(1, m['bbox'][3])                 # 新图 px → 设计 px 的尺度
    dx = (base['bbox']['x'] - m['bbox'][0] * s)
    dy = (base['bbox']['y'] - m['bbox'][1] * s)
    return {'scale': round(s, 3), 'dx': round(dx, 1), 'dy': round(dy, 1),
            'note': '初值只对同姿势有效：成交前用 regions.json 的 chin / flower / brooch 三点复核'}


def main():
    ap = argparse.ArgumentParser(description='把外来剪影规整到本片规格与基准构图，并出验收报告')
    ap.add_argument('--src', required=True, help='收图目录（里面放 <key>.png）')
    ap.add_argument('--out', default='assets/_intake', help='规整后的输出目录（默认 assets/_intake）')
    ap.add_argument('--keys', default=','.join(NAMES), help='只处理这几张，逗号分隔')
    ap.add_argument('--mode', choices=['fit', 'asis'], default='fit', help='fit=按基线重新构图；asis=只缩放')
    ap.add_argument('--scale', type=float, default=2.0, help='输出相对设计基准的倍数（默认 2，长边不足下限时自动加大）')
    ap.add_argument('--snap', action='store_true', help='把三墨之外的颜色吸附到最近的墨（硬边化）')
    ap.add_argument('--snap-levels', type=int, choices=[3, 7], default=3, help='吸附到三墨还是七阶（默认三墨）')
    ap.add_argument('--install', action='store_true', help='规整结果覆盖 assets/character（原图备份到 assets/character_prev）')
    ap.add_argument('--preview', default='', help='出进片对比静帧的歌时间，逗号分隔，如 20,166.5')
    ap.add_argument('--report', default='out/art_intake.json', help='报告路径')
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    outdir = os.path.join(ROOT, args.out)
    os.makedirs(outdir, exist_ok=True)
    base_all = json.load(open(BASELINE, encoding='utf-8'))
    keys = [k.strip() for k in args.keys.split(',') if k.strip()]
    unknown = [k for k in keys if k not in NAMES]
    if unknown:
        raise SystemExit(f'不认识的 key: {unknown}；只有 {NAMES}')

    report, todo = {}, []
    for name in keys:
        path = os.path.join(src, name + '.png')
        if not os.path.exists(path):
            print(f'  {name:10s} 跳过（{args.src} 里没有这个文件）')
            continue
        im = load_rgba(path)
        # 先清通道再找边界：残点（alpha<16）本来就不该算进主体，晚清会让主体被估小几 %
        px_clean = np.array(im)
        px_clean[..., 3] = clean_alpha(px_clean[..., 3])
        im = Image.fromarray(px_clean, 'RGBA')
        todo.append(name)
        W, H = out_size(name, args.scale)

        m0 = measure(px_clean)

        stage = fit_to_baseline(im, name, base_all[name], W, H) if args.mode == 'fit' else as_is(im, name, W, H)
        px = np.array(stage)
        px[..., 3] = clean_alpha(px[..., 3])
        if args.snap:
            stage = snap_to_inks(Image.fromarray(px, 'RGBA'), args.snap_levels)
            px = np.array(stage)
            px[..., 3] = clean_alpha(px[..., 3])

        m = measure(px)
        dst = os.path.join(outdir, name + '.png')
        Image.fromarray(px, 'RGBA').save(dst, optimize=True)

        r = {
            'src': os.path.relpath(path, ROOT), 'out': os.path.relpath(dst, ROOT),
            'size': [m['w'], m['h']], 'design': list(REF[name]),
            'bbox': m['bbox'], 'margins': margins_of(m),
            'frame': frame_of(m), 'baselineFrame': base_all[name]['frame'],
            'delta': compare(base_all[name], m),
            'palette': m['palette'], 'levels': m['levels'],
            'outsidePct': m['outsidePct'], 'dustPct': m['dustPct'], 'softPct': m['softPct'],
            'input': {'size': [m0['w'], m0['h']], 'bbox': m0['bbox'], 'frame': frame_of(m0),
                      'palette': m0['palette'], 'outsidePct': m0['outsidePct']},
            'register': register_hint(name, base_all[name], m),
        }
        report[name] = r

        d = r['delta']
        flag = '偏差大' if max(abs(d['cx']), abs(d['cy']), abs(d['fw']), abs(d['fh'])) > 0.05 else 'ok'
        print(f'  {name:10s} {m0["w"]}x{m0["h"]} → {m["w"]}x{m["h"]}  墨 {m["palette"]} 阶 · 墨外 {m["outsidePct"]}% · '
              f'构图差 cx {d["cx"]:+.3f} cy {d["cy"]:+.3f} fw {d["fw"]:+.3f} fh {d["fh"]:+.3f}  [{flag}]')
        if m['outsidePct'] > 0 and not args.snap:
            print(f'             ↑ 有 {m["outsidePct"]}% 的实心像素不在三墨/七阶上：要硬边化就加 --snap')

    os.makedirs(os.path.join(ROOT, os.path.dirname(args.report)), exist_ok=True)
    with open(os.path.join(ROOT, args.report), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f'\n报告：{args.report}（{len(report)} 张）')

    if args.install and report:
        prev = os.path.join(ROOT, 'assets', 'character_prev')
        os.makedirs(prev, exist_ok=True)
        for name in report:
            cur = os.path.join(ROOT, 'assets', 'character', name + '.png')
            if os.path.exists(cur):
                shutil.copy2(cur, os.path.join(prev, name + '.png'))
            shutil.copy2(os.path.join(outdir, name + '.png'), cur)
        print(f'已装库：{len(report)} 张 → assets/character/（原图备份在 assets/character_prev/）')
        print('接着跑：node tools/art_check.mjs（对基线看构图差）；拿不准的三张（boy / man / cat）核对 REGISTER')

    if args.preview:
        times = [t.strip() for t in args.preview.split(',') if t.strip()]
        sheet = os.path.join('out', 'intake_preview.png')
        cmd = ['node', 'export/export.mjs', '--art', args.out, '--sheet', sheet,
               '--times', ','.join(times), '--cols', str(len(times)), '--width', '1280', '--height', '720']
        print('\n进片对比：' + ' '.join(cmd))
        r = subprocess.run(cmd, cwd=ROOT, shell=(os.name == 'nt'))
        if r.returncode == 0:
            print(f'静帧：{sheet}')
            print(f'和现在这套并排看：node export/export.mjs --sheet out/intake_now.png --times {",".join(times)} '
                  f'--cols {len(times)} --width 1280 --height 720')
        else:
            print('出静帧失败，看上面的日志')


if __name__ == '__main__':
    main()
