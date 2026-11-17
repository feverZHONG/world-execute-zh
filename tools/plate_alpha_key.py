"""给压了黑底的画板补回 alpha。

背景是纯黑（0,0,0），从四条边向内做泛洪，只吃与画面边缘连通的近黑像素，
人物自身的黑色区块（不连边）不动。边缘再做 0.8px 高斯羽化，避免一刀切的锯齿。

用法：python tools/plate_alpha_key.py f_bust f_eye f_reach [--tol 18]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from collections import deque


def key_alpha(im, tol=18):
    a = np.asarray(im.convert("RGB")).astype(np.int16)
    dark = a.max(2) <= tol
    h, w = dark.shape
    seen = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if dark[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if dark[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and dark[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    alpha = np.where(seen, 0, 255).astype(np.uint8)
    am = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.8))
    rgba = im.convert("RGBA")
    rgba.putalpha(am)
    return rgba, seen


def main():
    names = [a for a in sys.argv[1:] if not a.startswith("-")]
    tol = 18
    if "--tol" in sys.argv:
        tol = int(sys.argv[sys.argv.index("--tol") + 1])
    for n in names:
        p = f"assets/character/{n}.png"
        im = Image.open(p)
        if im.mode == "RGBA":
            a = np.asarray(im)[:, :, 3]
            if int(a.min()) == 0:
                print(f"{n}: 已有 alpha，跳过")
                continue
        rgba, seen = key_alpha(im, tol)
        rgba.save(p)
        frac = seen.mean() * 100
        print(f"{n}: 键掉黑底 {frac:.1f}%，写出 RGBA {rgba.size}")


if __name__ == "__main__":
    main()
