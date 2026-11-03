# Make the sleeves' matte texture (decision 366) from the generated image: gray,
# cut to a card's shape (63 x 88), its tones centered on mid gray and spread a
# little so the gradient and grain read once the app tints it with a sleeve's
# color (overlay blending: mid gray leaves the color as it is). Saved as WebP
# at twice the card atlas's slot size in public/sleeves/.
#
#   python devtools/makeSleeve.py art/sleeves/raw/matte.png

import sys
from PIL import Image, ImageOps, ImageStat

W, H = 292, 408  # twice the atlas's 146 x 204
CONTRAST = 1.6   # how far the tones spread from mid gray

src = ImageOps.grayscale(Image.open(sys.argv[1]))
w, h = src.size
# Cut to the card's shape from the middle.
ch = min(h, round(w * 88 / 63))
cw = min(w, round(ch * 63 / 88))
img = src.crop(((w - cw) // 2, (h - ch) // 2, (w - cw) // 2 + cw, (h - ch) // 2 + ch)).resize((W, H), Image.LANCZOS)
mean = ImageStat.Stat(img).mean[0]
img = img.point(lambda v: max(0, min(255, round(128 + (v - mean) * CONTRAST))))
img.save('public/sleeves/matte.webp', 'WEBP', quality=90, method=6)
print('saved public/sleeves/matte.webp', round(mean, 1))
