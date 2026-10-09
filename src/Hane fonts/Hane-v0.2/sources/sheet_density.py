#!/usr/bin/env python3
"""Render a 1:1 UI-size proof sheet so the small-size result can be judged directly."""
import sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import refine_hane as R

TXT = ('Resuma os riscos de migrar para ESM', 'Atenção necessária · 4/4 chamadas',
       'A migração de projetos JavaScript/Node.js para ESM introduz mudanças de sintaxe')
tmp = Path(tempfile.mkdtemp(prefix='hane-sheet-'))
R.OUT = tmp
LADDERS = {'Reg 44/16/14': ('Regular', 400, 44, 16, 14),
           'Med 51/22/28': ('Medium', 500, 51, 22, 28),
           'flat Med 50/32/24': ('ProbeA', 500, 50, 32, 24),
           'flat Med 52/38/30': ('ProbeB', 500, 52, 38, 30),
           'flat Semi 60/40/34': ('ProbeC', 600, 60, 40, 34)}
for name, args in LADDERS.items():
    R.build(*args)

W, H = 1000, 40 * (len(LADDERS) + 1) + 60
img = Image.new('RGB', (W, H), (241, 242, 244))
d = ImageDraw.Draw(img)
y = 14
segoe = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 12.5)
d.text((14, y), ' | '.join(TXT), (65, 73, 85), font=segoe)
d.text((W - 130, y), 'Segoe UI 12.5px', (120, 126, 136), font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 10))
y += 40
for name, (style, *_rest) in LADDERS.items():
    f = ImageFont.truetype(str(tmp / f'HaneSans-{style}.ttf'), 12.5)
    d.text((14, y), ' | '.join(TXT), (65, 73, 85), font=f)
    d.text((W - 190, y), f'Hane {name}', (120, 126, 136), font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 10))
    y += 40
img.save(sys.argv[1] if len(sys.argv) > 1 else tmp / 'sheet.png')
print(img.size)
