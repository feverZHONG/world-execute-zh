"""用成片帧直接选画板取框：裁一版 -> 出同刻帧 -> 跟改前帧比 PSNR，取最高。

alpha / 亮度这类度量在"贴脸满幅"的取框上是退化的（缩放怎么变，平均差都差不多），
所以最后一步交给成片帧：它就是验收口径本身。

  python tools/plate_pick.py --name f_reach --render out/_lib/wr/reach5760b.png \
      --before out/_lib/pchg/b170 --start 170.20 --zoom 0.430 0.450 0.470 0.490 --cx 0.475
"""
import argparse
import os
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))


def psnr(a, b):
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    m = ((a - b) ** 2).mean()
    return 99.0 if m == 0 else 10 * np.log10(255 ** 2 / m)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', required=True)
    ap.add_argument('--render', required=True)
    ap.add_argument('--before', required=True)
    ap.add_argument('--start', type=float, required=True)
    ap.add_argument('--zoom', nargs='+', type=float, required=True)
    ap.add_argument('--top', nargs='+', type=float, default=[0.0])
    ap.add_argument('--cx', nargs='+', type=float, default=[0.5])
    ap.add_argument('--cap', type=int, default=4000)
    a = ap.parse_args()

    before = Image.open(os.path.join(ROOT, a.before, 'f000.png')).convert('RGB')
    best = None
    for z in a.zoom:
        for t in a.top:
            for c in a.cx:
                subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'plates.py'), 'cut',
                                '--render', a.render, '--name', a.name,
                                '--zoom', '%.4f' % z, '--top', '%.4f' % t, '--cx', '%.4f' % c,
                                '--cap', str(a.cap)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
                tmp = os.path.join(ROOT, 'out', '_lib', 'pick', '%s_%0.3f_%0.3f_%0.3f' % (a.name, z, t, c))
                subprocess.run(['node', os.path.join(ROOT, 'export', 'export.mjs'), '--frame', 'png',
                                '--frames', os.path.relpath(tmp, ROOT), '--start', '%.2f' % a.start,
                                '--end', '%.2f' % (a.start + 0.02)], cwd=ROOT, check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                now = Image.open(os.path.join(tmp, 'f000.png')).convert('RGB')
                p = psnr(before, now)
                print('  zoom %.3f top %.3f cx %.4f -> PSNR %.2f' % (z, t, c, p))
                if best is None or p > best[0]:
                    best = (p, z, t, c)
    print('最佳 PSNR %.2f  --zoom %.4f --top %.4f --cx %.4f' % best)


if __name__ == '__main__':
    main()
