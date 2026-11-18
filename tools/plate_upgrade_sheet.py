from PIL import Image, ImageDraw

PAIRS = [
    ('f_bust', 'out/_lib/hi_f_bust.png'),
    ('f_eye', 'out/_lib/hi_f_eye.png'),
    ('boy_bust', 'out/_lib/hi_boy_bust.png'),
    ('man_bust', 'out/_lib/hi_man_bust.png'),
    ('cat_bust', 'out/_lib/hi_cat_bust.png'),
]
W, H = 300, 400
cols = 4
sheet = Image.new('RGB', (W * (cols * 2) + 10, H * len(PAIRS) + 20 * len(PAIRS), ), (40, 40, 44))
d = ImageDraw.Draw(sheet)
for i, (name, hi) in enumerate(PAIRS):
    y = i * (H + 22)
    a = Image.open(hi).convert('RGBA')
    a.thumbnail((W, H))
    d.text((2, y), '新 %s' % name, fill=(255, 255, 255))
    sheet.paste(a, (0, y + 18), a)
    b = Image.open('out/_lib/character_bak/%s.png' % name).convert('RGBA')
    b.thumbnail((W, H))
    d.text((W + 6, y), '旧 %s' % name, fill=(255, 220, 160))
    sheet.paste(b, (W + 4, y + 18), b)
sheet = sheet.crop((0, 0, W * 2 + 10, sheet.height))
sheet.save('out/_lib/plate_upgrade.png')
print('ok', sheet.size)
