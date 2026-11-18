import sys
from PIL import Image

name = sys.argv[1]
hi = sys.argv[2]
old = 'out/_lib/character_bak/%s.png' % name
W, H = 543, 724
sheet = Image.new('RGB', (W * 2 + 8, H), (150, 150, 150))
a = Image.open(hi).convert('RGBA').resize((W, H), Image.LANCZOS)
b = Image.open(old).convert('RGBA').resize((W, H), Image.LANCZOS)
sheet.paste(a, (0, 0), a)
sheet.paste(b, (W + 8, 0), b)
sheet.save('out/_lib/cmp_%s.png' % name)
print('ok', 'out/_lib/cmp_%s.png' % name)
