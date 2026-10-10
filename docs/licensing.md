# Licenciamento do repositório

Decisão do Lucas em 2026-10-10: código em **Apache-2.0**, tipografia em **SIL OFL 1.1**, marca
protegida por política separada. As opções concorrentes e o porquê estão no ADR-0006 de
[`decisions.md`](decisions.md).

## Matriz: o que está sob o quê

| Conteúdo | Licença | Onde está o texto |
| --- | --- | --- |
| `src/`, `bin/`, `scripts/`, `test/` — runtime Node, CLI e API | Apache-2.0 | [`LICENSE`](../LICENSE) |
| `work/mission-ui-prototype/src/`, `work/hane-landing/` — código da interface | Apache-2.0 | [`LICENSE`](../LICENSE) |
| `docs/`, `README.md` | Apache-2.0 | [`LICENSE`](../LICENSE) |
| Binários `.ttf`/`.woff2` da Hane Sans (v0.2, v0.3, v0.4) e suas cópias em `public/fonts/` | SIL OFL 1.1, com Reserved Font Names `Hane Sans` e `HaneSans` | [`src/Hane fonts/OFL.txt`](../src/Hane%20fonts/OFL.txt) |
| Nome **Hane**, logotipo, símbolo, identidade visual | **não licenciados** pelo código; ver política | [`TRADEMARKS.md`](../TRADEMARKS.md) |
| `Frontend/` | export do Figma Make; proveniência e direitos **não resolvidos** | [`Frontend/README.md`](../Frontend/README.md) |

O texto das duas licenças foi baixado da fonte canônica e copiado sem edição; só os cabeçalhos
de autoria e de nome reservado foram preenchidos. A OFL é verbatim (diff byte a byte conferido
contra o original) e a Apache é o arquivo integral, com o bloco de aviso do próprio apêndice
dela preenchido no fim.

## O que a licença de código não resolve

- **Marca.** A seção 6 da Apache nega direito sobre nomes comerciais e logotipo por si só. A
  política em `TRADEMARKS.md` explicita o que é uso descritivo permitido e o que precisa de
  autorização, e dá o procedimento de renomeação para fork.
- **Tipografia.** A OFL é licença livre: uso e redistribuição são permitidos, inclusive
  comerciais. A proteção que ela oferece é o nome reservado — versão modificada não pode se
  chamar Hane Sans. Isso é o mecanismo escolhido; não é uma proibição de usar.
- **`Frontend/`.** O repositório publica 23 arquivos de um export do Figma Make como referência
  de design. Declarar Apache-2.0 sobre eles afirmaria que o projeto detém direitos que talvez
  não detenha, então a proveniência fica registrada ao lado, separada do resto.
- **Histórico.** Artefatos de perfil de navegador (`work/**/chrome-qa`) estavam trackeados e
  foram removidos do rastreamento por este commit, mas continuam nos commits antigos do
  `origin/main` público. Remover de verdade exige reescrever histórico e `push --force`, que é
  decisão do Lucas, não deste documento.

## Estado dos metadados

- `package.json` declara `"license": "Apache-2.0"` e `"author"`. Sem o campo, `npm` e catálogos
  de pacotes seguem lendo o projeto como sem licença, mesmo com o `LICENSE` na raiz.
- `README.md` tem a seção *License* em inglês, que é o idioma do README e o público dela são
  contribuidores e quem faz fork.
- Os binários de fonte têm `OFL.txt` ao lado em três lugares: `src/Hane fonts/` (origem das
  versões) e os dois `public/fonts/` que embarcam woff2 nos apps. A OFL exige que a licença
  acompanhe os binários redistribuídos, e é o build que publica essas cópias.

Falta gravar os metadados de copyright e licença **dentro** dos próprios `.ttf`/`.woff2` (name
table: nameID 0 e 11), hoje vazios. Isso pede uma rodada de tooling de fonte e não altera o
valor legal da OFL ao lado dos binários, por isso ficou para depois.

## Atribuição de terceiros

Nada de terceiro está vendorizado no git; o que existe é dependência declarada:

| Pacote | Licença | Usado em |
| --- | --- | --- |
| `argon2` | MIT | perfil local (não-commiteado ainda) |
| `sharp` | Apache-2.0 | avatar do perfil (não-commiteado ainda) |
| `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `animejs`, `@phosphor-icons/react` | MIT | protótipo |
| `nuxt`, `@phosphor-icons/vue` | MIT | landing |
| Node.js (`node:sqlite`, `node:http`, …) | licenças do próprio runtime | runtime |

Compatíveis com Apache-2.0. A política de raiz zero-dependência foi **encerrada pelo Lucas em
2026-10-10**, então `argon2` e `sharp` não são mais uma exceção a registrar — são dependências.

## Falta para o repo se dizer saudável para contribuição

A estratégia pedia três arquivos e este cuida de um:

- `SECURITY.md` — como reportar vulnerabilidade na API loopback. Relevante porque o `origin/main`
  atual tem o buraco de CSRF descrito em [`architecture-diagnosis.md`](architecture-diagnosis.md) §4.
- `CONTRIBUTING.md` — o que se aceita, como rodar `npm run verify`, e o fato de que a licença do
  pull request é a mesma do projeto.

Nenhum dos dois foi escrito aqui porque a decisão foi focar na licença; ambos são pequenos e
independentes.
