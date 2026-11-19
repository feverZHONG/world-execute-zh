"""把「反解出来的取框」真的裁出来，跟旧画板并排看 —— 分数咬得紧的时候，只有眼睛能定。

  python tools/plate_vs.py --plate f_reach --dir out/_lib/cand16 --names Mgirl02_zhenglixiukou,Mgirl02_xiuseyihuo_a,Mgirl02_badao_a
"""
import argparse
import os
import sys

from PIL import Image
from PIL import ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plates import AR, BAK_DIR, ROOT, bbox_of, crop_box, fit   # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plate', required=True)
    ap.add_argument('--dir', default='out/_lib/wr')
    ap.add_argument('--names', required=True)
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    plate = Image.open(a.plate if os.path.sep in a.plate else os.path.join(BAK_DIR, a.plate + '.png')).convert('RGBA')
    H = 460
    W = int(H / AR)
    cols = [('旧 ' + a.plate, plate.resize((W, H), Image.LANCZOS))]
    for n in a.names.split(','):
        p = os.path.join(ROOT, a.dir, n.strip() + '.png')
        src = Image.open(p).convert('RGBA')
        s, z, top, cx = fit(plate, src, AR, coarse=80, fine=160)
        bb = bbox_of(src)
        x, y, cw, ch = crop_box(bb, z, top, cx, AR)
        crop = src.crop((int(x), int(y), int(x + cw), int(y + ch))).resize((W, H), Image.LANCZOS)
        cols.append(('%s  %.1f' % (n.split('_')[-1], s), crop))
    out = Image.new('RGB', (len(cols) * (W + 8), H + 22), (36, 36, 40))
    d = ImageDraw.Draw(out)
    for i, (tag, im) in enumerate(cols):
        out.paste(im, (i * (W + 8), 22), im)
        d.text((i * (W + 8) + 4, 6), tag, fill=(240, 240, 240))
    dst = a.out or os.path.join(ROOT, 'out', '_lib', 'vs_%s.png' % a.plate)
    out.save(dst)
    print(dst)


if __name__ == '__main__':
    main()
