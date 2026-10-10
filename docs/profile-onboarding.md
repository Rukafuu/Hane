# Perfil pessoal local e primeiro acesso

O Hane abre em três etapas: nome de exibição e opcionais (e-mail, foto, senha), escolha de um provedor já configurado ou configuração posterior, e primeiro grupo ou exploração. Nenhuma etapa dispara agentes, pede permissões de pasta ou conecta contas automaticamente. A identidade pessoal fica separada dos perfis visuais dos agentes. Um perfil pessoal por banco/instalação; múltiplos perfis independentes ficam para depois.

## Persistência e dados existentes

A migração 7 adiciona `local_profiles` e `local_profile_secrets` sem alterar dados das tabelas existentes. Nome, e-mail opcional, referência da foto, datas e etapa de onboarding sobrevivem ao reinício. Grupos, agentes visuais e preferências mantêm a persistência atual do navegador; ainda não há isolamento dessas bibliotecas por identidade. A senha, o verificador, cookies de sessão e fotos pessoais não entram no localStorage. A primeira criação de grupo usa um identificador estável do perfil para permitir repetir uma tentativa sem duplicar o grupo.

O banco padrão é `outputs/hane.sqlite`. Fotos processadas ficam em `outputs/hane.sqlite.profiles/`; `--db` muda ambos. O painel Meu perfil informa o caminho absoluto do SQLite e das fotos. Exportação JSON inclui apenas ID, nome, e-mail opcional, datas e conclusão do onboarding.

## Decisões de proteção

- Argon2id com sal aleatório por verificador, 64 MiB de memória, três passagens e paralelismo 1. O verificador fica em tabela separada, nunca nas respostas de perfil.
- Sessões do servidor em memória, com tokens aleatórios de 32 bytes. O mapa usa SHA-256 do token. Cookie HttpOnly, SameSite=Strict, Path=/api, duração de oito horas. O servidor loopback usa HTTP; não se afirma transporte TLS. Reiniciar o servidor exige novo desbloqueio.
- Após existir um perfil, leituras e ações do runtime, perfil, exportação e fotos exigem sessão. Ativar, trocar ou remover senha existente exige a senha atual e revoga todas as sessões, emitindo uma nova para a janela atual.
- Bloqueio manual revoga todas as sessões e encerra canais SSE. Formulários/fotos e início/retomada de execuções revalidam a sessão após esperas assíncronas. Execuções já iniciadas continuam em segundo plano; bloquear não equivale a cancelar.
- Cinco falhas impõem espera inicial de 60 segundos, crescente até 30 minutos. Contadores persistem no SQLite. Operações criptográficas são limitadas a uma por vez. Sucesso zera falhas.
- Host deve ser loopback. Origem precisa corresponder ao servidor ou à lista explícita de origens da UI. Mutação exige `x-hane-request: 1`; sem CORS aberto. Origens padrão: localhost/127.0.0.1 em 5173. Outras portas exigem `--ui-origin` com origem HTTP loopback exata. Não use origem curinga.

Sem senha, Bloquear Hane é uma pausa de privacidade que qualquer pessoa nesse dispositivo pode desfazer. Com senha, a proteção é aplicada pela API e interface. Banco, fotos, grupos no navegador e arquivos não são criptografados. Processos locais e a CLI continuam no limite de confiança da conta do sistema operacional; não se promete defesa contra quem controla essa conta, acessa o disco ou modifica o aplicativo. A recuperação usa um código offline; não há recuperação por e-mail. Em outras janelas, a interface reconsulta a sessão em até 15 segundos e ao receber foco; a API revoga acesso imediatamente.

## Fotos

PNG, JPEG e WebP são reconhecidos por assinatura e decodificados, não apenas pelo nome/MIME. Padrão: até 5 MiB, 16 milhões de pixels, dimensão máxima 8192, uma imagem estática. Saída: WebP de 256 × 256, orientação corrigida, recorte central, sem metadados originais, com prévia circular. Nomes são UUIDs do servidor; caminhos enviados pelo usuário não são aceitos. Limites são configuráveis via `avatarLimits` ao criar o servidor; a interface consulta os limites do backend. Foto nova é gravada antes de substituir a referência; a antiga é removida depois. Diretório/fotos são ignorados pelo Git. Modos de arquivo restritos são solicitados; no Windows, o controle efetivo depende das ACLs da conta e do volume.

Dependências do backend: `argon2` e `sharp`. `npm ci --include=optional` foi validado no Windows/Node 24.19. As bibliotecas usam binários nativos publicados por seus mantenedores. Referências: [opções de Argon2](https://github.com/ranisalt/node-argon2/wiki/Options), [limites de leitura Sharp](https://sharp.pixelplumbing.com/api-constructor/), [saída e metadados Sharp](https://sharp.pixelplumbing.com/api-output/).

## Validação

Oito testes novos usam SQLite em arquivos temporários, HTTP real, Argon2id e imagens processadas com Sharp: criação/singleton, retomada, edição/exportação, persistência após reinício, limitação de tentativas, rotação/expiração/revogação, bloqueio de APIs e SSE, origem/Host, fotos válidas/falsas/grandes, substituição/remoção e bloqueio durante envio de formulário. Verificação final: `npm run verify` passou com 233 testes; build do frontend passou; `test:sites` passou com 16 testes. A instalação pelo lockfile foi validada com `npm ci --include=optional`.

QA visual em banco separado: criação sem senha, seguir sem provedor, recarregar na etapa 2, criar grupo sem execução, menu com quatro ações, editar nome, bloquear/desbloquear e menu compacto a 390 px sem overflow horizontal. O banco pessoal não recebeu um perfil de teste. A proteção por senha foi verificada por integração HTTP; a QA visual não altera credenciais pessoais.

## Recuperação de senha por código (migração 8)

A recuperação funciona com Node/SQLite e navegador, sem autenticação do sistema operacional. Ativar ou trocar senha gera um código de 256 bits, mostrado uma vez com salvar arquivo de texto, imprimir e confirmação de guarda. O código só permanece em memória da interface até a confirmação; o Hane não o salva em localStorage, exportação de perfil, URL ou logs. O arquivo baixado pelo usuário contém o código em claro e deve ser guardado fora do Hane, em lugar seguro.

A tabela local_profile_recovery guarda apenas SHA-256 do código aleatório, ligado ao perfil, e os contadores de tentativas. Um código de alta entropia difere de uma senha humana: a senha continua usando Argon2id. A comparação do verificador usa timingSafeEqual. A recuperação aceita letras sem distinguir maiúsculas/minúsculas, espaços e hífens, mas exige os 64 dígitos hexadecimais.

POST /api/profile/recover aceita código e nova senha confirmada, usando as mesmas regras de origem e limite de corpo. Uma transação verifica que código e senha anteriores ainda correspondem ao estado validado, substitui os verificadores e zera falhas. Só uma recuperação pode consumir o código. Todas as sessões e canais SSE são revogados; o usuário guarda um novo código e entra normalmente com a nova senha, sem login automático. Nome, e-mail, foto, onboarding, provedores e histórico são preservados.

POST /api/profile/recovery-code exige sessão e senha atual. Gerar outro código invalida o anterior. Desativar senha remove o código; reativar gera um novo. Tentativas de recuperação têm limitação persistida e independente das tentativas de desbloqueio, para que um bloqueio de login não impeça o uso da recuperação. Depois de cinco falhas, a espera começa em 60 segundos e aumenta até 30 minutos. Não há expiração por tempo do código offline: ele vale até uso, substituição ou desativação da senha.

Perfis anteriores com senha recebem apenas a tabela vazia na migração. É necessário entrar com a senha atual e gerar o primeiro código em Meu perfil. Se a pessoa perder a senha e o código, não existe recuperação pelo Hane. Nenhuma opção de recuperação depende de e-mail, Windows Hello ou remoção automática de dados.

Seis testes adicionais cobrem geração única e ausência de código em leituras/exportação/banco, redefinição real com preservação de dados e revogação de SSE, geração autenticada/rotação/remoção, limitação e reinício, concorrência/uso único e perfis existentes sem código. QA visual em banco isolado: tela Esqueci minha senha; cartão com código de exemplo sem validade; download e confirmação de guarda. Nenhuma senha pessoal foi alterada. Impressão é exposta pela função de impressão do navegador, com folha de estilo que mostra apenas o cartão; impressão física não foi validada.

Referência de segurança: [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), incluindo códigos offline, geração criptográfica, uso único e invalidação de sessões.
