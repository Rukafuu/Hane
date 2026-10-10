# Hane Sans v0.4 — corte de texto robusto, hastes niveladas

Partiu da revisão de tela da v0.3 (traços finos reforçados, contraste achatado,
terminais em pena mantidos) e corrigiu o que a medição mostrou depois: as oito
letras desenhadas à mão (`h n a e m r l i`) estavam **mais pesadas que o resto do
alfabeto no agregado** e, dentro do próprio `n` e do `m`, a haste esquerda tinha
metade da largura da direita.

## O que mudou nesta build

| | Regular | Medium | SemiBold |
|---|---|---|---|
| peso | 400 | 500 | 600 (inédito) |
| haste vertical | 88u | 102u | 116u |
| hairline | 52u | 64u | 76u |
| hairline em 12,5 px | 0,65 px | 0,80 px | 0,95 px |
| expansão dos contornos desenhados | 11u/lado | 16u/lado | 22u/lado |
| tinta (`validation.json`) | 0,0558 | 0,0644 | 0,0738 |

Três correções concretas:

1. **`n` e `m` tiveram a haste esquerda reescrita.** O desenho original saía com
   18u entre a borda externa (x=75) e a interna (x=93), enquanto `h`, `r`, `l` e
   `i` usavam ~57–60u. Agora as três partilham a parede de 57u do `h`.
   Razão haste-mais-fina / haste-mais-grossa dentro da mesma letra:
   **0,54 → 0,86–0,90**.
2. **A expansão deixou de ser um chute único.** Antes `stroke(36/48)` inchava
   tudo, incluindo paredes que já estavam certas: a razão entre a mediana das
   desenhadas e a das geradas era **1,17 (Regular) e 1,20 (Medium)**. Agora o
   `grow` é calibrado por peso para fechar só o vão até `2*thick`:
   **1,06 / 1,00 / 1,00**.
3. **SemiBold 600 existe.** A v0.4 entregue tinha apenas 400 e 500, e o
   protótipo declara 600 em títulos e ações — sem a face, esses textos caíam para
   Medium.

Densidade medida em 12,5 px (`Resuma os riscos de migrar para ESM: Atenção
necessária 4/4 chamadas`), no formato tinta/sólido — fração de escuridão média e
fração da tinta que chega a ≥70% de preto, que é o que separa traço nítido de
borrão cinza:

```
Segoe UI        0,1091 / 0,41      Segoe Semibold  0,1605 / 0,55
v0.3 Regular    0,1004 / 0,38      v0.3 Medium     0,1115 / 0,43
v0.4 Regular    0,1020 / 0,40      v0.4 Medium     0,1145 / 0,44
v0.4 SemiBold   0,1261 / 0,48
```

A Regular fica a 6% da tinta do Segoe UI com o mesmo sólido; a Medium e a
SemiBold passam o Segoe nas duas medidas. Abaixo de 10 px a Regular cai para
0,0955 contra 0,0980 do Segoe — **nessa faixa use Medium**, que sobe para
0,1138/0,35.

## Usar

1. Copie os três `*-v04.woff2` e o `hane.css` para a pasta pública de fontes.
2. Importe o `hane.css` (ou copie os `@font-face`).
3. `font-family: 'Hane Sans', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;`
   com `font-synthesis: none`.
4. 400 corpo, 500 ênfase e texto pequeno, 600 títulos e ações. Mapeamento
   conferido no Chromium via CDP: **450 resolve para Medium e 650 para SemiBold**.

Os WOFF2 têm `-v04` no nome para não reaproveitar URL em cache. Se mover os
arquivos, ajuste os `url()`.

## Arquivos

- `HaneSans-{Regular,Medium,SemiBold}.ttf` para instalar; `*-v04.woff2` para web.
- `hane.css` — 400, 500 e 600.
- `Hane-v0.4-Amostra.png` — alfabeto, frases e escala real de interface (9/10/12/15 px).
- `validation.json` — verificações por peso.
- `sources/robust_hane.py` — gerador; `sources/build_hane.py` — desenhos base.
- `sources/validate_hane.py` — checagens + amostra.
- `Hane-v0.4/` (subpasta) — a entrega original, guardada como referência. Não
  importe os WOFF2 de lá: eles se identificam como `Version 0.300` e têm o
  desequilíbrio das hastes descrito acima.

## Validação

289 glifos por peso (288 caracteres + `.notdef`), acentos portugueses, ASCII
imprimível e símbolos latinos adicionais. 31 pares de kerning OpenType.
**Larguras de avanço idênticas às da v0.2 nos três pesos** (0 glifos divergentes),
limites verticais [-242, 1023] / [-248, 1034] / [-254, 1046], WOFF2 descomprimido
e comparado glifo a glifo, contornos sem interseção (Skia PathOps).

A diferença para a v0.2 vem só do desenho: v0.2 era corte de display (hairline de
0,15–0,30 px em 12,5 px) e a v0.4 é corte de texto.

Aqui a renderização **foi** conferida em Chromium real (protótipo e landing, via
CDP `CSS.getPlatformFontsForNode`), não apenas em FreeType/Pillow — a build
anterior dizia "browser execution unavailable". Continua sem hinting manual e sem
revisão tipográfica comercial.

Kanji/kana e caracteres fora da cobertura precisam de fallback. Use texto NFC;
marcas combinantes separadas não têm suporte.

## Regenerar

`pip install -r sources/requirements.txt` e, dentro de `sources/`,
`python robust_hane.py` (grava TTF + WOFF2 na pasta acima) e depois
`python validate_hane.py` (grava `validation.json` e a amostra).

Para mexer na cor das letras desenhadas, ajuste só o quarto número de `STYLES`
(`grow`) — a tabela documenta que ele existe para fechar o vão até `2*thick`, e o
`stroke_balance` de `validate_hane.py` é a medição que diz se foi pouco ou demais.
