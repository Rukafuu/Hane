# Milestone 1 — base do Hane Teams (P0-T)

Escopo: **entidades persistentes e contrato**. Este milestone não altera o fluxo
operacional (`ROLE_FLOW`), não adiciona tela e não toca em `HaneApp.jsx`. Sai daqui um
backend real que a UI de equipe (hoje em `localStorage`) passa a consultar.

Dependência de entrada: **P0-S resolvido** (fronteira do browser incondicional, ver
`docs/decisions.md` ADR-0002). Se as rotas novas nascerem atrás do guard acoplado ao perfil,
a dívida se replica.

Números de migração: **8, 9, 10**. O id 7 já foi tomado pelo trabalho de perfil na árvore
(`local_personal_profile`); a numeração é append-only e nunca se reusa número aplicado.

## Deliberações de escopo

- **Sem campos de apresentação** (cor, forma, avatar) no modelo. Vivem nas preferências do
  navegador até existir uma migração de apresentação desenhada. Evita o `localStorage` virar
  fonte de verdade por ausência de lugar onde guardar.
- **Sem `role` no agente ainda.** Mapear agente → papel do preset é o P0-U. Antecipar aqui
  seria desenhar o contrato do fluxo antes do contrato das entidades.
- **Sem execução nova.** `task_runs` ganha apenas `team_id`; o orquestrador continua
  ignorando grupos neste milestone.
- Limites de texto alinhados aos que a UI da outra sessão já valida (nome 2-80, descrição
  ≤ 1000, instruções ≤ 12000) para que a migração do navegador não perca dado.

---

## Tarefa 1 — `Agent` como entidade de domínio

- **Objetivo:** um agente persistível com identidade própria e provedor opcional.
- **Arquivos:** `src/teams/agent.js` (novo), `test/teams-agent.test.js` (novo).
- **Dependências:** nenhuma.
- **Complexidade:** S.
- **Critérios de aceite:** `assertAgent` normaliza e congela; nome 2-80 após trim; descrição
  ≤ 1000; instruções ≤ 12000; `providerLabel` ou `null`, e quando presente casa com o padrão
  de label de provedor já existente (`LABEL_PATTERN` em `src/providers/provider-config.js`);
  `id` é UUID. Campos de segredo (`apiKey`, `token`, `credential`) são **recusados**, como
  `assertProviderConfig` já faz.
- **Testes:** aceita o mínimo, recusa nome curto/longo, recusa `null` id, recusa campo de
  credencial, congela o objeto retornado.
- **Risco de regressão:** nenhum — módulo novo. Risco real é desenhar validação divergindo do
  `preferences.js` da UI; o teste âncora usa os mesmos limites.

## Tarefa 2 — `Team`, membros e invariantes

- **Objetivo:** equipe de 1 a 8 agentes, líder opcional, agente exclusivo de uma equipe.
- **Arquivos:** `src/teams/team.js` (novo), `test/teams-team.test.js` (novo).
- **Dependências:** T1.
- **Complexidade:** M (as invariantes são o produto).
- **Critérios de aceite:** `members` tem ≤ 8 ids **únicos**; `leaderAgentId` só pode ser um
  membro, ou `null`; um agente com `exclusive: true` pertence a uma única equipe; a ordem dos
  membros é significativa (índice `position`) e preservada; excluir o líder do time zera a
  liderança (não deixa referência pendurada).
- **Testes:** 8 membros passa e 9 falha; duplicata falha; líder fora dos membros falha; líder
  removido vira `null`; exclusividade com dois times falha; ordem preservada.
- **Risco de regressão:** a UI da outra sessão já codifica essas regras no navegador. Se o
  backend divergir (p.ex. permitir 10), a migração de `localStorage` passa a ter dados
  inválidos. Teste de paridade com `validateLibrary` de `preferences.js` documenta os limites
  idênticos.

## Tarefa 3 — Migrações 8, 9 e 10

- **Objetivo:** schema aditivo, sem tocar em tabelas existentes.
- **Arquivos:** `src/storage/migrations.js`, `test/migrations.test.js`.
- **Dependências:** T1, T2.
- **Complexidade:** S/M.
- **Critérios de aceite:** `agents`, `teams`, `team_members` (com índice único parcial para
  exclusividade) e `task_runs.team_id` NULL, com `REFERENCES teams(id)`. `DELETE FROM teams`
  com execução referenciando falha por FK — histórico não se perde por apagar equipe; por
  isso `teams.archived_at` existe (nullable) como forma não destrutiva de remover da lista.
  Banco antigo (só ids 1-6) migra sem perda; `latestMigrationId()` passa a 10.
- **Testes:** migração sobre banco vazio e sobre banco no estado do `main`; FK bloqueia
  exclusão de equipe com execução; índice único bloqueia segundo time para agente exclusivo;
  `PRAGMA foreign_keys = ON` continua ativo no `openHaneDatabase`.
- **Risco de regressão:** médio-baixo. Aditivo, mas **nunca** editar migração aplicada. Se a
  fatia de perfil tomar o id 8 antes, o número sobe — e não se reusa 7 nem 8 em banco
  existente.

## Tarefa 4 — Stores SQLite

- **Objetivo:** `SqliteAgentStore` e `SqliteTeamStore` com as mesmas convenções dos stores
  existentes.
- **Arquivos:** `src/storage/sqlite-agent-store.js`, `src/storage/sqlite-team-store.js`
  (novos), `test/sqlite-team-store.test.js` (novo).
- **Dependências:** T3.
- **Complexidade:** M.
- **Critérios de aceite:** construtor aceita `{database}` ou caminho, chama `migrate`;
  `upsert`/`save` em transação `BEGIN IMMEDIATE`; `list` determinístico por
  `created_at, id`; `getTeam` traz membros ordenados com flag de exclusividade; a regra das 8
  é imposta aqui também (erro de domínio, não só de UI); nenhuma coluna guarda segredo.
- **Testes:** round-trip agente e equipe; duas equipes com o mesmo agente exclusivo → erro;
  oitava member passa, nona falha; `list()` ordenado; transação desfaz escrita parcial.
- **Risco de regressão:** baixo. Cuidado com `list()` de missões, que tem um teste antigo
  asserts as chaves exatas da linha — não adicionar `teamId` a esse `SELECT` nesta tarefa.

## Tarefa 5 — Rotas HTTP de gerenciamento

- **Objetivo:** API real para o que a UI hoje simula no navegador.
- **Arquivos:** `src/server/teams-api.js` (novo, no formato `handle(request, response)`),
  **um hunk** em `src/server/mission-server.js`, `test/teams-api.test.js` (novo).
- **Dependências:** T4 e **P0-S** (as rotas são mutantes).
- **Complexidade:** M.
- **Critérios de aceite:** `GET/POST /api/agents`, `GET/PUT/DELETE /api/agents/:id`,
  `GET/POST /api/teams`, `GET/PUT/DELETE /api/teams/:id`,
  `PUT/DELETE /api/teams/:id/members/:agentId`, `PUT /api/teams/:id/leader`,
  `GET /api/teams/:id/executions`. Violação de invariante = `400` com a mensagem do domínio;
  recurso inexistente = `404`; exclusividade conflitando = `409`; apagar equipe com histórico
  = `409` apontando para `archive`. Respostas nunca incluem instruções de agente na listagem
  (só no `:id`), por paridade com `/api/skills`. Nenhum segredo em resposta, e
  `providerLabel` só é aceita se a config existir (senão `409` com hint da CLI).
- **Testes:** CRUD de agente e equipe, 9º membro rejeitado, líder fora de membros rejeitado,
  exclusividade entre equipes, `404`/`409`/`400` distintos, payload vazio em PUT, listagem sem
  instruções.
- **Risco de regressão:** médio por tocar em `mission-server.js`, que está sendo editado por
  outra sessão. Mitigação: módulo próprio, um único ponto de inserção, e re-leitura do arquivo
  imediatamente antes do hunk.

## Tarefa 6 — CLI `hane agent` e `hane team`

- **Objetivo:** o mesmo contrato para quem não usa a UI, como já existe para provider/skills.
- **Arquivos:** `src/cli/manage-teams.js` (novo), `src/cli/main.js` (dispatch + `USAGE`),
  trechos em `test/cli.test.js` (novo bloco, sem editar os existentes).
- **Dependências:** T4.
- **Complexidade:** S/M.
- **Critérios de aceite:** `hane agent add|list|show|remove`,
  `hane team add|list|show|member add|member remove|leader set|archive|remove`; strings em
  inglês; exit codes do projeto (0 sucesso, 1 erro de uso/config, sem `process.exit` dentro do
  `runCli`); `--json` nas listagens que a UI consome.
- **Testes:** happy path de equipe de 8 pela CLI, 9º membro → exit 1 com hint, `leader set` de
  quem não é membro → exit 1, `archive` não apaga execução.
- **Risco de regressão:** `main.js` é arquivo disputado. Reler antes de editar; não mexer no
  `USAGE` além de acrescentar linhas.

## Tarefa 7 — Execução vinculada a grupo (sem mudar o fluxo)

- **Objetivo:** cumprir "separação entre grupos e execuções" com o vínculo persistido.
- **Arquivos:** `src/task-run.js`, `src/storage/sqlite-task-repository.js`,
  `src/server/mission-server.js` (payload de `POST /api/missions`), `src/cli/run-mission.js`,
  testes de tarefa/repositório.
- **Dependências:** T3, T4, T5.
- **Complexidade:** M — é a única tarefa que encosta no runtime.
- **Critérios de aceite:** `TaskRun` aceita `teamId` opcional, valida UUID ou `null`, grava no
  snapshot e em `task_created`; repositório persiste e devolve; uma execução com `teamId` de
  equipe inexistente é recusada **na borda** (HTTP `400` / CLI exit 1), não no banco; o
  orquestrador continua rodando o preset de três papéis exatamente como hoje, e o evento
  auditoriado registra o vínculo. Missões antigas (`teamId` ausente) carregam e resumem igual.
- **Testes:** round-trip de `teamId`, missão legada sem campo resume normalmente, execução com
  equipe inexistente recusada na borda, auditoria contém `teamId` quando houver.
- **Risco de regressão:** **o mais alto do milestone** — `task-run.js` e a store de tarefas são
  nucleares e o `fromSnapshot` é usado por retry/aprove. Mitigação: campo estritamente opcional
  e sem mudança de comportamento quando ausente, e rodar `npm run verify` inteiro, não só o
  arquivo.

## Tarefa 8 — Contrato publicado para a UI

- **Objetivo:** a sessão dona do protótipo poder migrar `localStorage` → API sem me pedir
  contexto.
- **Arquivos:** `docs/teams-api.md` (novo), atualização de `README.md` (rotas + CLI) e de
  `docs/runtime-honesty-audit.md` (linha "Configurable agents and teams": NOT IMPLEMENTED →
  PARTIAL com evidência).
- **Dependências:** T5, T6, T7.
- **Complexidade:** S.
- **Critérios de aceite:** cada rota com método, payload, códigos de erro e o header de
  fronteira exigido pelo P0-S; exemplo de `curl` loopback real; nada documentado como existe
  sem estar.
- **Testes:** os exemplos de `curl` do doc são os mesmos dos testes de integração.
- **Risco de regressão:** documentar capacidade que a UI ainda não consome — por isso o audit
  fica em PARTIAL até o consumo real.

## Tarefa 9 — Verificação ponta a ponta

- **Objetivo:** provar o critério de saída do P0: *equipe sobrevive a restart e executa sem
  dados fictícios*.
- **Arquivos:** nenhum novo; rotina de verificação.
- **Dependências:** T1-T8.
- **Complexidade:** S.
- **Critérios de aceite:** `npm run verify` verde; com `hane serve --db <tmp>` criar equipe de 3
  pela API, matar o processo, reabrir, ver a equipe intacta, disparar uma execução com
  `teamId` contra provider fake, e ver `team_id` na linha de `task_runs` e no JSON de
  `GET /api/missions/:id`; nenhuma coluna de segredo populada.
- **Risco de regressão:** falso-positivo de teste que depende de `dist/` do protótipo (já
  aconteceu com o teste de packaging do Sites). A verificação roda na raiz, sem build.

---

## Fora deste milestone (e por quê)

- **Roteamento de provedor por agente no fluxo** — P0-U; exige que o orquestrador receba
  agente por papel.
- **Delegação e liderança em execução** — P0-U; é decisão de fluxo, com orçamento e ciclo a
  provar antes.
- **Telemetria de tokens/custo** — P1; o adapter nem pede `usage` ainda.
- **Migração dos dados do navegador** — depois de T8, como exportação/importação explícita.
- **Tela de equipes** — só quando existir o que mostrar; a UI atual já é honesta sobre o limite.
