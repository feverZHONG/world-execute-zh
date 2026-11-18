"""Compare the delivered film against lossless-ish reference frames (no scipy/cv2 on this machine)."""
import sys
import numpy as np
from PIL import Image


def load(p):
    return np.asarray(Image.open(p).convert('RGB'), dtype=np.float64)


def psnr(a, b):
    mse = ((a - b) ** 2).mean()
    return 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)


def box(img, r):
    """Mean over a (2r+1)^2 window, via cumulative sums (no scipy)."""
    p = np.pad(img, r, mode='reflect')
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / (k * k)


def ssim(a, b, r=5):
    """Mean SSIM over the luma plane (gaussian-free box window)."""
    x = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2])
    y = (0.299 * b[..., 0] + 0.587 * b[..., 1] + 0.114 * b[..., 2])
    mx, my = box(x, r), box(y, r)
    sxx = box(x * x, r) - mx * mx
    syy = box(y * y, r) - my * my
    sxy = box(x * y, r) - mx * my
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    m = ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))
    return float(m[8:-8, 8:-8].mean())


for tag in sys.argv[1:]:
    a = load(f'out/_lib/ref_{tag}.png')
    b = load(f'out/_lib/film_{tag}.png')
    assert a.shape == b.shape, (a.shape, b.shape)
    d = np.abs(a - b)
    lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2])
    dark = lum < 40
    print(f'{tag:>6}  PSNR {psnr(a, b):5.2f} dB   SSIM {ssim(a, b):.4f}   '
          f'mean|d| {d.mean():5.2f}  p99 {np.percentile(d, 99):5.1f}  max {d.max():5.0f}   '
          f'dark% {dark.mean() * 100:4.1f}  dark|d| {d[dark].mean() if dark.any() else 0:5.2f}   '
          f'RGB drift {[round(float((b[..., i] - a[..., i]).mean()), 2) for i in range(3)]}')
