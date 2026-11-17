"""把 text_dump 里的英文串排掉歌词（含打字动画的残片），只留真正的界面/代码文字。"""
import io
import json
import re

dump = json.loads(io.open('out/_lib/text_dump.json', encoding='utf-8').read())
lyr = json.loads(io.open('data/lyrics.json', encoding='utf-8').read())


def flat(o):
    if isinstance(o, str):
        return [o]
    if isinstance(o, list):
        return sum((flat(v) for v in o), [])
    if isinstance(o, dict):
        return sum((flat(v) for v in o.values()), [])
    return []


LYR_LINES = [re.sub(r'\s+', ' ', x).strip().lower() for x in flat(lyr)]
LYR_ALL = ' '.join(LYR_LINES)

rows = {}
for d in dump:
    s = d['s']
    if not re.search(r'[A-Za-z]', s):
        continue
    n = re.sub(r'\s+', ' ', s).strip().lower()
    if not n:
        continue
    if n in LYR_ALL:                       # 歌词整句或整段都在里面
        continue
    if len(n) >= 4 and n in LYR_ALL:       # 打字残片
        continue
    rows.setdefault(s, [0, d['t']])
    rows[s][0] += 1

out = sorted(((v[1], s, v[0]) for s, v in rows.items()))
with io.open('out/_lib/en_left.txt', 'w', encoding='utf-8') as f:
    for t0, s, c in out:
        f.write(f'{t0:8.1f}s  n={c}  [{s}]\n')
print(f'{len(out)} 条 -> out/_lib/en_left.txt')
