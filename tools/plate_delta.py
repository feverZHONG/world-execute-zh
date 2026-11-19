"""量新旧画板之间的构图差（DESIGN px），并把 REGISTER 的修正值算出来。

换画板（1086 -> 5760 重出）之后，画板里的"内容"相对设计基准挪了几十像素；
REGISTER 的 dx/dy 是按旧画板量的，如果不修，match cut 时脸会横向跳。

本工具把旧画板（out/_lib/character_bak）和新画板都缩到设计基准 1086x1448，
在 alpha 掩膜上做小范围平移/缩放搜索（先粗后细），返回 new = old + (dx, dy) 以及缩放 s，
再给出修正后的 REGISTER：[1/s, dx_old - dx, dy_old - dy]。

  python tools/plate_delta.py --name boy_bust --old -10 0
"""
import argparse
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLATE_DIR = os.path.join(ROOT, 'assets', 'character')
BAK_DIR = os.path.join(ROOT, 'out', '_lib', 'character_bak')
DW, DH = 1086, 1448


def mask(path, w=DW, h=DH):
    im = Image.open(path).convert('RGBA').resize((w, h), Image.LANCZOS)
    a = np.asarray(im)[:, :, 3].astype(np.float32) / 255.0
    return a


def shifted(a, dx, dy):
    """把 a 平移 (dx, dy)（正向 = 内容往右/下），越界处补 0。"""
    out = np.zeros_like(a)
    xs0, xs1 = max(0, dx), min(a.shape[1], a.shape[1] + dx)
    ys0, ys1 = max(0, dy), min(a.shape[0], a.shape[0] + dy)
    out[ys0:ys1, xs0:xs1] = a[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


def score(old, new):
    return float(np.abs(old - new).mean())


def _shift_score(small_old, small_new, s, dx, dy):
    h, w = small_old.shape
    o = np.asarray(Image.fromarray((small_old * 255).astype(np.uint8)).resize(
        (max(2, int(w * s)), max(2, int(h * s))), Image.BILINEAR), dtype=np.float32) / 255.0
    hh, ww = min(h, o.shape[0]), min(w, o.shape[1])
    x0, y0 = (w - ww) // 2 + dx, (h - hh) // 2 + dy
    if x0 < 0 or y0 < 0 or x0 + ww > w or y0 + hh > h:
        return 1e9
    pad = np.zeros_like(small_old)
    pad[y0:y0 + hh, x0:x0 + ww] = o[:hh, :ww]
    return float(np.abs(small_new - pad).mean())


def fit(old_img, new_img):
    """返回 (s, dx, dy, score)：new ≈ s 倍缩放的 old 平移到 (dx, dy)，单位是 DESIGN px。

    两级：先在 1/4 分辨率上宽范围粗搜（±80 x / ±56 y），再回设计分辨率逐像素细搜。
    换画板带来的差通常是"几十像素的平移 + 百分之几的缩放"。
    """
    q = 4
    so = np.asarray(Image.fromarray((old_img * 255).astype(np.uint8)).resize(
        (old_img.shape[1] // q, old_img.shape[0] // q), Image.BILINEAR), dtype=np.float32) / 255.0
    sn = np.asarray(Image.fromarray((new_img * 255).astype(np.uint8)).resize(
        (new_img.shape[1] // q, new_img.shape[0] // q), Image.BILINEAR), dtype=np.float32) / 255.0

    best = (1.0, 0, 0, 1e9)
    for s in [k / 100 for k in range(94, 107)]:                       # ±6% 缩放，步 1%
        for dy in range(-14, 15, 2):
            for dx in range(-20, 21, 2):
                sc = _shift_score(so, sn, s, dx, dy)
                if sc < best[3]:
                    best = (s, dx, dy, sc)
    s0 = best[0]
    for s in [s0 - 0.005, s0, s0 + 0.005]:                            # 1/4 像素级再收一格
        for dy in range(best[2] - 2, best[2] + 3):
            for dx in range(best[1] - 2, best[1] + 3):
                sc = _shift_score(so, sn, s, dx, dy)
                if sc < best[3]:
                    best = (s, dx, dy, sc)

    fine = (best[0], best[1] * q, best[2] * q, 1e9)                    # 回设计分辨率细搜
    for s in (best[0] - 0.005, best[0], best[0] + 0.005):
        o = np.asarray(Image.fromarray((old_img * 255).astype(np.uint8)).resize(
            (int(old_img.shape[1] * s), int(old_img.shape[0] * s)), Image.LANCZOS), dtype=np.float32) / 255.0
        h, w = old_img.shape
        hh, ww = min(h, o.shape[0]), min(w, o.shape[1])
        for dy in range(fine[2] - 6, fine[2] + 7, 2):
            for dx in range(fine[1] - 6, fine[1] + 7, 2):
                pad = np.zeros_like(old_img)
                x0, y0 = (w - ww) // 2 + dx, (h - hh) // 2 + dy
                if x0 < 0 or y0 < 0 or x0 + ww > w or y0 + hh > h:
                    continue
                pad[y0:y0 + hh, x0:x0 + ww] = o[:hh, :ww]
                sc = score(new_img, pad)
                if sc < fine[3]:
                    fine = (s, dx, dy, sc)
    return fine


def head_anchor(m, y0=0.06, y1=0.42):
    """头部锚点：在 y0..y1 这条带里量 alpha 的「头顶、水平重心、宽」。

    换套装会改衣服轮廓，但同一模型的头在这条带里的位置几乎不变 —— 所以拿它当配准基准，
    比整张 alpha 掩膜互搜可靠（后者会被换装/换姿势带偏）。
    """
    band = m[int(m.shape[0] * y0):int(m.shape[0] * y1)]
    cols = band.sum(axis=0)
    rows = band.sum(axis=1)
    xs = np.where(cols > band.shape[0] * 0.02)[0]
    ys = np.where(rows > band.shape[1] * 0.02)[0]
    if not len(xs) or not len(ys):
        return None
    cx = float((np.arange(band.shape[1]) * cols).sum() / cols.sum())
    return {'top': float(ys[0]), 'cx': cx, 'w': float(xs[-1] - xs[0])}


def cmd_head(a):
    for tag, p in (('old', os.path.join(BAK_DIR, a.name + '.png')),
                   ('new', a.new_plate or os.path.join(PLATE_DIR, a.name + '.png'))):
        m = mask(p)
        h = head_anchor(m)
        print('  %-3s 顶 %6.1f  重心 x %7.1f  宽 %6.1f' % (tag, h['top'], h['cx'], h['w']))
    mo, mn = mask(os.path.join(BAK_DIR, a.name + '.png')), mask(a.new_plate or os.path.join(PLATE_DIR, a.name + '.png'))
    ho, hn = head_anchor(mo), head_anchor(mn)
    s = hn['w'] / ho['w']
    dx, dy = hn['cx'] - ho['cx'], hn['top'] - ho['top']
    print('%s: 头 缩放 %.3f  平移 (%+.1f, %+.1f) design px' % (a.name, s, dx, dy))
    ns = a.old[0] / s
    print('  修正 REGISTER: [%.2f, %+.0f, %+.0f]' % (ns, a.old[1] - dx, a.old[2] - dy))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', required=True)
    ap.add_argument('--old', nargs=3, type=float, default=[1.0, 0, 0], metavar=('SCALE', 'DX', 'DY'),
                    help='现有 REGISTER（旧画板上量的）')
    ap.add_argument('--new-plate', default='')
    ap.add_argument('--band', type=float, default=0.45, help='只比头肩带（占画板高度的比例），衣服换了不影响')
    ap.add_argument('--head', action='store_true', help='用头部锚点（头顶 / 水平重心 / 头宽）而不是整图互搜')
    a = ap.parse_args()

    if a.head:
        cmd_head(a)
        return

    old_p = os.path.join(BAK_DIR, a.name + '.png')
    new_p = a.new_plate or os.path.join(PLATE_DIR, a.name + '.png')
    m_old, m_new = mask(old_p), mask(new_p)
    band = int(m_old.shape[0] * a.band)
    m_old_b, m_new_b = m_old[:band], m_new[:band]          # 只拿头肩带比：换套装会改衣服轮廓，但不改头的位置
    s, dx, dy, sc = fit(m_old_b, m_new_b)
    print('%s: 头肩带内 new ≈ old 缩放 %.3f 平移 (%+.1f, %+.1f) design px  失配 %.4f' % (a.name, s, dx, dy, sc))
    ns = a.old[0] / s
    ndx, ndy = a.old[1] - dx, a.old[2] - dy
    print('  修正 REGISTER: [%.2f, %+.0f, %+.0f]' % (ns, ndx, ndy))


if __name__ == '__main__':
    main()
