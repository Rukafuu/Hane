#!/usr/bin/env python3
"""Hane Sans: automated checks and specimen render for the generated release.
Reads the TTF/WOFF2 produced by refine_hane.py, writes validation.json and the
Amostra PNG next to them. Ink coverage is measured so each release can be
compared against the previous one.
"""
from pathlib import Path
import json
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent.parent / 'Hane-v0.3'
PREV = ROOT.parent  # Hane-v0.2, used only for the coverage comparison
STYLES = ['Regular', 'Medium', 'SemiBold']
RENDER_SIZES = [16, 24, 48, 160, 360]
INK_TEST = 'Inteligencia com leveza 0123'
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


DRAWN = 'hanemrli'
GENERATED = 'oscptdubfg'


def stroke_runs(path, ch, size=200):
    """Horizontal run lengths across the glyph, in em/1000 units."""
    font = ImageFont.truetype(str(path), size)
    img = Image.new('L', (int(font.getlength(ch)) + 40, size + 80), 0)
    ImageDraw.Draw(img).text((20, 40), ch, 255, font=font)
    mask = img.point(lambda p: 255 if p > 110 else 0)
    px, w, h = mask.load(), mask.width, mask.height
    runs = []
    for y in range(h):
        run = 0
        for x in range(w):
            if px[x, y]:
                run += 1
            elif run:
                runs.append(run)
                run = 0
        if run:
            runs.append(run)
    runs.sort()
    scale = 1000 / size
    return runs[max(0, len(runs) // 100)] * scale, runs[-1] * scale


def stroke_balance(path):
    """Thin-stroke and stem averages for the two construction families."""
    def group(chars):
        thin, stem = [], []
        for ch in chars:
            t, s = stroke_runs(path, ch)
            thin.append(t); stem.append(s)
        return sum(thin) / len(thin), sum(stem) / len(stem)
    dt, ds = group(DRAWN)
    gt, gs = group(GENERATED)
    return {'drawn_thin': round(dt, 1), 'generated_thin': round(gt, 1),
            'drawn_stem': round(ds, 1), 'generated_stem': round(gs, 1),
            'thin_ratio': round(dt / gt, 2), 'stem_ratio': round(ds / gs, 2)}


def validate():
    report = []
    for style in STYLES:
        ttf, woff2 = OUT / f'HaneSans-{style}.ttf', OUT / f'HaneSans-{style}.woff2'
        font, web = TTFont(ttf), TTFont(woff2)
        old = PREV / f'HaneSans-{style}.ttf'
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

    d.text((100, 68), 'H A N E  /  S A N S  0 . 3', fill=LABEL, font=label)
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
    line(100, 2010, 'Desenho original · alfabeto latino · três pesos · arquivos TTF e WOFF2 · protótipo utilizável',
         'Regular', 26, LABEL)
    img.save(OUT / 'Hane-v0.3-Amostra.png')
    return OUT / 'Hane-v0.3-Amostra.png'


if __name__ == '__main__':
    rows = validate()
    print(json.dumps({'specimen': str(specimen()),
                      'styles': [{'style': r['style'], 'ink': r['ink_coverage'],
                                  'ink_v0_2': r['ink_coverage_v0_2'], 'woff2': r['woff2_roundtrip'],
                                  'bounds': r['bounds'], 'kern': r['kerning_pairs'],
                                  'balance': r['stroke_balance'],
                                  'weight': r['us_weight_class']} for r in rows]}, indent=2))
