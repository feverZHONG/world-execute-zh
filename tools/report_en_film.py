"""把 text_dump.json 里的英文串归类，按首次出现时间排序，转成可读清单。"""
import io
import json
import re

dump = json.loads(io.open('out/_lib/text_dump.json', encoding='utf-8').read())
lyr = json.loads(io.open('data/lyrics.json', encoding='utf-8').read())


def flat_lines(o):
    out = []
    if isinstance(o, str):
        out.append(o)
    elif isinstance(o, list):
        for v in o:
            out += flat_lines(v)
    elif isinstance(o, dict):
        for v in o.values():
            out += flat_lines(v)
    return out


LYR = ' '.join(flat_lines(lyr))
LYR_WORDS = set(re.findall(r"[A-Za-z']+", LYR))


def tc(t):
    return int(t // 60) * 60 + (t % 60) if False else f'{int(t // 60)}:{abs(t) % 60:04.1f}'


rows = {}
for d in dump:
    s = d['s']
    if not re.search(r'[A-Za-z]', s):
        continue
    key = s
    if key not in rows:
        rows[key] = {'n': 0, 't0': d['t'], 'pos': set()}
    rows[key]['n'] += 1
    rows[key]['pos'].add((d['x'] // 200, d['y'] // 120))

out = []
for s, v in rows.items():
    words = set(re.findall(r"[A-Za-z']+", s))
    # 整串都是歌词词（或歌词的碎片）就不列
    if words and all(w in LYR_WORDS for w in words) and len(s) <= 12:
        continue
    out.append((v['t0'], s, v['n'], sorted(v['pos'])[0]))

out.sort()
with io.open('out/_lib/en_film.txt', 'w', encoding='utf-8') as f:
    for t0, s, n, p in out:
        f.write(f'{t0:8.1f}s  n={n:<4} 格{p}  [{s}]\n')
print(f'{len(out)} 条 -> out/_lib/en_film.txt   （原始 {len(dump)} 次绘制）')
