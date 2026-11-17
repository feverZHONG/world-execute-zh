import json, io, re, sys
from collections import OrderedDict

dump = json.load(io.open('out/_lib/text_dump.json', encoding='utf-8'))
rows = dump if isinstance(dump, list) else dump.get('rows')
seen = OrderedDict()
for r in rows:
    s = (r.get('s') or '')
    if not s.strip():
        continue
    if s not in seen:
        seen[s] = [r.get('t'), 0]
    seen[s][1] += 1
seen[r.get('s')] = seen.get(r.get('s'), [r.get('t'), 0])

word = re.compile(r'[A-Za-z]{3,}')
skip = re.compile(r'^[\s:oO.\'#<>=\-]+$')
out = []
for s, (t, n) in seen.items():
    letter = sum(c.isascii() and c.isalpha() for c in s)
    if letter < 3:
        continue
    if skip.match(s):
        continue
    if letter / max(1, len(s)) < 0.35:
        continue
    if not word.search(s):
        continue
    out.append((float(t) if t else -1, n, s))
out.sort()
for t, n, s in out:
    print(f"{t:8.1f} n={n:<5} {s}")
print(len(out), file=sys.stderr)
