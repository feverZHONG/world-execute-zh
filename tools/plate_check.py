"""画板自检：raw.json 里列出的每张画板必须是带 alpha 的 PNG，且确有透明像素。

黑底画板（RGB 且 alpha 全 255）进片就是一个黑方块，这类错误在联络表里最容易被漏掉，
所以做成命令行检查，出片前跑一次。

用法：python tools/plate_check.py
"""
import json
import os
import sys
from PIL import Image

ART_DIR = "assets/character"


def main():
    with open(os.path.join(ART_DIR, "raw.json"), encoding="utf-8") as f:
        names = json.load(f)
    bad = []
    print(f"{'画板':<14}{'模式':<6}{'尺寸':<14}{'透明占比':>10}")
    for n in names:
        p = os.path.join(ART_DIR, f"{n}.png")
        if not os.path.exists(p):
            print(f"{n:<14}缺文件")
            bad.append(n)
            continue
        im = Image.open(p)
        a = im.convert("RGBA").split()[3]
        hist = a.histogram()
        frac = hist[0] / (im.width * im.height)
        flag = ""
        if im.mode not in ("RGBA", "LA"):
            flag = "  ← 无 alpha 通道（会是黑方块）"
            bad.append(n)
        elif frac <= 0.001:
            flag = "  ← 几乎全不透明（检查是否压了黑底）"
            bad.append(n)
        print(f"{n:<14}{im.mode:<6}{str(im.size):<14}{frac*100:>9.0f}%{flag}")
    if bad:
        print(f"\n不合格：{', '.join(bad)}")
        print("修法：python tools/plate_alpha_key.py <画板名…>")
        return 1
    print("\n全部合格")
    return 0


if __name__ == "__main__":
    sys.exit(main())
