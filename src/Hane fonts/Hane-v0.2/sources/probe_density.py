#!/usr/bin/env python3
"""Compare Hane's small-size ink against Segoe UI at real interface sizes.

Total ink alone is not legibility, but a face that renders below Segoe UI's
coverage at 10-12.5 px is under-filled for the screen. `solid_share` is the
share of visible ink that actually reaches solid black: thin hairlines survive
antialiasing as gray smears, which is what reads as "não está legível".
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

TXT = 'Resuma os riscos de migrar para ESM: Atenção necessária 4/4 chamadas'
SIZES = [10, 12, 12.5, 15]
OUT = Path(__file__).resolve().parent.parent.parent / 'Hane-v0.3'
WINDOWS = Path('C:/Windows/Fonts')
FACES = [('Segoe UI', WINDOWS / 'segoeui.ttf'),
         ('Segoe UI Semibold', WINDOWS / 'segoeuib.ttf')] + \
        [(f'Hane 0.3 {s}', OUT / f'HaneSans-{s}.ttf') for s in ('Regular', 'Medium', 'SemiBold')]


def stats(path, size):
    font = ImageFont.truetype(str(path), size)
    box = font.getbbox(TXT)
    img = Image.new('L', (box[2] - box[0] + 12, box[3] - box[1] + 12), 255)
    ImageDraw.Draw(img).text((6 - box[0], 6 - box[1]), TXT, 0, font=font)
    ink = [1 - p / 255 for p in img.tobytes()]
    visible = sum(1 for d in ink if d > 0.06)
    solid = sum(1 for d in ink if d >= 0.7)
    return sum(ink) / len(ink), solid / max(1, visible)


if __name__ == '__main__':
    for size in SIZES:
        print(f'--- {size} px')
        for label, path in FACES:
            if not path.exists():
                print(f'{label:22} ausente'); continue
            cov, sol = stats(path, size)
            print(f'{label:22} cobertura {cov:.4f}  sólido {sol:.2f}')
