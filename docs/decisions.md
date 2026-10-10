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
`src/server/request-guard.js` com testes; o wiring incondicional e a fusão com perfil estão concluídos.

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

REAL (2026-10-10) nas rotas de missão e onboarding: `createMissionServer` monta o guard uma vez e
o chama antes do roteador — `RequestGuardError` responde com o seu próprio status, e a recusa não
chega a escrever linha nenhuma em `task_runs`. `createMissionServer` ganhou `bindHost` (o CLI passa
o `--host` com que fez `listen`); sem ele o servidor assume `127.0.0.1`, porque é o default do CLI,
e quem se ata fora do loopback tem que passar o valor para não recusar o Host dos próprios
clientes. `isLoopbackHost` passou a ser o dono único dessa palavra e aceita `::1` com ou sem
colchetes e com ou sem porta — o header `Host` e o argumento `--host` chegam em formas
diferentes e precisam dar a mesma resposta. A lista de origens aceitas é uma só por servidor: o
mesmo array vai para o guard e para o perfil, com o default declarado no servidor (o
`src/server/ui-origins.js` que está na worktree é o lugar natural desse default quando landar;
mover para lá não cria segunda lista porque uma só chamada abastece as duas).

Provas em `test/mission-server.test.js` (sete casos de socket contra o roteador real): POST
`text/plain` com `Sec-Fetch-Site: cross-site` em `/api/missions` morre em 403 **sem linha em
`task_runs`**; mutação de página sem `x-hane-request` idem; `Host` rebinado morre antes da rota;
origem fora da allowlist responde 403 com a flag que conserta; a origem default do protótipo chega
ao roteador e cria a missão com 202 sem nenhuma configuração passada; e um servidor informado de
`0.0.0.0` responde ao Host da LAN enquanto o mesmo Host é recusado no bind loopback.

Fusão concluída em 2026-10-10 (Lucas pediu mensagens de fronteira em inglês e fechamento
do risco localhost): o servidor chama o guard antes de qualquer rota, incluindo perfil;
`createProfileApi` reutiliza a mesma função de guard, inclusive quando instanciada sozinha.
`Origin: null` (ou `nil`) é recusado em leitura e mutação. Corpos de página exigem MIME
`application/json` exato (parâmetros como charset são aceitos); a única exceção de imagem
é `POST /api/profile/avatar`, com PNG, JPEG, WebP ou GIF e todas as verificações de origem,
Host, Fetch Metadata e `x-hane-request: 1` mantidas. As mensagens dessa fronteira são em inglês.
Servidores com perfil preservam a exigência de opt-in também para mutações de clientes locais;
sem perfil, clientes sem identidade de browser preservam o contrato do CLI.
As quatro origens explícitas de desenvolvimento/preview, incluindo `localhost:4173`,
continuam aceitas. Outras portas exigem `--ui-origin`; não existe wildcard de localhost.

## Consequências

- O `api.js` do protótipo precisa enviar o header explícito em `createMission`, `approve`,
  `retry` e `cancel`, ou as três ações quebram em 403. **Já envia, e já está no HEAD**
  (`work/mission-ui-prototype/src/api.js:46,48,60,66` e `src/profile-api.js:1,17,18`) — a
  preocupação original deste ADR, de que header e guard fossem um só entregável, se resolveu
  sozinha: a fatia da UI landou antes. O guard também cobre as rotas de perfil (ver a fusão acima).
- Sem perfil, clientes locais sem header de origem (CLI, testes) permanecem irrestritos, e isso é
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

# ADR-0007 — A caixa é uma distro `.wsl` própria, com `wsl.conf` assado dentro

Status: aceito (Lucas: "beleza, seguimos assim então", 2026-10-10).

## Contexto

O painel "Computador ao vivo" deixou de ser log raspado do plano e virou um loop em que o
modelo pede `read_file`/`list_dir` e o sandbox responde (`d0a1906`). Para escrita, comando e
rede, a decisão do Lucas é uma **máquina Linux separada**, onde os agentes criam arquivos e
pesquisam sem tocar no disco dele — é o que mantém verdadeiro o "Nothing writes to, or
executes inside, your workspace" do `README.md`. As restrições que ele deu são simultâneas:
grátis, sem conta de terceiro, sem dor de cabeça de instalação, e o Hane continua sendo app
desktop **e depois mobile**.

Medido nesta máquina, não presumido (`7457a1e`, `src/machine/detect.js`): WSL 2.7.14.0
responde, `reason: "no_distro"`, e o daemon do Docker não existe (`npipe`
`dockerDesktopLinuxEngine` ausente). Zero distros instaladas.

A doc da Microsoft ([Build a Custom Linux Distro for WSL](https://learn.microsoft.com/en-us/windows/wsl/build-custom-distro))
resolve a parte que eu não podia afirmar antes de decidir: uma distro WSL é **um tar gzip do
rootfs renomeado para `.wsl`**, "can be distributed however you please", instala com
`wsl --install --from-file <caminho>` ou por duplo-clique, sem Microsoft Store e sem conta, e
leva dentro `/etc/wsl-distribution.conf` (OOBE, `oobe.defaultName`) e `/etc/wsl.conf`. Requer
WSL ≥ 2.4.4.

## Decisão

- **A imagem é nossa.** O release do Hane constrói um rootfs mínimo e o publica como
  `hane-box-<versão>.wsl`; o instalador o embute ou o baixa, e a caixa entra com
  `wsl --install --from-file <caminho>`. O nome registrado (`hane`) vem de `oobe.defaultName`
  dentro da imagem, não de flag que eu ainda não verifiquei.
- **A fronteira nasce assada, não configurada depois.** `/etc/wsl.conf` dentro da imagem:
  `[automount] enabled=false`, `[interop] enabled=false`, `appendWindowsPath=false`,
  `[user] default=haneagent` sem `sudo`. Isso é mais forte que o plano original de escrever
  `wsl.conf` após a instalação: a caixa não chega a existir num estado em que vê `C:`.
- **OOBE é onde a rede se monta.** `/etc/wsl-distribution.conf [oobe] command` roda no primeiro
  boot como root **dentro** da distro: é ali que o proxy local e a regra `nftables` com
  `meta skuid` do agente entram, sem elevação no Windows. Sem isso a allowlist de
  `network.request` é decorativa, porque WSL2 dá saída por NAT a qualquer `curl`.
- **Hane mostra e pede; Hane não instala sozinho.** `hane machine install <caminho>` imprime o
  argv exato que vai executar e recusa rodá-lo sem `--yes`; se `hane machine status` disser
  `wsl_not_found`, nada é spawnado. A instalação de distro é escolha visível, como `set-secret`
  é escolha do CLI.
- **Aprovacão humana passa a existir em exceções, não por ação.** Dentro da caixa, escrita e
  comando rodam sem clique. Clique em: (a) trazer um artefato para o disco do usuário,
  (b) egress fora da allowlist concedida, (c) qualquer coisa que tente alcançar o Windows —
  que é configuracionalmente improvável pelo item anterior. Isso reescreve a linha do
  `docs/mvp-contract.md` que prometia "human approval checkpoint at the action level" para
  `workspace.write`/`process.run`/`network.request`.

## Consequências

- O plano da Fase 6 se reordena: **6.2 deixa de ser "`hane machine init` escreve config"** e
  passa a ser "imagem `.wsl` + `wsl --install --from-file`"; o 6.5 (`nftables` + proxy) vira
  conteúdo do OOBE da imagem, não passo pós-instalação no host.
- O que o instalador **não** torna silencioso: habilitar `VirtualMachinePlatform` / instalar o
  runtime WSL quando ele falta. Isso pede administração e, em máquina limpa, pode pedir um
  restart. Precisa ser **medido numa VM limpa** antes de a UI prometer "um clique e a caixa
  existe"; enquanto não for medido, a UI oferece e o `machine status` responde o que falta.
- Custo de distribuição: base de ~50–100 MB por release (Debian minimal; Alpine ~8 MB mas é
  musl, e o ecossistema de wheels de Python assume glibc). Se a caixa já vier com
  `python3`/`pip` utilizáveis sem download, são centenas de MB — decisão de release, não de código.
- Licença e marca: redistribuir um rootfs cria obrigação de oferta de fonte sobre componentes
  GPL, que entra na matriz do `docs/licensing.md`; e a distro se chama **`hane`**, não "Ubuntu",
  coerente com o `TRADEMARKS.md` do ADR-0006.
- Mobile não muda nada, e é aqui que `src/sandbox/interface.js` paga: Android/iOS são clientes
  de um host Hane (a máquina dele, ou uma caixa futura na nuvem). **Quem escolhe backend é o
  host, nunca a UI** — por isso embutir WSL no instalador desktop não fecha o caminho mobile.
- `docs/runtime-honesty-audit.md` continua dizendo a verdade: enquanto nenhum executor de
  escrita/comando existir atrás do seam, `workspace.write`/`process.run`/`network.request`
  seguem NOT IMPLEMENTED, e o comando de instalação é PARTIAL até existir imagem publicada.

## Alternativas rejeitadas

- **`wsl --install -d Ubuntu` no primeiro uso** — grátis e sem conta, mas a caixa seria de
  terceiros, não determinística entre máquinas, e não poderíamos assar `wsl.conf` nela: a
  garantia de "nada vê o C:" viraria um passo que roda depois, não a natureza da imagem.
- **Embutir Docker Desktop** — satisfaz "roda container", mas o Docker Desktop tem termos
  comerciais próprios (licença paga acima de ~250 funcionários ou US$ 10M de faturamento) e um
  daemon que o usuário precisa manter de pé. Arrastar isso para dentro do instalador transformaria
  a licença do produto em dependência de terceiros.
- **Hyper-V direto via HCS/`vmcompute`** — controle total da VM, mas Hyper-V não existe no
  Windows Home, exige mais elevação, e o host da VM passa a ser manutenção nossa.
- **Windows Sandbox (`windows-sandbox-cpp`)** — isolamento do SO com esforço pequeno, porém
  efêmero: o workdir dos agentes não sobrevive, e só existe em Pro/Enterprise.
- **QEMU próprio com kernel nosso** — embutível e sem WSL, mas distribuímos kernel e pagamos a
  performance; o ganho do WSL é ser infraestrutura do Windows já mantida pela Microsoft.
- **Caixa na nuvem no lugar da caixa local** — recusado na ocasião pelas restrições do Lucas:
  Cloudflare Containers exige plano Workers Paid (US$ 5/mês, cobrança a cada 10 ms), E2B Hobby
  dá US$ 100 de crédito com 1 h contínuo de teto e o self-host é Enterprise. A camada de seam
  existe exatamente para isso poder virar backend depois sem reescrever orquestrador, auditoria
  nem UI.

# ADR-0008 — A caixa é compartilhada: o Lucas opera o mesmo Linux dos agentes

Status: aceito (Lucas, 2026-10-10: "escrita e comando permitidos dentro, o usuario usar a VM tanto
quanto os agentes, assim como pode ensinar tarefas a eles").

## Contexto

A ADR-0007 deixou em aberto **quem mais** usa a caixa. A resposta dele fecha a decisão que eu tinha
adotado como default ("a caixa é a fronteira") e acrescenta um requisito: o painel não pode ser um
cofre onde os agentes mexem sem ele ver — ele entra na mesma máquina.

Medido ao instalar a distro nesta máquina (2026-10-10, 18:40): o firmware já tinha virtualização
ligada (`Win32_Processor.VirtualizationFirmwareEnabled: True`, `VMMonitorModeExtensions: True` no
Ryzen 5 5600), `VirtualMachinePlatform` foi habilitado com elevação e respondeu
`RestartNeeded=False`, ainda assim `HypervisorPresent: False` e `wsl --install -d Debian` falhou com
`Wsl/InstallDistro/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED`, sem deixar
distro registrada (`wsl -l -v`: "não tem distribuições instaladas"). Ou seja: **habilitar o recurso
não basta no mesmo boot** — o hypervisor aparece no próximo. É o degrau que a ADR-0007 mandou medir
em VM limpa, medido aqui.

## Decisão

- **Aprovação humana em exceções, não por ação** (ratificada): dentro da caixa, escrita e comando
  correm sem clique. Clique em (a) trazer artefato para o disco do Windows, (b) egress fora da
  allowlist concedida à missão, (c) qualquer coisa mirando o Windows. A frase de
  `docs/mvp-contract.md` ("human approval checkpoint at the action level" para
  `workspace.write`/`process.run`/`network.request`) será reescrita junto com o executor real, não
  antes: enquanto não existir executor, a frase atual não mente.
- **Duas identidades dentro da imagem, e é isso que torna os dois usos simultâneos.** `haneagent`
  (uid 1001, sem sudo, sem grupo privilegiado) é a conta com que o runtime entra —
  `wsl -d hane -u haneagent`, sempre argv array. A conta humana criada pelo OOBE (uid 1000) tem
  sudo `NOPASSWD` **dentro da caixa** e é o usuário padrão de `wsl -d hane`. O `/etc/wsl.conf`
  assado na imagem **não** fixa `[user] default`: fixar em `haneagent` transformaria a máquina dele
  num terminal dos agentes, que é justamente o que ele recusou. (Isso corrige um detalhe da
  ADR-0007, que previa `[user] default=haneagent`.)
- **A allowlist de egress é por uid, não global.** A regra `nftables` com `meta skuid 1001` (S5d)
  prende o agente ao que a missão concedeu e deixa o shell dele livre. Sem isso, "usuário usa a VM
  tanto quanto os agentes" e "egress com allowlist" se contradizem na mesma caixa.
- **Ensinar tarefas é skill, e hoje skill não ensina nada.** `hane skills install|list` persiste
  manifestos `skill.json` no SQLite, mas nada injeta o conteúdo deles no prompt de
  planner/executor/reviewer (medido: `src/orchestrator.js` não referencia skills). A fatia
  "ensinar" é ligar o catálogo existente ao contexto dos papéis, com o texto marcando origem
  não-confiável e a escolha da skill auditada na missão.
- **Builder da imagem: GitHub Actions, runner ubuntu, amd64** (escolha dele). `scripts/box-image/`
  traz o overlay versionado (`etc/wsl.conf`, `etc/wsl-distribution.conf`, `etc/hane-oobe.sh`) e o
  `build-debian-rootfs.sh` que os assa no rootfs, cria `haneagent`, remove `/etc/resolv.conf` e
  empacota `tar --numeric-owner` + gzip renomeado `.wsl`; o workflow publica
  `hane-box-<versão>.wsl` como artefato. `test/box-image.test.js` falha se alguém afrouxar a
  fronteira no overlay.

## Consequências

- O painel "Computador ao vivo" passa a ter duas metades: o que os agentes fizeram (auditoria) e um
  terminal dele na mesma caixa (S5f). Os dois usam o mesmo caminho de spawn, mudando só a
  identidade.
- O fluxo honesto de instalação tem um degrau não clicável: `hane machine status` diz o que falta →
  habilitar a plataforma (UAC) → **reiniciar** → `hane machine install <imagem>`. A UI não pode
  prometer "um clique e a caixa existe".
- `arm64` não é prometido: o runner é amd64, então a imagem construída é a de x86_64.
- A imagem construída no CI é um artefato, não um release publicado: enquanto não houver URL
  assinada/oficial no repo, `hane machine install` continua PARTIAL no
  `docs/runtime-honesty-audit.md` — o portão existe, o que instalar ainda não chega sozinho.
