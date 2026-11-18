import glob
import os
from PIL import Image, ImageDraw

NAMES = ['f_bust', 'f_eye', 'f_profile', 'f_reach', 'boy_bust', 'man_bust', 'cat_bust', 'cat_paws']
W, H = 320, 427
sheet = Image.new('RGB', (W * 4 + 10, H * 2 + 34), (32, 32, 36))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(NAMES):
    p = 'out/_lib/character_bak/%s.png' % n
    im = Image.open(p).convert('RGBA').resize((W, H), Image.LANCZOS)
    x, y = (i % 4) * (W + 3), (i // 4) * (H + 17)
    sheet.paste(im, (x, y + 15), im)
    d.text((x + 4, y + 2), n, fill=(255, 255, 255))
sheet.save('out/_lib/plates_sheet.png')
print('ok', sheet.size)
