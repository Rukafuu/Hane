# Hane Sans — versão 0.3

Revisão de densidade óptica da família para que a fonte sustente texto de
interface sem perder a identidade da 0.2: continuam o contraste entre traços
finos e grossos, os terminais em pena no h/l, as curvas amplas e os contornos
próprios de h, a, n, e, m, r, l e i. Nenhum contorno foi importado de fontes de
terceiros.

## O que mudou

- Regular (400): haste de 66 para 88 unidades e hairline de 12 para 22
  (em de 1000). Cobertura de tinta da amostra de referência: 3,40% → 4,47% (+31%).
- Medium (500): haste de 80 para 102 e hairline de 24 para 36. Tinta:
  4,34% → 5,12% (+18%).
- SemiBold (600): peso novo (haste 116, hairline 50) para títulos e ações, que
  antes dependiam de negrito sintético ou caíam no Medium.
- Os contornos desenhados (h, a, n, e, m, r, l, i e derivados acentuados)
  ganharam expansão própria por peso (10 / 16 / 24), acompanhando as letras
  construídas pelo bico calado. Os miolos de a e e continuam abertos.
- Identificação interna 0.300 em nome, `head.fontRevision` e identificadores.

## Arquivos

- HaneSans-Regular.ttf / .woff2 — peso 400, texto corrido.
- HaneSans-Medium.ttf / .woff2 — peso 500, metadados e rótulos.
- HaneSans-SemiBold.ttf / .woff2 — peso 600, títulos e ações.
- hane.css — @font-face dos três pesos e a pilha recomendada.
- Hane-v0.3-Amostra.png — alfabetos, números, acentos, interface e escala real
  de 9 a 15 px.
- validation.json — checagens automatizadas da versão.
- Os geradores editáveis ficam em `../Hane-v0.2/sources` (mesma família).

## Instalar

Abra os arquivos TTF no Windows ou macOS e escolha Instalar. Se já instalou a
0.2, substitua os arquivos quando solicitado e reinicie os aplicativos. A
família continua Hane Sans, agora identificada como 0.300. Alguns programas
exibem Medium e SemiBold como famílias próprias (Hane Sans Medium, Hane Sans
SemiBold).

## Usar no aplicativo

Importe o hane.css e declare a família com o Segoe apenas como fallback:

```css
font-family: 'Hane Sans', 'Segoe UI Variable Text', 'Segoe UI', ui-sans-serif,
             system-ui, sans-serif;
```

Pesos por papel: 400 para texto corrido (12 px ou mais), 500 para metadados e
rótulos, 600 para títulos e ações. Mantenha `font-synthesis: none` para evitar
negrito falso sobre os pesos reais. A 0.2 tinha hairlines de 12 unidades, que
desapareciam entre 9 e 12 px; a 0.3 foi ajustada para segurar esse intervalo,
mas continua sem hinting manual — confira a leitura na tela real do destino.

Os numerais são proporcionais e não há recurso `tnum`: `font-variant-numeric:
tabular-nums` fica inerte sobre a Hane Sans, então horários e métricas alinhados
por coluna precisam de fonte monoespaçada ou de alinhamento manual.

## Cobertura

São 289 glifos por peso, sendo 288 caracteres e um glifo de substituição, com
31 pares de kerning OpenType. Inclui ASCII imprimível, letras latinas
adicionais, acentos em português, pontuação, símbolos de moedas e setas. Não é
monoespaçada; kanji/kana e caracteres fora da cobertura precisam de fonte
complementar, e o 羽 do logo não está incluído. Use Unicode normalizado em NFC:
marcas combinantes separadas ainda não têm glifos ou posicionamento próprio.
Ligaduras especiais de código não estão incluídas. A cobertura extra latina é
parcial.

## Verificação

`validate_hane.py` abre os TTF e WOFF2 com fontTools e confere glifos,
`usWeightClass`, nome, kerning e limites verticais; rasteriza com FreeType via
Pillow em 16/24/48/160/360 px; mede a cobertura de tinta da amostra de
referência (`Inteligencia com leveza 0123` em 96 px) e compara o roundtrip do
WOFF2. Os WOFF2 foram descomprimidos e renderizados. Não houve teste de
instalação em Windows/macOS nesta execução, nem pesquisa de disponibilidade do
nome.

## Regenerar

Instale as dependências de `../Hane-v0.2/sources/requirements.txt` e, nessa
pasta de sources, execute `python refine_hane.py` (gera os três pesos em
`../Hane-v0.3`) e depois `python validate_hane.py` (gera a amostra e o
validation.json). A escada de densidade está no dicionário `STYLES` de
refine_hane.py: `(peso, meia-haste, meia-hairline, expansão dos desenhados)`.
O build_hane.py fornece as construções geométricas de base; refine_hane.py contém
a revisão de contraste e os contornos próprios.
