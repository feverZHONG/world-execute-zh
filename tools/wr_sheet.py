import glob
from PIL import Image, ImageDraw

files = sorted(glob.glob('out/_lib/wr/[0-9][0-9]_*.png'))
W, H = 150, 200
cols = 8
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, (H + 16) * rows), (30, 30, 34))
d = ImageDraw.Draw(sheet)
for i, p in enumerate(files):
    im = Image.open(p).convert('RGBA')
    bb = im.getbbox()
    # 取头肩：包围盒上部 55%
    hh = int((bb[3] - bb[1]) * 0.55)
    c = im.crop((bb[0], bb[1], bb[2], bb[1] + hh))
    c.thumbnail((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 16)
    sheet.paste(c, (x, y + 14), c)
    d.text((x + 2, y + 1), p.split('\\')[-1].replace('.png', ''), fill=(230, 230, 230))
sheet.save('out/_lib/wr_sheet.png')
print('ok', sheet.size)
