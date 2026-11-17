# -*- coding: utf-8 -*-
"""live2d_index — 给「双生视界 Live2D 素材库」建索引，写进工程里。

为什么要索引：这套库有 16 个角色、200 多套模型、1.8 GB，直接翻文件夹选不出「哪一套
进片最像本片的三墨」。索引把每套模型的三件事量成数：**贴图的墨色占比**（米白/橙/黑）、
**贴图规模**（决定能渲多大）、**动作数量**（决定能摆多少姿势）。选模型从翻目录变成看表。

用法：
  python tools/live2d_index.py                       # 扫 assets/live2d_lib（指向素材库的目录联结）
  python tools/live2d_index.py --lib "<素材库路径>"    # 直接指外部路径
  python tools/live2d_index.py --top 20               # 只看墨色最贴前 20 套

产物：
  docs/v4/art/live2d_index.json   全量索引（模型 / 角色两段汇总）
  终端                             按「橙+米白占比、黑占比」排的候选表

墨色判定与 tools/live2d_art.mjs 的 ink 子命令同一套规则（HSV：暗→黑、青蓝→橙、低饱和→米白），
所以表里的占比可以直接当「这套模型渲出来会是什么形状」的预判。
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_LIB = os.path.join(ROOT, 'assets', 'live2d_lib')
OUT = os.path.join(ROOT, 'docs', 'v4', 'art', 'live2d_index.json')
SAMPLE = 192                     # 贴图缩到长边 192 再数颜色，够用且快


def classify(rgb: np.ndarray) -> np.ndarray:
    """rgb: (N,3) 0-255 → 0 透明 / 1 cream / 2 orange / 3 black（与 live2d_art ink 同规则）。"""
    r, g, b = rgb[:, 0] / 255.0, rgb[:, 1] / 255.0, rgb[:, 2] / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    v = mx
    s = np.where(mx == 0, 0, (mx - mn) / np.maximum(mx, 1e-6))
    d = mx - mn
    with np.errstate(divide='ignore', invalid='ignore'):
        hr = 60 * (((g - b) / np.where(d == 0, 1, d)) % 6)
        hg = 60 * (((b - r) / np.where(d == 0, 1, d)) + 2)
        hb = 60 * (((r - g) / np.where(d == 0, 1, d)) + 4)
    h = np.where(mx == r, hr, np.where(mx == g, hg, hb))
    h = np.where(h < 0, h + 360, h)
    lab = np.full(len(rgb), 2, dtype=np.int8)                 # 默认：中间调 → 橙（与工具一致）
    lab[v < 0.30] = 3                                         # 暗 → 黑
    lab[s < 0.20] = 1                                         # 低饱和 → 米白
    lab[(h >= 5) & (h <= 55) & (s < 0.42)] = 1                # 暖白（皮肤）→ 米白
    # 青蓝保留 2（橙）：与 live2d_art ink 的「青蓝发 → 橙墨」同义，先设过的值不覆盖
    cyan = (h >= 150) & (h <= 265) & (s >= 0.12)
    lab[cyan] = 2
    return lab


def texture_stats(path: str):
    """一张贴图 → 覆盖像素数 + 三墨占比。"""
    try:
        im = Image.open(path).convert('RGBA')
    except Exception:
        return None
    orig = list(im.size)                                     # 先记原图尺寸，再缩采样（否则量到的是采样后的 192）
    if max(im.size) > SAMPLE:
        im.thumbnail((SAMPLE, SAMPLE), Image.BILINEAR)
    px = np.array(im)
    a = px[..., 3]
    keep = a >= 32
    rgb = px[..., :3][keep]
    if not len(rgb):
        return None
    lab = classify(rgb)
    total = len(lab)
    return {
        'pixels': int(total),
        'cream': round(float((lab == 1).mean() * 100), 1),
        'orange': round(float((lab == 2).mean() * 100), 1),
        'black': round(float((lab == 3).mean() * 100), 1),
        'texture_px': orig,
    }


def main():
    ap = argparse.ArgumentParser(description='扫双生视界 Live2D 素材库，产墨色索引')
    ap.add_argument('--lib', default=DEFAULT_LIB, help='素材库根目录（默认 assets/live2d_lib）')
    ap.add_argument('--out', default=OUT, help='索引 JSON 路径')
    ap.add_argument('--top', type=int, default=15, help='终端列前几名')
    args = ap.parse_args()

    lib = os.path.abspath(args.lib)
    if not os.path.isdir(lib):
        raise SystemExit(f'素材库不存在：{lib}\n（工程里的 assets/live2d_lib 是一个指向它的目录联结；也要可以 --lib 直接指外部路径）')

    models, chars = [], {}
    for dirpath, _dirs, files in os.walk(lib):
        m3s = [f for f in files if f.endswith('.model3.json')]
        if not m3s:
            continue
        rel = os.path.relpath(dirpath, lib).replace('\\', '/')
        parts = rel.split('/')
        char = parts[0]
        meta = json.load(open(os.path.join(dirpath, m3s[0]), encoding='utf-8'))
        fr = meta.get('FileReferences', {})
        tex = [t for t in (fr.get('Textures') or []) if not t.endswith('.png白ts')]
        motives = fr.get('Motions') or {}
        expressions = fr.get('Expressions') or []
        moc = fr.get('Moc') or ''

        agg = {'cream': 0.0, 'orange': 0.0, 'black': 0.0, 'px': 0, 'tex': 0, 'tex_px': [0, 0]}
        for t in tex:
            st = texture_stats(os.path.join(dirpath, t.replace('/', os.sep)))
            if not st:
                continue
            w = st['pixels']
            for k in ('cream', 'orange', 'black'):
                agg[k] += st[k] * w
            agg['px'] += w
            agg['tex'] += 1
            agg['tex_px'][0] = max(agg['tex_px'][0], st['texture_px'][0])
            agg['tex_px'][1] = max(agg['tex_px'][1], st['texture_px'][1])
        if agg['px']:
            for k in ('cream', 'orange', 'black'):
                agg[k] = round(agg[k] / agg['px'], 1)

        rec = {
            'character': char,
            'model_dir': rel,
            'model3': m3s[0],
            'moc': moc,
            'moc_mb': round(os.path.getsize(os.path.join(dirpath, moc)) / 1048576, 2) if moc and os.path.exists(os.path.join(dirpath, moc)) else None,
            'textures': agg['tex'],
            'texture_max_px': agg['tex_px'],
            'inks': {'cream': agg['cream'], 'orange': agg['orange'], 'black': agg['black']},
            'motions': sum(len(v) for v in motives.values()) if isinstance(motives, dict) else 0,
            'motion_groups': list(motives.keys()) if isinstance(motives, dict) else [],
            'expressions': len(expressions),
            'extra_model3': m3s[1:],
        }
        # 「贴不贴本片三墨」：橙+米白越多越贴（这两墨撑起形体），黑用来读边
        rec['warm_fit'] = round(agg['orange'] + agg['cream'], 1)
        models.append(rec)
        c = chars.setdefault(char, {'models': 0, 'warm_fit': 0.0, 'motions': 0, 'textures': 0})
        c['models'] += 1
        c['warm_fit'] += rec['warm_fit']
        c['motions'] += rec['motions']
        c['textures'] += rec['textures']

    for c in chars.values():
        c['avg_warm_fit'] = round(c['warm_fit'] / max(1, c['models']), 1)
        c['warm_fit'] = round(c['warm_fit'], 1)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump({'lib': lib, 'sampled': SAMPLE, 'models': models, 'characters': chars}, f, ensure_ascii=False, indent=1)

    print(f'模型 {len(models)} 套 / 角色 {len(chars)} 个 → {os.path.relpath(args.out, ROOT)}')
    print(f'\n按「橙+米白占比」排前 {args.top}：')
    print(f'{"套装":52s} {"橙":>5s} {"米白":>5s} {"黑":>5s} {"动作":>4s} {"贴图px":>10s}')
    for r in sorted(models, key=lambda x: -x['warm_fit'])[:args.top]:
        print(f'{r["model_dir"][:52]:52s} {r["inks"]["orange"]:5.1f} {r["inks"]["cream"]:5.1f} '
              f'{r["inks"]["black"]:5.1f} {r["motions"]:4d} {r["texture_max_px"][0]:5d}x{r["texture_max_px"][1]:<4d}')
    print('\n按角色平均：')
    for name, c in sorted(chars.items(), key=lambda kv: -kv[1]['avg_warm_fit']):
        print(f'  {name:8s} 模型 {c["models"]:2d} · 平均橙+米白 {c["avg_warm_fit"]:5.1f}% · 动作 {c["motions"]:3d}')


if __name__ == '__main__':
    main()
