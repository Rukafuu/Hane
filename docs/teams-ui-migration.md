# Teams na interface e migração da biblioteca

A biblioteca de Configurações → Agentes lê e escreve /api/agents e /api/teams. Nomes, descrições, instruções, provedor desejado, exclusividade, integrantes, liderança e arquivamento ficam no SQLite. A listagem de agentes não fornece instruções; a interface lê os registros completos antes de editar, duplicar ou exportar. Falhas de carga não são substituídas por uma biblioteca fictícia do navegador e bloqueiam os formulários até uma nova consulta.

Cores, formato e imagem do avatar continuam em hane-library-visuals, associados ao ID gerado pelo servidor. Falha em salvar esses dados é informada separadamente: ela não desfaz um cadastro já salvo no SQLite. Preferências gerais e aparência também continuam locais ao navegador.

## Migração explícita

A biblioteca antiga hane-library (ou os agentes de hane-custom-hanes) é mostrada separadamente, com exportação e referências antigas acessíveis. Importar exige ação explícita. O servidor valida e importa agentes e equipes em uma única transação aditiva; nenhum cadastro existente é substituído e nenhuma execução é alterada. A migração 12 guarda um recibo durável por importId e hash do payload.

A interface salva o importId por hash do conteúdo antes de enviar; tentativas após uma resposta perdida usam o mesmo ID. O recibo persiste após reiniciar o SQLite. Se o registro do navegador for apagado, uma importação posterior será nova e poderá criar cópias. Um importId reutilizado para outro conteúdo retorna 409.

Grupos vazios permanecem como rascunhos no arquivo antigo. A ação Escolher integrantes abre a criação de um grupo no servidor, sem inventar agentes. Um agente reservado a um grupo do navegador sem ser integrante exige revisão da associação antes da importação. Provedores ausentes, nomes fora do contrato ou conflitos de exclusividade impedem a importação inteira.

As referências antigas a execuções permanecem acessíveis, mas não se tornam vínculos de equipe no SQLite. Uma execução salva não pode mudar de equipe. Novas execuções abertas num grupo enviam teamId; a listagem e o SSE preservam esse vínculo e a interface filtra pelo ID da equipe.

## Arquivamento e backups

Arquivar um grupo preserva integrantes, exclusividade e histórico; grupos arquivados podem ser consultados, mas não iniciar execuções. Excluir um agente vinculado é recusado pelo servidor, sem removê-lo silenciosamente das equipes.

A exportação JSON versão 2 inclui a biblioteca consultada no servidor, instruções e preferências visuais. Importações das versões 1 e 2 adicionam cadastros e restauram preferências, sem substituir a biblioteca existente. O estado arquivado é preservado; históricos, credenciais, sessões e permissões não são restaurados. Para cópia completa das execuções, continua necessário o backup do SQLite com o servidor encerrado.

O onboarding guarda apenas o nome do primeiro grupo como rascunho; a biblioteca explica que é necessário criar e selecionar ao menos um integrante para persistir a equipe. Não há agentes criados automaticamente.

## Limite operacional desta entrega

O executor continua usando planner → executor → reviewer. Agentes cadastrados, liderança e provedores desejados ainda não mudam o runtime; a interface informa esse limite. A próxima etapa do roadmap é transformar esses cadastros em composição operacional. Nenhuma chamada externa de IA foi feita para validar esta entrega.

## Evidências

Testes HTTP cobrem rollback, importação aditiva, recuperação após reinício, repetição sem duplicação, mudança de payload, exclusividade, validação de origem e sessão, prompts maiores que o limite de uma mutação individual e teamId na listagem de execuções. Testes da interface cobrem prompts completos, IDs gerados, arquivamento sem perda, resposta perdida, armazenamento indisponível e reserva exclusiva sem associação.

A prova no navegador usa apenas banco temporário outputs/teams-ui-qa.sqlite e a origem 127.0.0.1:5174. Foram importados um agente e um grupo antigos, mantido um rascunho vazio e uma referência antiga, criados um agente e um grupo pelo formulário, definida liderança, recarregada a tela e conferidas as instruções importadas. O perfil e o banco do usuário não foram migrados ou modificados por essa prova.

Verificação final em 2026-10-10: npm run verify passou em 349 testes e 80 arquivos de sintaxe; build da interface e os 36 testes de Sites passaram. A prova visual foi realizada em uma origem e banco isolados.
