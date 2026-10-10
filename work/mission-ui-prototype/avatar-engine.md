# Hane Avatar Engine

`HaneAvatar` é um renderer SVG procedural e sem assets externos. As quatro
silhuetas usam oito segmentos quadráticos compatíveis; isso permite deformação
contínua sem interpolar comandos SVG incompatíveis.

O renderer atualiza somente nós SVG em um scheduler `requestAnimationFrame`
compartilhado. Ele não provoca renderizações React por frame, para quando o
avatar está fora do viewport e quando a aba fica invisível, e pode receber
`reducedMotion`.

## Estado do runtime

`avatar-runtime.js` mapeia apenas evidência já persistida/publicada pelo Hane:
saída salva, falha de chamada, fase da missão e papel corrente. O backend atual
emite `role_saved`, `role_failed` e `run_finished`; ele ainda não emite eventos
granulares de pensamento, ferramenta ou handoff. A tabela de eventos futuros
fica como contrato desacoplado, sem fingir que esses sinais já existem.

Abra `/?avatar-playground` no protótipo para comparar formas, estados, cor,
intensidade, movimento reduzido e uma grade de dez avatares usando este mesmo
motor.
