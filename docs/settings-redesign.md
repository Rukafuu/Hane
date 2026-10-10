# Redesign de navegação e configurações — 2026-10-10

## Auditoria

A interface funcional é `work/mission-ui-prototype`: React 19, Vite 6, Phosphor e anime.js v4, com CSS e Hane Sans 0.4. `Frontend` é um scaffold separado e não foi alterado. A navegação existente era controlada por estado; as páginas de configurações agora usam hashes `#settings/<seção>`, com retorno ao workspace e suporte ao histórico do navegador.

O runtime Node mantém execuções e auditoria em SQLite, expõe `/api/missions`, `/api/providers`, `/api/onboarding`, `/api/workspace` e SSE. O cofre do Windows guarda credenciais. Preferências e perfis já eram locais ao navegador; uma camada de acesso validada mantém essa fronteira.

## Entrega operacional

- Central com 18 seções, categorias, busca por nome/palavras-chave, foco e navegação por setas/Home/End; conteúdo e navegação rolam independentemente.
- Temas Meia-noite, Floresta e Hane claro com miniaturas; cor hexadecimal, paleta e reset exclusivo da cor; fonte, escala, peso, densidade, largura e painel; redução de movimento respeitada pelo CSS e anime.js.
- Preferências persistentes de início e avisos internos. Exclusões de perfis/grupos respeitam a opção de confirmação. Não há ações de atualização ou idioma fictícias.
- Biblioteca local de perfis: pesquisa, criação, edição, duplicação, nome, descrição, forma/cor, escopo global/exclusivo; associação desejada ao provedor/modelo e instruções em rascunho. Perfis anteriores do onboarding são adotados sem apagar sua chave antiga.
- Grupos locais com nome, descrição, cor, até oito integrantes únicos, referência a agente global e líder opcional desejado. Execuções criadas no grupo são vinculadas ao histórico local. Excluir grupo preserva execuções do servidor.
- Limites de chamadas de modelos e ferramentas e provedor padrão enviados para a API real. Nada se inicia automaticamente.
- Monitor de execuções real, provedores/modelos vindos da API, GitHub device flow preservado, transparência sobre permissões, memória e armazenamento.
- Backup JSON de preferências/biblioteca, importação validada com confirmação, sem segredos, permissões de pasta ou SQLite. Falha de persistência produz mensagem visível.
- Workspace com acesso à biblioteca/monitor, grupos pesquisáveis, seções recolhíveis, estados de boas-vindas e configurações do grupo.

## Limites explícitos

Grupos e perfis são metadata neste navegador. O executor continua com planejador, executor e revisor fixos: instruções de perfil, liderança e integrantes personalizados ainda não são executados. Não há coordenação híbrida dinâmica nem paralelismo. Não foi reestruturado o backend.

Adicionar/remover provedores e informar credenciais continuam pela CLI. A API não oferece teste independente de conexão nem descoberta de modelos. A UI mostra comandos e metadados reais, sem afirmar que uma configuração garante disponibilidade.

MCP, Figma e Supabase, memória individual/compartilhada, retenção automática, tokens/custos, idiomas adicionais e distribuição/atualização desktop permanecem indisponíveis. GitHub não tem endpoint de desconexão atual; nenhuma ação fictícia foi adicionada. Backup de SQLite não foi implementado pela interface.

## Arquivos principais

- `src/SettingsCenter.jsx`: páginas e componentes reutilizáveis.
- `src/preferences.js`: armazenamento, normalização e validação da biblioteca.
- `src/HaneApp.jsx`: integração com workspace e grupos.
- `src/hane.css`: tokens, prévias e responsividade.
- `src/api.js`: limites no payload real.
- `src/motion.js`: preferência de movimento.
- `tests/preferences.test.mjs`: validação de backup, limites, escopo e payload.

## Verificação

Build Vite e empacotamento Sites concluídos. `npm run verify` na raiz: 48 arquivos verificados e 198 testes aprovados. Testes da interface/Sites: 16 testes. Revisão no navegador: tema, cor e fonte aplicados imediatamente e preservados após reload; busca, criação de perfil, grupo e abertura no workspace. Viewport de 390 px: nenhum overflow horizontal. Sem chamada paga de IA, autorização OAuth ou modificação de credenciais durante a revisão.

Não houve auditoria completa por leitor de tela, teste em todos os sistemas/DPI, publicação ou validação de uma distribuição desktop. O documento `.docx` surgido no workspace durante o trabalho não foi alterado.
