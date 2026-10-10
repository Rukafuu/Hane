# ADR-0001 — A entidade persistente é `Team`; a rodada passa a ser `execução`

Status: aceito (decisão do Lucas, 2026-10-10).

## Contexto

A estratégia chama o diferencial de **Hane Teams**: grupos persistentes de até oito agentes.
A UI já não-commiteada da outra sessão chama isso de **GRUPOS** e guarda em `localStorage`
(`work/mission-ui-prototype/src/preferences.js:28-44`). O runtime chama **mission** a cada
rodada (`task_runs`, `/api/missions`, `hane missions`). Havia também uma decisão anterior de
renomear *missão* → *Equipe* em todo o código, o que colide com a nova entidade: a mesma
palavra passaria a significar o grupo e a rodada ao mesmo tempo.

## Decisão

- A entidade persistente é **`Team`** (inglês) / **Equipe** (português da UI): tabela
  `teams`, `team_members`, rotas `/api/teams`, CLI `hane team`, classes `Team`/`TeamStore`.
- Uma rodada é **`execução`** (código: `task_runs`/`mission` preservados por ora). O
  rebranding *missão → Equipe* fica **suspenso**: a palavra pertence agora à entidade de
  grupo, e renomear rodada para o mesmo termo criaria ambiguidade permanente.
- Se e quando a rodada for renomeada, o alvo é `run`/`execução`, nunca `team`.

## Consequências

- O vocabulário da UI (`GRUPOS`) e o backend (`Team`) divergem por uma janela. É aceito
  porque a UI é de outra sessão e está suja; o contrato de API fica documentado aqui e a
  troca de rótulo é uma linha de copy, não uma migração.
- A decisão anterior de renomear *missão* fica registrada como cancelada, não pendente, para
  ninguém a reabrir por engano.
- O onboarding em três etapas (perfil → provedor → grupo) da outra sessão consome `/api/teams`
  em vez de `localStorage`.

## Alternativas rejeitadas

- **`Group`** — alinharia com a UI atual, mas a marca e o documento dizem Teams, e o Lucas
  escolheu o nome da marca.
- **Renomear missão para Equipe e chamar a entidade de Collective** — dois renames e um termo
  novo que nenhum usuário entende.

# ADR-0002 — A fronteira do browser é incondicional e independe do perfil local

Status: aceito (Lucas pediu o P0 de segurança como primeira execução). O mecanismo está em
`src/server/request-guard.js` com testes; o wiring incondicional ainda é um hunk pendente.

## Contexto

No `origin/main` (público) o servidor não valida `Origin`, `Host` nem `Content-Type`, e aceita
corpo em qualquer MIME. Qualquer página aberta no navegador do usuário pode POSTar em
`http://127.0.0.1:7788/api/missions` como request CORS simples (`text/plain`), gastar o
orçamento de API do usuário e disparar leituras dentro da raiz que o servidor já autorizou.

A outra sessão fechou o mesmo buraco dentro de `src/server/profile-api.js` (Host loopback,
allowlist de origem, rejeição de `Origin: null`, header `x-hane-request: 1` em métodos
mutantes), mas aquele código só é instanciado quando existe um `profileStore`. Sem perfil, o
roteador de missões não valida nada. A fronteira passou a depender, na prática, de um recurso
de cosmético pessoal: quem embute `createMissionServer` programaticamente, ou roda sem perfil,
fica exposto exatamente como o `origin/main` de hoje.

## Decisão

A validação de origem é uma propriedade do **servidor**, não do recurso de perfil:

- Um guard chamado no topo do roteador, sempre ativo, recusando antes de qualquer rota.
- **Host** deve ser loopback: isso é o que fecha DNS rebinding, onde `Origin` e `Host`
  coincidem e um allowlist ingênuo deixaria passar.
- **`Origin` presente** ⇒ deve ser a origem do próprio servidor ou estar na allowlist
  (`--ui-origin`, já embarcado pela outra sessão); `null` nunca muta estado. O allowlist
  **não** aceita "qualquer porta de localhost": outra serviço local é outro site, não a mesma
  origem.
- **`Sec-Fetch-Site`** `cross-site`/`cross-origin` é recusado. O browser não permite forjar
  esse header, então ele é o sinal mais barato disponível.
- **Corpo vindo de browser** deve ser `application/json`: elimina form post e `text/plain`.
- Pedido mutante exige um header explícito (`x-hane-request: 1`), que um site terceiro não
  consegue enviar sem preflight, e não há CORS para concedê-lo.

## Estado da implementação (2026-10-10)

Landed: `src/server/request-guard.js` (guard puro, sem dependência de rota, perfil ou feature)
e `test/request-guard.test.js` (10 casos). Os testes sobem um servidor HTTP real em loopback e
falam com ele a nível de socket, porque a fronteira é sobre headers de fio, não sobre objetos
internos. Eles provam que o payload do diagnóstico (POST simples com `text/plain` e
`Sec-Fetch-Site: cross-site`) é recusado **antes** de o roteador rodar, que Host não-loopback
(DNS rebinding) morre antes de qualquer rota, que preflight vira 403 em vez de resposta CORS, e
que um cliente local sem identidade de browser continua irrestrito.

Pendente, e é uma decisão de wiring não de desenho: a outra sessão ainda escreve em
`src/server/mission-server.js`, então editar o arquivo agora só arriscaria perder o hunk. O
insert é um, no topo de `createMissionServer`:

```js
// createMissionServer ganha bindHost (o CLI sabe qual --host usou) e monta o guard uma vez:
const guard = createRequestGuard({ allowedOrigins, allowAnyHost: !isLoopback(bindHost) });
// dentro de createServer, antes de qualquer rota:
try { guard(request); } catch (error) { return respondJson(response, error instanceof RequestGuardError ? error.status : 500, { error: error.message }); }
```

`createMissionServer` não conhece o bind (quem faz `listen` é o CLI), então o parâmetro
`bindHost` é a única coisa nova na assinatura. Sem ele, um servidor atado a `0.0.0.0` recusaria
o próprio Host e o embutidor teria que desligar a fronteira inteira por `allowAnyHost`.

E uma regra de fusão, para o ADR não criar o mecanismo rival que ele mesmo critica: quando
`profile-api.js` for commitado, o `checkOrigin` daquela sessão deve **chamar** este guard e
manter só o que é do perfil (cookie de sessão, lockout). Dois validores de origem em dois
arquivos é a dívida que o diagnóstico já apontou, não a correção dela.

## Consequências

- O `api.js` do protótipo precisa enviar o header explícito em `createMission`, `approve`,
  `retry` e `cancel`, ou as três ações quebram em 403 quando o perfil landar. **Já envia**
  (`work/mission-ui-prototype/src/api.js`) — mas essa linha é da mesma fatia não-commiteada
  do perfil, não do HEAD. Guard e header são um só entregável: um sem o outro é tela quebrada.
- Clientes locais sem header de origem (CLI, testes) permanecem irrestritos, e isso é
  deliberado: um processo que fala HTTP no loopback já lê o mesmo arquivo SQLite, então
  fingir autenticação ali não protege nada.
- Se a fatia de perfil for revertida, a fronteira continua de pé.

## Alternativas rejeitadas

- **Token de sessão em todas as rotas hoje** — daria a falsa sensação de autenticção contra
  processo local, quebraria todos os testes de servidor e duplicaria o `hane_session` que a
  outra sessão já emite para perfil. Entra quando houver algo que autenticar (multiusuário,
  bind fora do loopback, ou ferramentas de escrita).
- **Confiar só em bind 127.0.0.1** — é o que existe hoje e é justamente a vulnerabilidade.

# ADR-0003 — Orquestração: estratégia plugável com o fluxo atual como preset

Status: aceito (forma; execução no P0-U).

## Contexto

`ROLE_FLOW` é uma constante de três papéis (`src/orchestrator.js:13-17`) e o orçamento assume
três chamadas. A estratégia pede equipes de até oito agentes com delegação e liderança
opcional. Substituir o fluxo determinístico por um loop em que o LLM decide a próxima
chamada destruiria a property que dá crédito ao produto: orçamento e auditoria previsíveis.

## Decisão

- O fluxo atual vira **um preset** (`three-role`) de uma interface de estratégia, e continua
  sendo o default. Missões antigas (`team_id NULL`) rodam pelo preset com exatamente o
  comportamento de hoje.
- Delegação é **estrutura persistida**, não conversa: um agente só pode delegar para um
  membro do próprio time, com profundidade máxima, herança do orçamento restante e um evento
  de auditoria (`delegation` / `delegation_refused`) por decisão.
- Liderança opcional significa **prioridade de decisão dentro do preset**, não um papel novo
  que reescreve o estado. O dono do estado continua sendo o orquestrador.
- Concorrência, cancelamento e aprovação humana continuam centralizados no orquestrador;
  nenhum agente escreve estado.

## Consequências

- `reserveProviderCall`/`reserveToolCall` deixam de ser por-papel e passam a ser
  por-agente-dentro-do-time, mantendo os contadores por execução como teto global.
- `priorOutputs` (mapa de papel) passa a ser mapa de agente; o snapshot ganha `agentId` e as
  saídas antigas continuam legíveis como `planner`/`executor`/`reviewer`.

## Alternativas rejeitadas

- **Orquestração livre por LLM (estilo supervisor autônomo)** — não auditável antes do fato,
  custo imprevisível, e cancelamento/approval viram heurística.
- **Duplicar o orchestrator para times** — dois fluxos para manter e a UI teria que adivinhar
  qual está rodando.

# ADR-0004 — Desktop: Tauri 2 é a primeira hipótese, ainda não é decisão

Status: aberto (avaliação adiada para P2).

## Contexto

A estratégia pede Windows/Linux/macOS, SQLite local, integração segura com o SO e provedores
locais. Hoje: Node 22 + `node:sqlite`, CLI, servidor loopback, e um Credential Manager
deliberadamente **Windows-only** (`UnsupportedPlatformError`, sem spawn fora do Windows). O
`AGENTS.md`/Settings também registram que empacotamento ainda não existe.

## Decisão

Nenhuma migração agora. O critério de escolha em P2 é, nesta ordem:

1. O runtime precisa continuar sendo Node? Se sim, um shell que empacota o binário Node
   (Tauri com sidecar, ou empacotador Node) ganha; um shell que exige porta Node embutida não.
2. Segredo multiplataforma primeiro, shell depois: sem um backend de vault para macOS
   (Keychain) e Linux (Secret Service), o app desktop herda um bug de plataforma, não um
   problema de UI.
3. Escrita de arquivo/processo só com sandbox nativo; isso pesa a favor do sandbox do SO
   sobre o sandbox de aplicação.

## Consequências

- Nada no código atual impede Tauri 2: o servidor loopback e o SQLite já são um backend
  independente. A decisão é adiável sem custo, e é isso que a torna segura de adiar.
- A dependência nova (`argon2`, `sharp`) na raiz zero-dep torna a história de empacotamento
  mais pesada; precisa ser decisão explícita do Lucas, não efeito colateral de uma fatia.

## Alternativas

- **Tauri 2 + sidecar Node** — leve, sandbox de SO, mas dois runtimes para distribuir.
- **Electron** — um só runtime (Node dentro), migração quase nula do core, mas binário grande
  e memória alta.
- **Manter CLI + navegador** — custo zero, e é o estado atual; insustentável só para o público
  não-técnico que a estratégia almeja.

# ADR-0005 — Uma única superfície de UI e um único registro dos dados

Status: aceito.

## Contexto

Existem hoje três superfícies: `work/mission-ui-prototype` (ativa, consome a API real),
`Frontend/` (export Figma Make, mock, trackeado como referência de design) e
`work/hane-landing` (site). E duas fontes de verdade para a mesma ideia: a biblioteca de
agentes/equipes em `localStorage` e o SQLite, que não conhece agentes.

## Decisão

- **`work/mission-ui-prototype` é a única superfície de produto.** `Frontend/` fica
  congelada como referência visual e continua citada no audit de honestidade; nenhuma
  funcionalidade nova nasce lá.
- **SQLite é o registro.** No P0-T, a biblioteca de agentes/equipes passa a vir da API; a
  camada de `localStorage` deixa de ser fonte de verdade e vira no máximo cache de UI. A
  migração dos dados já existentes no navegador do usuário é uma exportação importável, não
  uma conversão silenciosa.
- Preferências de aparência continuaram no navegador enquanto não houver backend de
  preferências — é o estado da arte honesto, não uma dívida a esconder.

## Consequências

- Refatorar `HaneApp.jsx` (888 linhas) antes de adicionar telas de equipe.
- O `runtime-honesty-audit.md` passa a exigir, para cada superfície, de onde vem o dado — se
  é SQLite, é REAL; se é navegador e a UI diz "persistente", é PARTIAL.

# ADR-0006 — Código em Apache-2.0, fonte em OFL 1.1, marca fora da licença

Status: aceito (Lucas escolheu as três partes em 2026-10-10).

## Contexto

O repositório é público desde o `3246f45` sem `LICENSE`, sem campo `license` no `package.json`
e sem header de copyright em arquivo algum. Sem licença o padrão legal é *all rights reserved*:
quem clona para contribuir está em terreno indefinido, e a estratégia que pede catálogo
comunitário e Hane Packs compartilháveis não tem em que se apoiar.

A exigência original tinha uma contradição de formulação: "o Hane é open source, mas usar o
nome, logo, tipografia, código ou afins sem autorização, com ou sem fins lucrativos, não é
permitido". Para **código** as duas metades se excluem — licença aberta *é* a autorização prévia.
A separação que resolve é a que o direito já faz: copyright de código, marca e fonte são três
objetos com mecânicas diferentes, e dá para tratar cada um no instrumento certo.

## Decisão

- **Código: Apache-2.0.** Sobre MIT por duas razões concretas: a seção 6 nega nominalmente
  direito sobre nomes comerciais e logotipo, então a proteção de marca nasce dentro da licença
  em vez de depender de um aviso solto; e a concessão de patente com terminação defensiva tem
  valor num mercado onde a estratégia aponta concorrentes financiados.
- **Marca: `TRADEMARKS.md`, fora da licença.** Uso descritivo e de procedência é permitido; dar
  ao seu produto o nome Hane, usar o logotipo ou insinuar endosso precisa de autorização
  escrita. Fork redistribui o código com **o próprio nome** — a exigência é renomear, não pedir.
- **Fonte: SIL OFL 1.1 com Reserved Font Names `Hane Sans` e `HaneSans`.** O Lucas escolheu a
  OFL sabendo que ela é o oposto de "usar a tipografia sem autorização não é permitido": uso,
  embutir e redistribuir são livres, inclusive comercialmente. O que a OFL protege é o **nome**:
  versão modificada não pode se chamar Hane Sans. A proteção de tipografia deste projeto é o
  mecanismo de RFN, ponto. Se a intenção for proibir uso, o instrumento tem que ser outro
  (licença proprietária de fonte) e isso reabre este ADR.
- **Artefatos de terceiros removidos do rastreamento** no mesmo commit: 855 arquivos de perfil
  de navegador (`work/**/chrome-qa`) estavam trackeados e publicados. Medidos: zero cookies e
  uma linha de histórico, `http://localhost:5173` — sem incidente de privacidade, mas eram
  binários de componentes do Google sem atribuição dentro de um repo que se diz o código do Hane.
- **`Frontend/` fica, com a proveniência declarada ao lado** (`Frontend/README.md`): é export do
  Figma Make, e a licença raiz não faz alegação sobre ele, porque não verifiquei os termos sob
  os quais a saída daquela ferramenta pode ser redistribuída.

## Alternativas rejeitadas

- **BSL-1.1 / source-available** — casa com "usar código sem autorização não é permitido", mas
  mata a palavra *open source*, afasta contribuidores e quebraria a premissa de ecossistema.
- **AGPL-3.0** — protegeria contra hospedadores comerciais; num produto local-first e BYOK, onde
  quase ninguém hospeda, o custo recai sobre quem contribui e o benefício é teórico.
- **MIT** — perfeitamente defensável; perderia a cláusula de marca e a de patente. Se um dia a
  marca deixar de importar, MIT é o downgrade natural.
- **Fonte proprietária restrita** — era a leitura literal da frase original. Rejeitada pelo Lucas
  em favor da OFL.

## Consequências

- `LICENSE`, `src/Hane fonts/OFL.txt` e as duas cópias em `public/fonts/` entram no repo; os
  textos são verbatim das fontes canônicas, com só os cabeçalhos de autoria preenchidos.
- `package.json` ganha `"license": "Apache-2.0"` e `"author"`, e o `README.md` ganha a seção
  *License* — os dois arquivos estavam sendo editados pela outra sessão e só entraram depois que
  aquilo landou, para não misturar linha alheia neste commit.
- O histórico público continua contendo os artefatos removidos; sumir de verdade exige rewrite
  e `push --force`, que é decisão do Lucas.
- `SECURITY.md` e `CONTRIBUTING.md`, que a estratégia também pedia, ficaram para depois —
  sem eles a licença já vale, mas o repo ainda não diz como reportar vulnerabilidade.
