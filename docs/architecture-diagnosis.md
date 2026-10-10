# Diagnóstico técnico e roadmap — 2026-10-10

Fonte de verdade: código em `main` (`5e06577`) mais o trabalho não-commiteado na árvore de
trabalho. Este documento separa explicitamente o que está **commiteado** do que só existe
**na árvore**, porque o remoto é público e a diferença importa para segurança.

Leitura recomendada junto: `docs/mvp-contract.md` (contrato), `docs/runtime-honesty-audit.md`
(o que é REAL na UI) e `docs/hane-roadmap` implícito no histórico de commits.

## 1. Estado constatado

### Núcleo commiteado

| Camada | Estado | Evidência |
| --- | --- | --- |
| Ciclo de vida | REAL, papéis fixos | `ROLE_FLOW` planner→executor→reviewer em `src/orchestrator.js:13-17`; máquina de estados com transições fechadas em `src/task-run.js:7-17` |
| Orçamento | REAL, dois contadores independentes | `reserveProviderCall` / `reserveToolCall` (`src/task-run.js:83-102`), `maxToolCalls` default 24, extensão só para cima (`extendBudget`, `extendToolBudget`) |
| Auditoria | REAL, append-only | entradas `{at,type,detail}`; o repositório recusa auditoria mais curta ou contador menor (`src/storage/sqlite-task-repository.js:16-22,50-55`) |
| Persistência | REAL | SQLite `STRICT` com migrações numeradas e idempotentes (`src/storage/migrations.js`), handle compartilhado (`openHaneDatabase`) |
| Provedores | REAL, um por execução | config declarativa sem segredo (`src/providers/provider-config.js`), label persistida na missão, retry de transporte não gasta orçamento |
| Ferramentas | `workspace.read` REAL; escrita/processo/rede **declarativos** | containment em `src/workspace-scope.js` + execução em `src/tools/workspace-read.js`; grants não executados ainda vivem só em `src/capabilities.js` |
| Eventos | REAL | loopback HTTP + SSE, snapshot após evento real (`src/server/mission-server.js`) |
| Skills | REAL como dado | manifesto recusa campos executáveis (`src/skills/skill-manifest.js`), CLI `install|list`, `GET /api/skills` |

### Trabalho na árvore, ainda NÃO commiteado (outra sessão)

`src/profile/local-auth.js` (argon2 + cookie `hane_session`), `src/profile/avatar.js`
(sharp), `src/server/profile-api.js`, `src/storage/sqlite-profile-store.js`, migração
**id 7** (`local_personal_profile`), e hunk em `src/server/mission-server.js` que liga tudo
isso. Adicionalmente `package.json` ganha `argon2` e `sharp`: a raiz era
zero-dependência, e isso é uma mudança de política de projeto, não um detalhe de build.
As duas já estão instaladas e existe `package-lock.json` na árvore — reverter é remover
dependência declarada, não só apagar código.

Consequência prática: `src/server/mission-server.js` na árvore depende de
`src/server/profile-api.js`, arquivo não trackeado. Nada que importe o servidor pode ser
commiteado isoladamente agora — é dependência real, não timidez.

## 2. Matriz: implementado × parcial × só visual

| Capacidade da estratégia | Estado | Onde |
| --- | --- | --- |
| Equipes persistentes de até 8 agentes | **Só visual** | `work/mission-ui-prototype/src/preferences.js:28-44` valida e persiste em `localStorage`; `SettingsCenter.jsx:22-28` mostra 1-8 integrantes e líder opcional. Nenhuma tabela, nenhum endpoint |
| Agente global vs exclusivo de grupo | **Só visual** | `groupId` no storage do navegador; o runtime não conhece agentes como entidades |
| Liderança opcional | **Só visual** | `g.leader` no navegador; o executor não tem noção de líder |
| Modelo/provedor por agente | **Inexistente** | hoje é uma config resolvida por execução (`resolveProviderConfig`), com label gravada na missão |
| Execução separada de grupo | **Parcial** | a missão já é entidade própria em `task_runs`; falta o vínculo (sem `team_id`) |
| Delegação estruturada entre agentes | **Inexistente** | a saída de um papel entra como `priorOutputs` no próximo; não há decisão de delegação registrada |
| Timeline de eventos reais | **Real** | auditoria persistida e renderizada no painel do protótipo |
| Tokens e custo | **Inexistente** | o adapter nem pede streaming nem normaliza `usage` (ver `runtime-honesty-audit`) |
| Aprovação humana | **Real** | `awaiting_approval` + `approve` limpa executor/revisor e estende orçamento |
| Cancelamento | **Real** | `AbortSignal` propagado até o provider, persistido antes da primeira chamada |
| Avatares animados | **Parcial** | estado derivado de evidência persistida (`avatar-runtime.js`); piscada é decorativa |
| Desktop (Tauri) | **Inexistente** | só CLI + serve; sem empacotamento |
| Hane Packs (export/import de equipe) | **Inexistente** | existe export de *preferências do navegador* (`SettingsCenter.jsx:38-39`), não de equipe |
| Skills locais versionadas | **Real como dado** | `src/skills/` + id 6 |
| Fronteiras de memória por grupo | **Inexistente** | nem grupo existe no runtime |
| `Frontend/` (Figma Make) | **Mock** | fonte de design, sem wiring; segunda superfície de UI competing com o protótipo |

## 3. Dívida técnica e acoplamento

1. **Duas fronteiras de segurança sobrepostas.** A outra sessão pôs validação de origem
   dentro de `profile-api.js`, que só é instanciada se `profileStore` existir. Sem o perfil,
   o router de missões não valida origem nenhuma. Segurança atrelada a um feature
   não-relacionado é um guardrail que se quebra por acidente.
2. **A UI ativa promete mais do que o runtime entrega, no lado certo.** O protótipo descreve
   grupos/agentes com honestidade ("ainda não suportado pelo executor"), mas a *fonte de
   verdade dos dados* migrou para o navegador. Isso inverte o local-first: o SQLite deveria
   ser o registro, e hoje é o `localStorage`.
3. **`HaneApp.jsx` continua monólito** (888 linhas) e `hane.css` com 624: qualquer fatia de
   Teams vai disputar hunks ali. Refatorar antes de adicionar telas, não depois.
4. **Vocabulário duplicado.** `mission` / `execução` / `grupo` / `equipe` / `team` coexistem.
   A estratégia chama o produto de Hane Teams; a UI chama GRUPOS; o código chama mission.
5. **Zero cobertura na fronteira do browser.** Todos os 198 testes atuais falam com o
   servidor sem `Origin`/`Sec-Fetch-Site`, ou seja, passam por fora de qualquer regra de
   origem. Não há teste que falhe se a validação de origem for removida.

## 4. Segurança — o que está errado hoje no `origin/main`

O `main` pushado (público) não checa `Origin`, `Host` nem `Content-Type`, e aceita corpo em
qualquer tipo MIME (`readJsonBody`, `src/server/mission-server.js:296-320`). Uma página
aberta no navegador do usuário pode:

```js
fetch('http://127.0.0.1:7788/api/missions', {
  mode: 'no-cors',
  headers: { 'content-type': 'text/plain' }, // request simples: sem preflight
  body: '{"objective":"...","capabilities":[{"name":"workspace.read","scope":"."}]}'
});
```

Isso gasta o orçamento de API do usuário, lê arquivos dentro da raiz do servidor e escreve
linhas no banco dele. Com `hane serve --workspace <dir>`, o escopo lido é o que o servidor
já autorizou por padrão. O mesmo caminho vale para `approve`/`retry`/`cancel` e para o
device flow do GitHub. Não é hypothético: é o padrão CSRF de loopback sem CORS.

Também vale registrar o que **não** é vulnerável: bind em `127.0.0.1` (`serve-mission.js`),
secret só no Credential Manager e nunca em HTTP/SQLite, `workspace.read` com containment
real e deny-list aplicada ao realpath, e saída de LLM que nunca vira comando.

### Decisão tomada: opção A, e o que ainda falta nela

Três formas de fechar isso foram avaliadas:

- **A. Guard incondicional (executada).** Um módulo de fronteira chamado no topo do roteador,
  independente de perfil existir.
- **B. Tornar `checkOrigin` da fatia de perfil incondicional.** Menos código, mas mantém a
  fronteira morando dentro de um feature de perfil.
- **C. Aceitar a dependência do perfil.** Só defensível se o perfil for commiteado nesta
  janela e o README deixar claro que `serve` sem store de perfil é inseguro.

Estado em 2026-10-10, depois de a outra sessão ter montado o perfil no servidor:

- **Landed:** `src/server/request-guard.js` + `test/request-guard.test.js` (10 casos sobre
  soquete real). O payload acima é recusado antes do roteador executar; Host rebinding,
  `Sec-Fetch-Site: cross-site`, `Origin: null` mutante e preflight também.
- **Fechado por eles, mas no MESMO hunk não-commiteado:** `work/mission-ui-prototype/src/api.js`
  agora envia `x-hane-request: 1` em criar/aprovar/repetir/cancelar e no device flow. No `main`
  essas linhas ainda não existem — o header é da fatia de perfil. Cobertura do caminho montado
  no perfil está em `test/local-profile.test.js`, também não-commiteada.
  Consequência: guard e header landam juntos ou caem juntos; se a fatia de perfil for revertida
  sem embarcar o header, `criar execução` quebra em 403 contra qualquer fronteira ativa.
- **Resíduo real:** o guard ainda não está no `mission-server.js`. A proteção hoje existe só
  porque `serve-mission.js` instancia um `profileStore`; `createMissionServer` sem
  `profileStore` — testes, qualquer embutidor — não valida nada. O hunk está escrito em
  `docs/decisions.md` ADR-0002 e depende de a outra sessão parar de editar aquele arquivo.
- **Regra de fusão:** quando `profile-api.js` for commitado, `checkOrigin` delega ao guard e
  fica só com cookie de sessão e lockout. Dois validores de origem não é correção, é a dívida.

Dois fatos da árvore que pesam nessa escolha: o `AGENTS.md` do protótipo registra que
"Bloquear protege a UI/API, não arquivos em repouso" — ou seja, o escopo admitido do trabalho
de perfil é exatamente a fronteira que este item cuida, o que torna a opção B defensável se
o dono dela a tornar incondicional. E o mesmo registro define o onboarding em três etapas com
um "grupo opcional" na terceira: a UI de grupo da outra sessão vai precisar das entidades
deste milestone, não de um storage de navegador.

## 5. Arquitetura proposta

Camadas que o código já sustenta, sem reescrita:

```
UI (protótipo ativo, única superfície)
  ↓ HTTP loopback com fronteira de origem
Local API (mission-server) ── fronteira de request ── sessão local
  ↓
Orchestrator ── estratégia de orquestração (preset planner/executor/reviewer)
  ↓                    ↘ delegação/eventos → auditoria
Agent/Team registry   Tool sandbox (só workspace.read hoje)
  ↓                    ↓
Provider adapters     Workspace scope (containment)
  ↓
SQLite (registro canônico) + OS vault (segredos)
```

Princípios que sustentam a evolução:

1. **Entidade antes de fluxo.** `Agent`/`Team`/`TeamMembership`/`team_id` na execução antes
   de qualquer mudança no `ROLE_FLOW`. O preset atual passa a ser *uma estratégia* rodando
   sobre entidades reais, o que mantém compatibilidade com missões antigas (`team_id` NULL).
2. **Determinístico por padrão, LLM só dentro de limites.** Delegação é decisão estruturada
   registrada em auditoria, com profundidade e orçamento por agente; nada de substituir o
   fluxo por um loop livre de decisões de modelo.
3. **SQLite é o registro.** A biblioteca de agentes/grupos sai do `localStorage` para o banco
   na mesma fatia em que a UI passa a consumi-la pela API. Não coexistirem duas fontes.
4. **UI só depois do runtime.** Nada de tela para o que o servidor não faz (regra do
   documento de estratégia, e a regra de ouro do repo).

## 6. Roadmap técnico priorizado

Detalhe executável do P0-T em `docs/milestone-1-teams.md`.

### P0-S · Fronteira do browser (~S) — bloqueia tudo que é mutante
Guardrailing incondicional + testes de origem/Host/MIME + header explícito no `api.js` do
protótipo. Critério de saída: uma requisição cross-site com `text/plain` é recusada antes do
roteador, e um teste falha se a regra for removida.

Parcialmente cumprido: o guard e os testes existem (`src/server/request-guard.js`,
`test/request-guard.test.js`) e o header do protótipo foi embarcado. Falta o um-hunk de
montagem em `mission-server.js`, que hoje só herda a proteção quando um `profileStore` existe.

### P0-T · Hane Teams, base (5 tarefas)
Entidades persistentes, limite de 8, líder opcional, vínculo de execução a grupo, API HTTP +
CLI. Não toca no `ROLE_FLOW`. Critério de saída: um grupo sobrevive a restart e uma execução
nova carrega `team_id` real.

### P0-U · Teams de verdade no runtime (3 tarefas)
Estratégia pluggable com preset atual, um registro de agente por papel, roteamento de
provedor por agente, `priorOutputs` virando contexto por agente. Critério: preset de 3 papéis
roda sobre entidades persistidas, e uma missão antiga ainda resuma.

### P1 · Observatory (4 tarefas)
Eventos granulares por agente, handoff, `usage` normalizado quando o provider responder,
drill-down evento→agente→ferramenta→evidência. Critério: uma execução é auditável ponta a
ponta sem inventar nada.

### P2 · Desktop (avaliar antes de decidir)
Empacotamento (Tauri 2 vs Electron vs binário Node), credencial multiplataforma (o guard
Windows-only hoje é honesto e precisa de par no macOS/Linux), sandbox real para escrita.
Ver ADR-0004.

### P3 · Ecossistema
Hane Packs = export/import das entidades P0-T sem segredos, com resumo de permissões na
instalação. Só depois de P0-T existir.

### Adiado conscientemente
Marketplace, sincronização entre máquinas, memória compartilhada entre grupos, voz,
orquestração livre por LLM, qualquer ferramenta de escrita/processo/rede sem sandbox.

## 7. O que deliberadamente não muda

Nenhuma reescrita do núcleo. Orçamento, auditoria append-only, containment de workspace,
retry de transporte separado de orçamento, cancelamento com `AbortSignal` e o secret fora de
discos/HTTP ficam exatamente como estão — são os mecanismos que dão crédito à promessa de
transparência, e o diferencial competitivo não sobrevive sem eles.
