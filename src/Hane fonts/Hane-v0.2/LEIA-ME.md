# Hane Sans — versão 0.2

Revisão da fonte instalável do Hane a partir da referência visual fornecida.
A linguagem agora combina contraste entre traços finos e grossos, terminais
afilados, curvas amplas e uma haste em forma de pena no h/l. Os caracteres
h, a, n, e, m, r, l e i têm contornos próprios redesenhados; os demais usam
o mesmo princípio de contraste e terminais. Não foram importados contornos
de fontes de terceiros. A amostra é renderizada com os TTF entregues.

## Arquivos

- HaneSans-Regular.ttf — peso 400, maior contraste e traços delicados.
- HaneSans-Medium.ttf — peso 500, traços finos reforçados.
- HaneSans-Regular.woff2 / HaneSans-Medium.woff2 — versões para web.
- hane.css — declarações @font-face.
- Hane-v0.2-Amostra.png — amostra com letras, números, acentos e frases.
- sources/ — desenhos e geradores editáveis em Python.
- validation.json — resultados das verificações automatizadas.

## Instalar

Abra os arquivos TTF no Windows ou macOS e escolha Instalar. Se já instalou
a versão 0.1, substitua os arquivos quando solicitado e reinicie os aplicativos.
A família continua sendo Hane Sans, agora com identificação de versão 0.200.
Alguns programas mostram Medium como a família Hane Sans Medium.

## Usar no aplicativo

Coloque o CSS e os WOFF2 na mesma pasta, importe o CSS e aplique:

```css
font-family: 'Hane Sans', sans-serif;
font-weight: 400; /* ou 500 para Medium */
```

O contraste desta revisão favorece marca, títulos e textos em destaque.
Para texto de interface menor, prefira Medium e confira a leitura na tela real.
Essa versão ainda não tem hinting manual nem acabamento comercial completo.

## Cobertura

São 289 glifos por peso, sendo 288 caracteres e um glifo de substituição.
Inclui ASCII imprimível, letras latinas adicionais, acentos em português,
pontuação, símbolos de moedas e setas. Há 31 pares de kerning OpenType.
Não é monoespaçada. Kanji/kana e caracteres fora da cobertura precisam de
fonte complementar; o 羽 do logo não está incluído.

Use Unicode normalizado em NFC: marcas combinantes separadas ainda não têm
glifos ou posicionamento próprio. Ligaduras especiais de código não estão
incluídas. A cobertura extra latina é parcial.

## Verificação

Os arquivos foram abertos com fontTools e rasterizados com FreeType via Pillow;
a cobertura portuguesa, os limites verticais, os nomes e os pesos foram
conferidos. Os WOFF2 foram descomprimidos e renderizados. As interseções dos
contornos foram removidas com Skia PathOps. Não houve teste de instalação em
Windows/macOS nesta execução, nem pesquisa de disponibilidade do nome.

## Regenerar

Instale as dependências em sources/requirements.txt e execute
`python refine_hane.py` na pasta sources. Os arquivos serão gerados na
subpasta Hane-v0.2. O build_hane.py fornece as construções geométricas de
base; refine_hane.py contém a revisão de contraste e os contornos próprios.
