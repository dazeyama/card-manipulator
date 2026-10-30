# Make the card stand's wood texture (decision 229) from the generated image:
# blend its edges so it tiles without a seam, then save it at 1024 and 512
# px as WebP in public/wood/ (High and Low graphics). The GPU builds the rest of each mip chain.
#
#   python devtools/makeWood.py art/wood/raw/cherry.png

import sys
from PIL import Image

BAND = 96  # px of each edge blended into the opposite one

src = Image.open(sys.argv[1]).convert('RGB')
w, h = src.size
img = src.copy()
px, sp = img.load(), src.load()

# Horizontal seam: fade the left band into what lies past the right edge, and so
# on; each edge pixel becomes a mix of itself and its wrapped neighbour.
for y in range(h):
    for i in range(BAND):
        k = 0.5 * (1 - i / BAND)
        a, b = sp[i, y], sp[w - 1 - i, y]
        px[i, y] = tuple(round(a[c] * (1 - k) + b[c] * k) for c in range(3))
        px[w - 1 - i, y] = tuple(round(b[c] * (1 - k) + a[c] * k) for c in range(3))
sp = img.copy().load()
for x in range(w):
    for i in range(BAND):
        k = 0.5 * (1 - i / BAND)
        a, b = sp[x, i], sp[x, h - 1 - i]
        px[x, i] = tuple(round(a[c] * (1 - k) + b[c] * k) for c in range(3))
        px[x, h - 1 - i] = tuple(round(b[c] * (1 - k) + a[c] * k) for c in range(3))

for size in (1024, 512):
    out = img.resize((size, size), Image.LANCZOS)
    path = f'public/wood/cherry-{size}.webp'
    out.save(path, 'WEBP', quality=88, method=6)
    print('saved', path)
