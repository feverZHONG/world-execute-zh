"""扫 src 里"画到画面上的纯拉丁字面量"（ctx.text / sysLine / caption / pill 等），列出待判清单。
只看不带中文的字面量——带中文的已经由 copy_audit.py 与 copy_lint.py 管住了。
输出按文件分组，行号指源码。
"""
import pathlib, re, sys

CJK = re.compile(r'[\u4e00-\u9fff]')
# ctx.text('...')  /  ctx.text(`...`)  /  sysLine(ctx, '...')  /  caption(..., '...') 等常见绘制入口
CALL = re.compile(r"(?:ctx\.text|ctx\.caption|sysLine|youBubble|pill|label|ctx\.label|drawLabel|monoWord|footOf)\s*\(\s*[^,)]*?,?\s*['\"`]([^'\"`]{1,80})['\"`]")

files = sorted(pathlib.Path('src').rglob('*.js'))
hits = {}
for f in files:
    for n, line in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
        s = line.strip()
        if s.startswith('//') or s.startswith('*'):
            continue
        for m in CALL.finditer(line):
            lit = m.group(1)
            if CJK.search(lit) or not lit.strip():
                continue
            hits.setdefault(str(f), []).append((n, lit))

for f, rows in hits.items():
    print(f)
    for n, lit in rows:
        print(f'   {n}: {lit!r}')
print('files with latin literals:', len(hits))
