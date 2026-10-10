#!/usr/bin/env python3
"""Hane 0.4: automated checks and specimen for the robust text cut.

Adds the check that the 0.3 release lacked: the eight hand-drawn letters are
measured against the nib-generated alphabet, because a uniform expansion of the
drawn contours hides an internal gap (n/m carried a 18u wall next to a 74u one).
"""
from pathlib import Path
import json
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent
PREV = ROOT.parent.parent / 'Hane-v0.2'
REF_03 = ROOT.parent.parent / 'Hane-v0.3'
STYLES = ['Regular', 'Medium', 'SemiBold']
RENDER_SIZES = [16, 24, 48, 160, 360]
INK_TEST = 'Inteligencia com leveza 0123'
DRAWN = 'hanemrli'
GENERATED = 'oscptdubfg'
SCAN_Y = 200  # units above baseline: inside x-height, away from shoulders
BG = (242, 239, 231)
INK = (46, 58, 52)
LABEL = (138, 144, 137)
RULE = (214, 209, 196)

_faces = {}


def face(style, size):
    key = (style, size)
    if key not in _faces:
        _faces[key] = ImageFont.truetype(str(OUT / f'HaneSans-{style}.ttf'), size)
    return _faces[key]


def kerning_pairs(font):
    if 'GPOS' not in font:
        return 0
    count = 0
    for lookup in font['GPOS'].table.LookupList.Lookup:
        if lookup.LookupType != 2:
            continue
        for sub in lookup.SubTable:
            for pair_set in getattr(sub, 'PairSet', []) or []:
                count += len(pair_set.PairValueRecord)
            count += len(getattr(sub, 'pairs', {}) or {})
    return count


def vertical_bounds(font):
    glyf = font['glyf']
    ymin, ymax = 1 << 30, -(1 << 30)
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if getattr(glyph, 'numberOfContours', 0) == 0:
            continue
        glyph.recalcBounds(glyf)
        ymin, ymax = min(ymin, glyph.yMin), max(ymax, glyph.yMax)
    return [int(ymin), int(ymax)]


def advance_divergences(font, other):
    """Glyphs whose advance changed: the drawn contours must not shift the setting."""
    a, b = font['hmtx'].metrics, other['hmtx'].metrics
    return sorted(g for g in a if g in b and a[g][0] != b[g][0])


def ink_coverage(path, size=96):
    font = ImageFont.truetype(str(path), size)
    img = Image.new('L', (int(font.getlength(INK_TEST)) + 80, size * 3), 0)
    ImageDraw.Draw(img).text((40, size), INK_TEST, 255, font=font)
    data = img.tobytes()
    return round(sum(data) / (255 * len(data)), 4)


def rendered_ok(path):
    for size in RENDER_SIZES:
        font = ImageFont.truetype(str(path), size)
        img = Image.new('L', (int(font.getlength('hane 0123')) + 40, size * 3), 0)
        ImageDraw.Draw(img).text((20, size), 'hane 0123', 255, font=font)
        if img.getbbox() is None:
            raise SystemExit(f'{path.name}: nada renderizado em {size}px')
    return True


def stems_at(path, ch, unit_y=SCAN_Y, size=200):
    """Horizontal ink runs across one glyph, in em/1000 units."""
    font = ImageFont.truetype(str(path), size)
    asc, _ = font.getmetrics()
    img = Image.new('L', (int(font.getlength(ch)) + 60, asc + 60), 0)
    ImageDraw.Draw(img).text((30, 10), ch, 255, font=font)
    mask = img.point(lambda p: 255 if p > 110 else 0)
    px, w = mask.load(), mask.width
    row = asc - int(unit_y * size / 1000)
    runs, run = [], 0
    for x in range(w):
        if px[x, row]:
            run += 1
        elif run:
            runs.append(run); run = 0
    if run:
        runs.append(run)
    return [round(r * 1000 / size) for r in runs]


def stroke_balance(path):
    """Stem widths of the drawn family against the nib-generated one.

    `drawn_within` is the homogeneity check: the narrowest wall divided by the
    widest inside the same letter. A uniform expansion of the drawn contours
    leaves it untouched, which is how 0.4 first shipped with n and m carrying a
    55u wall next to a 120u one.
    """
    def group(chars):
        vals = [s for ch in chars for s in stems_at(path, ch) if s > 20]
        vals.sort()
        return vals
    def within(chars):
        ratios = []
        for ch in chars:
            walls = [s for s in stems_at(path, ch) if s > 20]
            if len(walls) > 1:
                ratios.append(min(walls) / max(walls))
        return round(min(ratios), 2) if ratios else None
    d, g = group(DRAWN), group(GENERATED)
    med = lambda v: v[len(v) // 2] if v else 0
    return {'drawn_stems': d, 'generated_stems': g,
            'drawn_median': med(d), 'generated_median': med(g),
            'stem_ratio': round(med(d) / med(g), 2) if med(g) else None,
            'drawn_within': within(DRAWN), 'generated_within': within(GENERATED)}


def validate():
    report = []
    for style in STYLES:
        ttf, woff2 = OUT / f'HaneSans-{style}.ttf', OUT / f'HaneSans-{style}-v04.woff2'
        font, web = TTFont(ttf), TTFont(woff2)
        old = PREV / f'HaneSans-{style}.ttf'
        ref = REF_03 / f'HaneSans-{style}.ttf'
        report.append({
            'style': style,
            'glyphs': len(font.getGlyphOrder()),
            'characters': len(font.getGlyphOrder()) - 1,
            'kerning_pairs': kerning_pairs(font),
            'us_weight_class': font['OS/2'].usWeightClass,
            'version': font['name'].getDebugName(5),
            'bounds': vertical_bounds(font),
            'render_sizes': RENDER_SIZES,
            'rendered': rendered_ok(ttf),
            'ink_coverage': ink_coverage(ttf),
            'ink_coverage_v0_2': ink_coverage(old) if old.exists() else None,
            'ink_coverage_v0_3': ink_coverage(ref) if ref.exists() else None,
            'advance_divergences_vs_v0_2': advance_divergences(font, TTFont(old)) if old.exists() else None,
            'stroke_balance': stroke_balance(ttf),
            'woff2_roundtrip': 'OK' if web.getGlyphOrder() == font.getGlyphOrder() else 'MISMATCH',
        })
        font.close(); web.close()
    (OUT / 'validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def specimen():
    W, H = 1600, 2060
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    label = face('Medium', 26)
    max_w = W - 200

    def line(x, y, text, style, size, fill=INK):
        while size > 8 and face(style, size).getlength(text) > max_w:
            size -= 2
        d.text((x, y), text, fill, font=face(style, size))

    d.text((100, 68), 'H A N E  /  S A N S  0 . 4', fill=LABEL, font=label)
    d.text((W - 480, 68), 'REGULAR + MEDIUM + SEMIBOLD', fill=LABEL, font=label)
    line(92, 130, 'hane', 'Regular', 430)
    line(100, 600, 'Inteligência com leveza.', 'Regular', 96)
    line(100, 706, 'Um espaço para pensar, criar e colaborar.', 'Regular', 58)
    d.line((100, 800, W - 100, 800), fill=RULE, width=2)

    d.text((100, 832), '01', fill=LABEL, font=label)
    d.text((160, 832), 'FORMAS / REGULAR', fill=LABEL, font=label)
    line(96, 890, 'abcdefghijklmnopqrstuvwxyz', 'Regular', 104)
    line(96, 1020, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'Regular', 104)
    line(96, 1150, '0123456789  @ # & % + = →', 'Regular', 104)
    line(96, 1275, 'ÁÉÍÓÚÂÊÔÃÕÇÀÜ  àéíóúâêôãõçàü', 'Regular', 104)
    d.line((100, 1410, W - 100, 1410), fill=RULE, width=2)

    d.text((100, 1442), '02', fill=LABEL, font=label)
    d.text((160, 1442), 'INTERFACE / SEMIBOLD + MEDIUM + REGULAR', fill=LABEL, font=label)
    line(100, 1500, 'Seus agentes, em sintonia.', 'SemiBold', 82)
    line(100, 1600, 'Organize ideias. Conecte ferramentas. Faça acontecer.', 'Medium', 50)
    line(100, 1675, 'Novo agente   Conversas   Memória   Configurações', 'Medium', 42)
    line(100, 1740, 'Atenção, colaboração e propósito — tudo no seu ritmo.', 'Regular', 36)
    d.line((100, 1805, W - 100, 1805), fill=RULE, width=2)

    d.text((100, 1835), '03', fill=LABEL, font=label)
    d.text((160, 1835), 'DENSIDADE / ESCALA REAL DA INTERFACE', fill=LABEL, font=label)
    sample = 'Missão concluída — 3 agentes, 12 etapas em 04:31'
    x = 100
    for size, style in [(9, 'Medium'), (10, 'Medium'), (12, 'Regular'), (15, 'Regular')]:
        font = face(style, size)
        d.text((x, 1880), sample, fill=INK, font=font)
        d.text((x, 1912), f'{size} px / {style}', fill=LABEL, font=face('Regular', 18))
        x += int(d.textlength(sample, font=font)) + 46
    line(100, 1950, 'Ampliação 3× da linha de 12 px: ' + sample, 'Regular', 36)
    line(100, 2010, 'Desenho original · alfabeto latino · três pesos · hastes desenhadas niveladas ao bico · TTF e WOFF2',
         'Regular', 26, LABEL)
    img.save(OUT / 'Hane-v0.4-Amostra.png')
    return OUT / 'Hane-v0.4-Amostra.png'


if __name__ == '__main__':
    rows = validate()
    print(json.dumps({'specimen': str(specimen()),
                      'styles': [{'style': r['style'], 'ink': r['ink_coverage'],
                                  'ink_v0_3': r['ink_coverage_v0_3'], 'woff2': r['woff2_roundtrip'],
                                  'bounds': r['bounds'], 'kern': r['kerning_pairs'],
                                  'advance_divergences': r['advance_divergences_vs_v0_2'],
                                  'balance': {k: v for k, v in r['stroke_balance'].items()
                                             if k not in ('drawn_stems', 'generated_stems')},
                                  'weight': r['us_weight_class']} for r in rows]}, indent=2))
