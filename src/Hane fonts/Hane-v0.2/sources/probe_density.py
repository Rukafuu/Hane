#!/usr/bin/env python3
"""Measure small-size legibility of candidate Hane ladders against Segoe UI.

Renders the same Portuguese UI string at real interface sizes and reports two
proxies: overall ink coverage, and the share of that ink that actually reaches
solid black (thin hairlines survive as gray smears, which is what reads as
'illegible' at 9-15 px).
"""
import sys, tempfile
from pathlib import Path
import refine_hane as R
from PIL import Image, ImageDraw, ImageFont

TXT = 'Resuma os riscos de migrar para ESM: atenção necessária 4/4 chamadas'
SIZES = [10, 12, 12.5, 15]
SEGOE = [('Segoe UI', 'segoeui.ttf'), ('Segoe UI Semibold', 'segoeuib.ttf')]


def stats(path, size):
    font = ImageFont.truetype(str(path), size)
    box = font.getbbox(TXT)
    w, h = box[2] - box[0] + 12, box[3] - box[1] + 12
    img = Image.new('L', (w, h), 255)
    ImageDraw.Draw(img).text((6 - box[0], 6 - box[1]), TXT, 0, font=font)
    px = img.tobytes()
    ink = [1 - p / 255 for p in px]
    total = sum(ink)
    visible = sum(1 for d in ink if d > 0.06)
    solid = sum(1 for d in ink if d >= 0.7)
    return {'size': size, 'coverage': round(total / len(ink), 4),
            'solid_share': round(solid / max(1, visible), 3)}


def candidates():
    out = []
    windows = Path('C:/Windows/Fonts')
    for label, fn in SEGOE:
        p = windows / fn
        if p.exists():
            out.append((label, p))
    tmp = Path(tempfile.mkdtemp(prefix='hane-probe-'))
    R.OUT = tmp
    for name, (weight, thick, thin, expand) in R.STYLES.items():
        R.build(name, weight, thick, thin, expand)
        out.append((f'Hane 0.3 {name} (current)', tmp / f'HaneSans-{name}.ttf'))
    trials = {'ProbeMedium': (500, 52, 30, 26), 'ProbeRegular': (400, 45, 26, 18),
              'ProbeSemi': (600, 60, 34, 34)}
    for name, (weight, thick, thin, expand) in trials.items():
        R.build(name, weight, thick, thin, expand)
        out.append((f'Hane probe {name} {thick}/{thin}/{expand}', tmp / f'HaneSans-{name}.ttf'))
    return out


if __name__ == '__main__':
    for label, path in candidates():
        row = ' '.join(f"{s['size']}px cov {s['coverage']:.3f} solid {s['solid_share']:.2f}"
                       for s in (stats(path, sz) for sz in SIZES))
        print(f'{label:42} {row}')
