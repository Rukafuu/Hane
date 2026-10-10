# `Frontend/` — referência de design, não produto

Estes 23 arquivos são um export do **Figma Make** (`package.json` se apresenta como
`figma-make-app`, `"private": true`). Foi usado como ponto de partida visual e está no
repositório por isso, não porque seja o app.

O audit de honestidade (`docs/runtime-honesty-audit.md`) classifica esta pasta como **MOCK**: a
interface real do Hane é `work/mission-ui-prototype/`, que consome a API local. Nada aqui é
executado pelo runtime.

## Situação de licença

A [`LICENSE`](../LICENSE) na raiz do repositório cobre o **código autoral do Hane**. Ela não é
uma alegação sobre estes arquivos:

- A saída de uma ferramenta hospedada por terceiros tem proveniência que **não verifiquei**
  contra os termos de serviço do serviço que a gerou.
- O próprio scaffold referencia dependências de terceiros (`react`, `vite`, `tailwindcss`,
  `oxfmt`, `typescript`) sob licenças próprias, que não vêm neste repo.
- Por isso, nada aqui deve ser lido como "licenciado sob Apache-2.0 pelo autor do Hane".

## O que fazer com isto

Três caminhos, e a escolha é do titular do projeto:

1. **Manter como referência com esta nota** — é o estado atual; o aviso fica ao lado do conteúdo.
2. **Mover para fora do repositório publicado** — se a proveniência não puder ser confirmada.
3. **Substituir por material próprio** — quando a identidade visual for refeita por aqui, o
   problema some junto com a pasta.

A opção 1 é defensável para um repositório que não distribui isto como componente nem o usa em
build. Ela deixa de ser defensável se algum empacotamento futuro incluir estes arquivos num artefato
instalável.
