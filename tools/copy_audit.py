"""从源码 + 脚本 JSON 里抽出全部中文上屏文案，按来源分组写进 二次创作/文稿/全片文案总表.md。
用法：python tools/copy_audit.py
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
MD = ROOT / '二次创作/文稿/全片文案总表.md'

CJK = re.compile(r'[\u3400-\u9fff]')
LATIN = re.compile(r'[A-Za-z]')
STR = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`", re.S)
COMMENT = re.compile(r'(?<!:)\s*//.*$', re.M)
JSONS = ['docs/archive/v4/chat_script.json', 'docs/archive/v4/errors.json']


def unquote(tok):
    return tok[1:-1].replace('\\n', '⏎').replace('\\t', '→').replace("\\'", "'").replace('\\"', '"')


def scan_js(path):
    code = COMMENT.sub('', path.read_text(encoding='utf-8'))
    got = [unquote(t) for t in STR.findall(code)]
    return [s for s in got if CJK.search(s) and s.strip()]


def walk_json(obj, path=''):
    """产出 (路径, 串)；数组里的字符串按顺序编号。"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_json(v, f'{path}.{k}' if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_json(v, f'{path}[{i}]')
    elif isinstance(obj, str) and CJK.search(obj) and obj.strip():
        yield path, obj


def section_of(path):
    m = re.search(r'sections\[(\d+)\]', path)
    return f'第 {int(m.group(1)) + 1} 节' if m else '（无节）'


def main():
    out = ['# 全片文案总表（机器生成，别手改）', '']
    out.append('> 生成：`python tools\\copy_audit.py`。两个来源：`src\\**\\*.js` 里的中文字符串字面量（注释已剔除）、')
    out.append('> `docs\\archive\\v4\\chat_script.json` 与 `errors.json` 里的全部中文串（按节/节拍归位）。')
    out.append('> 本表只列"会出现在屏幕上的字"，不判 A/B/C 归属；归属口径见 `说明\\角色层.md`。歌词（英文 L0）不在本表。')
    out.append('')

    # 一、脚本 JSON
    for rel in JSONS:
        p = ROOT / rel
        data = json.loads(p.read_text(encoding='utf-8'))
        rows = list(walk_json(data))
        out.append(f'## {rel}（{len(rows)} 条）')
        out.append('')
        for path, s in rows:
            out.append(f'- `{path}` → {s}' + '')
        out.append('')

    # 二、JS 字面量
    out.append('## 源码字面量（<160 条只列中文串）')
    out.append('')
    seen = {}
    for p in sorted(SRC.rglob('*.js')):
        for s in scan_js(p):
            seen.setdefault((p.relative_to(ROOT).as_posix(), s), 0)
            seen[(p.relative_to(ROOT).as_posix(), s)] += 1
    for f in sorted({f for f, _ in seen}):
        items = [(s, n) for (ff, s), n in seen.items() if ff == f]
        out.append(f'### {f}（{len(items)} 条）')
        out.append('')
        for s, n in sorted(items):
            out.append(f'- `{s}`' + (f' ×{n}' if n > 1 else ''))
        out.append('')

    # 三、中英混排：一条串里同时有中文和拉丁字母——最容易出现"一半中文一半英文"的地方
    out.append('## 中英混排串（逐条判：代码 / 歌词 / 单位符号 / 品牌 / 该中文化）')
    out.append('')
    mix_json, mix_js = [], []
    for rel in JSONS:
        data = json.loads((ROOT / rel).read_text(encoding='utf-8'))
        for path, s in walk_json(data):
            if LATIN.search(s):
                mix_json.append((rel, path, s))
    for f in sorted({f for f, _ in seen}):
        for s, n in sorted((s, n) for (ff, s), n in seen.items() if ff == f):
            if LATIN.search(s):
                mix_js.append((f, s, n))
    for rel, path, s in mix_json:
        out.append(f'- `{rel}` `{path}` → {s}')
    for f, s, n in mix_js:
        out.append(f'- `{f}` → `{s}`' + (f' ×{n}' if n > 1 else ''))
    out.append('')

    MD.write_text('\n'.join(out), encoding='utf-8')
    print(f'-> {MD.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
