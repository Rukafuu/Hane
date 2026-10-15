# Hane Teams — contrato de persistência

Esta primeira entrega persiste agentes, equipes, membros e o vínculo de execuções em SQLite. A interface usa a API para gerenciar agentes e grupos; cores e avatares continuam no navegador. A biblioteca antiga permanece disponível para importação explícita. O runtime continua executando o preset planner → executor → reviewer; as instruções, o provedor e a liderança dos agentes cadastrados ainda não governam essa execução.

## Fronteira de acesso

As rotas passam pelo guard de Host, Origin e conteúdo do servidor, mesmo sem perfil pessoal. Quando existe perfil local, todas as rotas de equipes exigem sua sessão. Requisições mutantes de páginas autorizadas enviam Content-Type: application/json e x-hane-request: 1. Credenciais nunca são campos de agentes ou equipes.

## Agentes

- GET /api/agents → {agents:[...]}. Listagem omite instructions.
- POST /api/agents → 201 com o agente criado; id gerado pelo servidor.
- GET /api/agents/:id → agente completo, incluindo instructions.
- PUT /api/agents/:id → atualização parcial; objeto vazio é recusado.
- DELETE /api/agents/:id → {removed:true}; recusa enquanto o agente pertence a uma equipe.

Payload de criação: {name, description?, instructions?, providerLabel?, exclusive?}.
Nome: 2–80 caracteres após trim; descrição: até 1000; instruções: até 12000. providerLabel é null ou referência a um provedor configurado. exclusive é booleano e impede que o agente participe de mais de uma equipe, inclusive equipes arquivadas. Tornar exclusivo um agente já compartilhado é recusado.

## Equipes

- GET /api/teams → {teams:[...]}, incluindo equipes arquivadas com archivedAt.
- POST /api/teams → 201 com a equipe criada; id gerado pelo servidor.
- GET /api/teams/:id → equipe, membros ordenados e líder opcional.
- PUT /api/teams/:id → atualização parcial, validada atomicamente.
- DELETE /api/teams/:id → {removed:true}; histórico de execuções impede exclusão.
- POST /api/teams/:id/archive → preserva equipe, membros e histórico; define archivedAt. Recusa enquanto há execução aberta.
- POST /api/teams/:id/restore → limpa archivedAt; uma equipe ainda ativa é recusada.
- POST /api/teams/:id/pin e POST /api/teams/:id/unpin → fixam e desafixam a equipe; pinned_at é hora ISO ou null.
- PUT /api/teams/:id/members/:agentId → adiciona um integrante; duplicata é recusada e a inclusão acontece só quando nenhuma execução está aberta.
- DELETE /api/teams/:id/members/:agentId → 409. Integrante de equipe persistida não sai: a composição só cresce, no editor e no armazenamento.
- PUT /api/teams/:id/leader com {leaderAgentId: UUID|null} → define ou limpa liderança.
- GET /api/teams/:id/executions → {executions:[{id,objective,status}],activeExecution:{id,status}|null}.
- GET /api/teams/:id/events → {events:[{id,type,agentId,detail,createdAt}]}, na ordem em que aconteceram.

Payload de criação: {name, description?, members:[UUID,...], leaderAgentId?:UUID|null}.
Equipes têm 1–8 integrantes únicos, existentes; líder deve ser integrante. Ordem é preservada. Uma vez persistida, a composição da equipe só cresce: nenhum integrante sai, nem pelo editor, nem por PUT, nem pelo armazenamento, que recusa o encolhimento. Não há equipe vazia neste contrato; a futura migração da biblioteca do navegador deve tratar rascunhos vazios explicitamente.

Todo time guarda um `revision` inteiro, começando em 1 e subindo a cada escrita — edição, fixação, arquivamento e restauração. Um PUT pode levar `expectedRevision` opcional: se o número lido não for mais o número gravado, a escrita é recusada com 409 em vez de sobrescrever o que outro escritor já mudou. Um `{expectedRevision}` sozinho não é uma atualização e volta 400.

Cada mudança de composição, nome, descrição, liderança, fixação, arquivamento e restauração grava uma linha em `team_events`, com `type`, o `agent_id` envolvido quando houver, um `detail_json` mínimo e a hora. Uma escrita que não muda nada não registra nada, então uma tentativa repetida não enche o histórico de duplicatas. As linhas pertencem ao time: excluir a equipe exclui seu rastro, o que evita registro órfão.

Uma execução "aberta" é aquela que o scheduler ainda pode retomar sozinho: planned, executing ou reviewing. Enquanto houver uma, a equipe não ganha integrante nem é arquivada, e as duas rotas retornam 409. Uma missão em draft, que nunca rodou, não prende a equipe — e uma parada esperando uma decisão humana (`awaiting_approval`, `needs_attention`) também não, porque a repetição relê a composição que a execução gravou quando nasceu: mexer na equipe depois não alcança nada dela. O estado pode ser lido em `activeExecution` antes de avisar o usuário quando a mudança terá efeito.

## Execuções

POST /api/missions aceita teamId opcional. UUID inválido, equipe inexistente ou arquivada são recusados antes da execução. O vínculo é persistido em task_runs.team_id, registrado em task_created e entregue no snapshot/SSE. Uma execução salva não pode mudar de equipe. Missões antigas continuam sem teamId no JSON e mantêm o comportamento anterior.

Vincular uma execução organiza seu histórico; não significa que os integrantes cadastrados foram executados. Roteamento por agente e composição operacional pertencem à próxima etapa.

## Erros

- 400: conteúdo inválido, UUID inválido, duplicata, limite de integrantes, líder fora da equipe, atualização vazia, restaurar uma equipe ativa ou expectedRevision inválido.
- 401: perfil existente sem sessão autenticada.
- 403/415: recusa da fronteira do navegador.
- 404: recurso inexistente nas rotas de gerenciamento.
- 409: exclusividade conflitante, provedor inexistente, remoção de agente vinculado, equipe com histórico, edição de uma equipe arquivada, execução aberta travando inclusão ou arquivamento, ou revisão desatualizada.
- 405: método não suportado.
- 503: servidor embutido sem armazenamento de equipes disponível.

## CLI

hane agent add --name "Orion" [--description "..."] [--instructions "..."] [--provider label] [--exclusive]
hane agent list|show|remove [id]
hane team add --name "Dev Team" --member UUID [--member UUID]
hane team list|show|archive|restore|pin|unpin|remove|events [id]
hane team member add TEAM_UUID AGENT_UUID
hane team member remove ... → recusa: a composição de uma equipe persistida só cresce.
hane team leader set TEAM_UUID AGENT_UUID|none
hane run "Objetivo" --team TEAM_UUID

Todos os comandos de gerenciamento aceitam --db e --json. Nenhum cadastro executa IA ou concede ferramentas. As chamadas continuam usando o provedor e os grants da execução.

## Migrações e verificação

Migrações aditivas: 9 persistent_agents, 10 persistent_teams, 11 execution_team_link. A migração 8 de recuperação permanece intacta. A migração 12 adiciona recibos de importação, sem alterar execuções existentes. Não foram migrados os dados pessoais do usuário nesta entrega: os testes usam bancos temporários.

A suíte cobre domínio, exclusividade, ordem, rollback, limite de oito, liderança, integridade do histórico, compatibilidade de missões antigas, reabertura de arquivo SQLite, CRUD HTTP, guard sem perfil, sessão, CLI e uma execução do preset registrada no SQLite e no SSE. O provedor dessa prova é um double restrito aos testes; não é validação de chamada externa.

Exemplo de leitura com o servidor local disponível:

```powershell
curl.exe http://127.0.0.1:7788/api/teams
```

Exemplo de criação por uma página autorizada (com cookie de sessão quando houver perfil):

```http
POST /api/agents
Origin: http://localhost:5173
Content-Type: application/json
x-hane-request: 1

{"name":"Orion","instructions":"Planeje etapas verificáveis","exclusive":false}
```

Verificação em 2026-10-10: npm run verify aprovou 329 testes e a checagem de sintaxe de 78 arquivos na árvore compartilhada. A regressão de cadastro em localhost:4173 foi corrigida usando a mesma lista explícita de origens no servidor e na API de perfil. Nenhuma chamada a um provedor externo foi feita.

## Importação da interface

POST /api/library/import aceita {importId:UUID, agents:[{id:string,name,description?,instructions?,providerLabel?,exclusive?}], teams:[{id:string,name,description?,members:[sourceAgentId],leaderAgentId?:sourceAgentId|null,archived?:boolean}]}. IDs de origem são remapeados para UUIDs gerados pelo servidor. Até 200 agentes, 200 equipes e 4 MiB de JSON; uploads e campos visuais não fazem parte deste payload.

A operação é aditiva e transacional: falhas desfazem todas as inserções, incluindo o recibo. Repetir o mesmo importId e conteúdo devolve os mesmos mapas agentIds/teamIds, inclusive após reiniciar o servidor. Reutilizar importId com conteúdo diferente retorna 409. Guard e sessão são exigidos como nas outras rotas. Nenhuma execução antiga recebe vínculo retroativo.

A interface guarda o identificador por hash do conteúdo no navegador antes de enviar; se esse registro não puder ser salvo, a importação não começa. Limpar esse registro ou importar em outro navegador inicia uma nova importação. O original hane-library não é sobrescrito. Rascunhos vazios são exibidos para escolha de integrantes; reservas exclusivas sem associação exigem revisão explícita. Detalhes e validação em [teams-ui-migration.md](teams-ui-migration.md).
