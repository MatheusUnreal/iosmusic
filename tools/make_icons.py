"""Gera os ícones do app (rode: python tools/make_icons.py)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "frontend" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

S = 1024
img = Image.new("RGB", (S, S))
px = img.load()
a, b = (255, 94, 126), (255, 164, 94)
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

d = ImageDraw.Draw(img)
ink = (17, 17, 22)
# Nota musical dupla
d.ellipse((250, 600, 450, 760), fill=ink)
d.ellipse((570, 540, 770, 700), fill=ink)
d.rectangle((400, 280, 450, 680), fill=ink)
d.rectangle((720, 220, 770, 620), fill=ink)
d.polygon([(400, 280), (770, 220), (770, 330), (400, 390)], fill=ink)

for size in (180, 192, 512):
    img.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
print("ok", OUT)
