# Hane Sans — versão 0.3

Corte de texto da família: a 0.2 é um corte de display, com hairlines de 12 a
24 unidades que viram um fio de 0,15 a 0,30 pixel entre 9 e 15 px e se desfazem
no antialias em escala de cinza. A 0.3 mantém a identidade — os terminais em
pena no h/l, as curvas amplas, os miolos abertos e os contornos próprios de h,
a, n, e, m, r, l e i — e achata o contraste o suficiente para o texto de
interface fechar. Nenhum contorno foi importado de fontes de terceiros.

## O que mudou

- Regular (400): haste de 66 para 90 unidades e hairline de 12 para 54 (em de
  1000). A relação cai de 5,5:1 para 1,7:1, e a hairline passa de 0,15 px para
  0,68 px em 12,5 px. Cobertura de tinta da amostra de referência:
  3,40% → 5,46%.
- Medium (500): haste de 80 para 104 e hairline de 24 para 66. Tinta:
  4,34% → 6,23%.
- SemiBold (600): peso novo (haste 122, hairline 80) para títulos e ações, que
  antes dependiam de negrito sintético ou caíam no Medium.
- Contra-prova objetiva, na mesma frase de UI renderizada em 12,5 px: Segoe UI
  regular tem cobertura 0,0915; Hane Regular 0,0857 e Medium 0,0972. Em 10 px,
  o Medium (0,0833) empata com o Segoe UI (0,0822). Antes, o Regular da 0.3
  primeira passada ficava em 0,078 e o volume de tinta era 14% menor.
- Os contornos desenhados (h, a, n, e, m, r, l, i e derivados acentuados)
  ganharam expansão própria por peso (24 / 30 / 42), acompanhando as letras
  construídas pelo bico calado: a razão entre hairline desenhada e gerada subiu
  de 0,66 para 0,82 a 0,92. Os miolos de a e e continuam abertos.
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
Abaixo de 10 px, prefira o Medium: com o Regular a cobertura cai para 0,0719
contra 0,0833 do Medium na mesma frase.

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
referência (`Inteligencia com leveza 0123` em 96 px), compara a hairline das
letras desenhadas com a das geradas (`stroke_balance`) e confere o roundtrip do
WOFF2. Os WOFF2 foram descomprimidos e renderizados. `probe_density.py` renderiza
uma frase real de interface em 10/12/12,5/15 px e imprime cobertura e fatia de
tinta sólida lado a lado com o Segoe UI — é a contra-prova citada acima. Não
houve teste de instalação em Windows/macOS nesta execução, nem pesquisa de
disponibilidade do nome.

## Regenerar

Instale as dependências de `../Hane-v0.2/sources/requirements.txt` e, nessa
pasta de sources, execute `python refine_hane.py` (gera os três pesos em
`../Hane-v0.3`) e depois `python validate_hane.py` (gera a amostra e o
validation.json). A escada de densidade está no dicionário `STYLES` de
refine_hane.py: `(peso, meia-haste, meia-hairline, expansão dos desenhados)`.
O build_hane.py fornece as construções geométricas de base; refine_hane.py contém
a revisão de contraste e os contornos próprios.
