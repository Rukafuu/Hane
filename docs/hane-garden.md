# Hane Garden — boas-vindas

## Escopo aprovado

O Garden aparece na abertura anterior ao cadastro e, conforme o pedido adicional do usuário, na lateral das três etapas de criação do perfil. A entrada aparece quando a API de sessão confirma que não existe perfil local. “Começar meu Hane” muda apenas o estado da tela; não cria perfil, não chama IA e não concede permissões. Perfis existentes seguem para desbloqueio ou workspace. O formulário e suas três etapas, upload, senha e recuperação permanecem intactos.

A abertura usa o logo oficial, Hane Sans, os tons rosa e as duas colunas. Não há etapas, provedores ou agentes simulados no Garden. O mascote é compartilhado entre as telas. Ele não representa conexões, agentes ou grupos criados e não altera as decisões do cadastro.

## Engenharia e movimento

- HaneGarden renderiza o palco. WelcomeScreen apresenta conteúdo e a ação de entrada.
- garden-controller.js concentra estados interruptíveis: idle, tracking, curious, sleeping e celebrating. Arraste tem prioridade; atenção e celebração expiram. O controlador recebe apenas coordenadas e eventos locais, nunca conteúdo de campos, fotos ou segredos.
- O HaneAvatar existente renderiza a silhueta, respiração, inclinação, olhos e piscadas variáveis, incluindo duplas ocasionais. O Garden fornece um behaviourRef; o workspace conserva seu comportamento atual.
- motion.js conduz a órbita irregular, olhar amortecido e spring de retorno, reutilizando o scheduler compartilhado do Avatar Engine. Não há renderização React por frame nem novas dependências. Cálculos são limitados e aparelhos com até quatro threads usam cerca de 30 fps no palco.
- Pointer Events, captura, pointercancel e lostpointercapture cuidam do arraste. Um deslocamento superior a seis pixels não conta como clique. Cinco ativações próximas revelam uma pena e 羽; novas ativações durante a sequência não reiniciam a animação.
- Após 45 segundos sem atividade local, o personagem fecha os olhos gradualmente e respira devagar. Ao retornar, pisca. Nenhuma telemetria é enviada.
- O loop compartilhado pausa em páginas invisíveis; o palco também verifica IntersectionObserver. ResizeObserver mantém coordenadas corretas em responsividade. Listeners, observadores, captura e assinatura de frames são limpos no unmount, inclusive no replay do StrictMode.
- prefers-reduced-motion e a preferência existente de movimento do Hane desativam respiração, órbita e efeitos contínuos. Arraste continua direto e a pena vira uma revelação estática breve. A esfera é um botão acessível por Enter/Espaço; o mascote é decorativo e não rouba foco do fluxo.

## Referências pesquisadas

Princípios de expressividade e consistência: [Duolingo — Building character](https://blog.duolingo.com/building-character/). Estados e parâmetros de interação: [Rive](https://rive.app/docs/getting-started/introduction) e [Interactive Eyes Follow Mouse](https://www.rive.app/marketplace/25312-47233-interactive-eyes-follow-mouse/). Interações vetoriais e movimento: [Codrops](https://tympanus.net/codrops/), [Anime.js](https://animejs.com/) e [LottieFiles](https://lottiefiles.com/). A arte e a física são originais; nenhuma animação externa foi importada.

## Validação

Oito testes determinísticos cobrem soninho e despertar, rastreamento, prioridades, expiração, sequências de clique, interrupção por arraste e estabilidade da spring a 30/60 fps e após frames longos. Validação no navegador: tela real antes do cadastro, entrada no formulário existente, esfera com teclado e arraste, preferência de movimento reduzido e largura de 390 px sem overflow horizontal. A página temporária de QA não faz parte do produto. Não houve teste em hardware físico de baixo desempenho; a redução de frequência é uma medida de engenharia, não um benchmark de aparelhos.

Build aprovado; 24 testes do frontend e 15 testes de perfil aprovados. A animação GIF é conferida no processamento e pela API, incluindo tempos, loop, recorte e rejeição de conteúdo inválido sem perder a foto anterior. Soninho após 45 segundos e despertar por teclado foram observados no navegador, sem erros no console. A seleção e prévia circular de GIF também foram verificadas; a foto sintética foi removida do formulário.

Fotos pessoais aceitam GIF de até 5 MB e 120 quadros, com até 16 megapixels somados. O servidor reencoda todos os quadros em WebP animado, preservando tempos e loop. O nome do arquivo e metadados originais não são publicados. O arquivo processado mantém a sessão protegida e o recorte central de 256 × 256 por quadro.
Antes da publicação, npm run verify passou com 288 testes e a checagem de sintaxe de 66 arquivos.
