"""按「剪影重合度」反解取框：比梯度法稳，不受画框面积大小影响。

梯度法（plates.py refit）在参考图带黑底时会偏向"取一大块"，因为大画框把误差平均掉了；
这里两边都先取剪影（alpha 或键掉黑底），再用点采样算 IoU —— 姿势不对的画框 IoU 一定低。
全向量化：一次把 33×11×13 个候选一起算。

  python tools/plate_iou.py --plate f_reach --render out/_lib/wr/big_12_西洋棋.png
  python tools/plate_iou.py --plate out/_lib/plate_profile.png --render out/_lib/wr/big_20_誓约终.png
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plates import AR, BAK_DIR, ROOT, bbox_of   # noqa: E402

S = 64                      # 比对用的画框宽（像素）；高 = S*AR


def mask_of(im, thr=128):
    a = np.asarray(im)
    if im.mode in ('RGBA', 'LA') and a.shape[2] == 4:
        return a[:, :, 3] > thr
    lum = a[:, :, :3].astype(np.float32).mean(axis=2)
    return lum > 30


def prep(im, want_mask, pad_mul=1.6):
    """把图缩到「包围盒宽 ≈ want_mask」之后取剪影，后面的候选都在这个尺度上采样。"""
    bb = bbox_of(im)
    k = want_mask / max(1, bb[2] - bb[0])
    if k < 1:
        im = im.resize((max(1, int(im.size[0] * k)), max(1, int(im.size[1] * k))), Image.LANCZOS)
        bb = bbox_of(im)
    return im, np.asarray(mask_of(im)), [b * 1.0 for b in bb]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plate', required=True)
    ap.add_argument('--render', required=True)
    a = ap.parse_args()

    plate = Image.open(a.plate if os.path.isabs(a.plate) or os.path.sep in a.plate
                       else os.path.join(BAK_DIR, a.plate + '.png')).convert('RGBA')
    pm = np.asarray(mask_of(plate.resize((S, int(S * AR)), Image.LANCZOS)))
    src = Image.open(os.path.join(ROOT, a.render) if not os.path.isabs(a.render) else a.render).convert('RGBA')
    src, sm, bb = prep(src, 900)

    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    gy, gx = np.meshgrid((np.arange(int(S * AR)) + 0.5) / (S * AR), (np.arange(S) + 0.5) / S, indexing='ij')

    def run(zs, tops, cxs):
        best = (-1, 0, 0, 0)
        H, W = sm.shape
        for z in zs:
            for top in tops:
                for cx in cxs:
                    cw, ch = bw * z, bw * z * AR
                    x0, y0 = bb[0] + bw * cx - cw / 2, bb[1] + bh * top
                    if x0 < 0 or y0 < 0 or x0 + cw > W or y0 + ch > H:
                        continue
                    sx = (x0 + gx * cw).astype(np.int32)
                    sy = (y0 + gy * ch).astype(np.int32)
                    m = sm[sy, sx]
                    inter = np.logical_and(m, pm).sum()
                    union = np.logical_or(m, pm).sum()
                    s = inter / union if union else 0
                    if s > best[0]:
                        best = (s, z, top, cx)
        return best

    b = run([i / 100 for i in range(20, 131, 4)], [i / 100 for i in range(-20, 31, 5)],
            [i / 100 for i in range(20, 81, 5)])
    b2 = run([b[1] + d / 1000 for d in range(-40, 41, 10)], [b[2] + d / 1000 for d in range(-40, 41, 10)],
             [b[3] + d / 1000 for d in range(-40, 41, 10)])
    s, z, top, cx = b2 if b2[0] > b[0] else b
    cw = bw * z
    print('IoU %.3f  zoom %.3f top %.3f cx %.3f  -> 取框 %dx%d' % (s, z, top, cx, round(cw), round(cw * AR)))
    print('  --zoom %.3f --top %.3f --cx %.3f' % (z, top, cx))


if __name__ == '__main__':
    main()
