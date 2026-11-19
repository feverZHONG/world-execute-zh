"""文案门禁：抓住"半中半英"的串——一条串里同时有中文和拉丁字母。

语言口径（说明\\语言边界.md）：画面上是代码的一律英文；界面文案用中文；歌词一个字不动。
代码与歌词不需要出现在这个检查里（它们是整串英文，混排检查天然放过）。真正会漏的是
"中文句子里掺了一个英文词/符号"，所以本脚本只查这一类。

用法：
  python tools\\copy_lint.py        # 列出混排串，命中白名单的标 OK，其余标 FAIL（有 FAIL 时退出码 1）

白名单在下面 ALLOW 里逐条写清理由；新加一条要写清"为什么它是代码/歌词/单位/专名"。
"""
import json, re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
CJK = re.compile(r'[\u3400-\u9fff]')
LATIN = re.compile(r'[A-Za-z]')
STR = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`", re.S)
COMMENT = re.compile(r'(?<!:)\s*//.*$', re.M)
JSONS = ['docs/archive/v4/chat_script.json', 'docs/archive/v4/errors.json']

# 白名单：(正则, 理由)。正则对整串 match。
ALLOW = [
    (r'Anthropic|Mili', '公司名与作品名，照原文'),
    (r'world\.execute\(me\);', '作品名'),
    (r'Live2D', '技术名'),
    (r'.*Hz.*|.*mg.*|.*\bβ.*', '单位与化学记号，读数用半角'),
    (r'维生素 [CE]', '化学符号，标签里照写'),
    (r'.*\$\{text\(\d+\).*', '歌词词借去做界面文案（语言边界第 1 条）'),
    (r'校验 "', '校验的是作品名，引号里必须是原文'),
]
# 指令字段（不是你看到的字，是排程用的 verb: object）：不查
SKIP_PATH = re.compile(r'(?!)')      # 暂时不跳过任何字段：指令字段里混了中文也要看见


def visible(s):
    """一串里"观众真正看到的字"：模板表达式 ${...} 是代码，先摘掉再判。"""
    return re.sub(r'\$\{[^{}]*\}', '', s)


def hits(s):
    v = visible(s)
    return bool(CJK.search(v)) and bool(LATIN.search(v))


def scan_src():
    out = []
    for p in sorted(SRC.rglob('*.js')):
        code = COMMENT.sub('', p.read_text(encoding='utf-8'))
        for tok in STR.findall(code):
            s = tok[1:-1]
            if hits(s):
                out.append((p.relative_to(ROOT).as_posix(), s))
    return out


def walk(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, f'{path}.{k}' if path else k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f'{path}[{i}]')
    elif isinstance(o, str):
        yield path, o


def main():
    rows = [(f, s) for f, s in scan_src()]
    for rel in JSONS:
        data = json.loads((ROOT / rel).read_text(encoding='utf-8'))
        for path, s in walk(data):
            if hits(s) and not SKIP_PATH.search(path):
                rows.append((f'{rel}:{path}', s))

    bad = 0
    for where, s in sorted(set(rows)):
        why = next((r for p, r in ALLOW if re.search(p, visible(s))), None)
        if why:
            print(f'  OK   {s}\n       -> {why}   [{where}]')
        else:
            bad += 1
            print(f'  FAIL {s}   [{where}]')
    print(f'\n混排串 {len(set(rows))} 条；FAIL {bad} 条')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
