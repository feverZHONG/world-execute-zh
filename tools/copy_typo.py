"""扫中文串里的排版糙点：半角标点、省略号写法、数字与单位间距、重复空格。只报告，不改。"""
import json, pathlib, re, sys

script = json.loads(pathlib.Path('docs/archive/v4/chat_script.json').read_text(encoding='utf-8'))
errs = json.loads(pathlib.Path('docs/archive/v4/errors.json').read_text(encoding='utf-8'))

CJK = re.compile(r'[\u4e00-\u9fff]')
HALF = re.compile(r'[,:;!?]')
DOTS = re.compile(r'\.\.\.')
SPACE_UNIT = re.compile(r'\d+(?:\.\d+)?(?:克|毫克|赫兹|秒|分钟|小时|条|块|次|个|人|天|米)')


def check(s, where):
    if not CJK.search(s):
        return
    if HALF.search(s):
        print(f'  半角标点  {where}: {s}')
    if DOTS.search(s):
        print(f'  三点省略  {where}: {s}')
    m = SPACE_UNIT.search(s)
    if m:
        print(f'  数字紧贴单位 {where}: {s}')
    if re.search(r'\s{2,}', s):
        print(f'  连续空格  {where}: {s}')


for i, sec in enumerate(script['sections']):
    for j, b in enumerate(sec['beats']):
        for key in ('you', 'ui', 'system', 'me_extra'):
            for s in b.get(key) or []:
                check(s, f'sections[{i}].beats[{j}].{key}')
for c in script.get('cards_section6') or []:
    check(c.get('request') or '', 'cards.request')
    for r in c.get('rows') or []:
        check(r.get('label') or '', 'cards.label')
        check(str(r.get('value') or ''), 'cards.value')
check(script.get('title') or '', 'title')
check(script.get('composer_placeholder') or '', 'placeholder')
for k, v in (script.get('settings_rows') or {}).items():
    for r in v:
        check(str(r.get('label') or ''), f'settings_rows.{k}.label')
for name, e in errs.items():
    if isinstance(e, dict):
        for f in ('title', 'body'):
            if e.get(f):
                check(e[f], f'errors.{name}.{f}')
    elif isinstance(e, list):
        for k, s in enumerate(e):
            for f in ('t', 'body'):
                if s.get(f):
                    check(s[f], f'errors.{name}[{k}].{f}')
print('scan done')
