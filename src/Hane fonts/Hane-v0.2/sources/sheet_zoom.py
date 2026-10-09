#!/usr/bin/env python3
"""2x-upscaled 12.5px proof of one UI phrase per Hane ladder candidate."""
import sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import refine_hane as R

TXT = 'Resuma os riscos de migrar para ESM: Atenção necessária 4/4 chamadas'
tmp = Path(tempfile.mkdtemp(prefix='hane-zoom-'))
R.OUT = tmp
LADDERS = [('Hane Reg 44/16/14', 'Regular', 400, 44, 16, 14),
           ('Hane Med 51/22/28', 'Medium', 500, 51, 22, 28),
           ('Hane Med 51/26/22', 'ProbeA', 500, 51, 26, 22),
           ('Hane Med 51/32/24', 'ProbeB', 500, 51, 32, 24),
           ('Hane Med 50/38/30', 'ProbeC', 500, 50, 38, 30)]
rows = [('Segoe UI 12.5px', ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 12.5))]
for label, style, weight, thick, thin, expand in LADDERS:
    R.build(style, weight, thick, thin, expand)
    rows.append((label, ImageFont.truetype(str(tmp / f'HaneSans-{style}.ttf'), 12.5)))

SCALE, PAD = 2, 14
small = [(label, font.getbbox(TXT)) for label, font in rows]
w = max(b[2] - b[0] for _, b in small) + 2 * PAD
h = sum(38 for _ in rows) + PAD
canvas = Image.new('RGB', (w, h), (241, 242, 244))
d = ImageDraw.Draw(canvas)
tiny = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 8)
y = PAD
for (label, font), (_, b) in zip(rows, small):
    d.text((PAD, y), label, (120, 126, 136), font=tiny)
    d.text((PAD - b[0], y + 13 - b[1]), TXT, (48, 52, 61), font=font)
    y += 38
out = sys.argv[1]
canvas.resize((w * SCALE * 1, h * SCALE), Image.LANCZOS).save(out)
print(canvas.size, out)
