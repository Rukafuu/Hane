# Política de marca do Hane

Copyright 2026 Lucas Frischeisen · contato: lucas.frischeisen@gmail.com

## O que a licença de código não faz

O código do Hane está sob [Apache License 2.0](LICENSE). Ela autoriza usar, estudar, modificar
e redistribuir o código, com ou sem fins lucrativos, sem pedir autorização.

Isso é deliberado e é o que torna o projeto open source.

O que a Apache **não** concede está dito nela mesma, na seção 6 (*Trademark Rights*): a licença
não dá direito de usar nomes comerciais, marcas, marcas de serviço ou logotipo do licensor,
exceto o uso descritivo e razoável para explicar a procedência do trabalho. Ou seja: o código é
seu para usar; o nome **Hane** continua sendo uma marca que a licença não transfere.

## O que é protegido

| Ativo | Status |
| --- | --- |
| `Hane` (nome do produto, do serviço e do projeto) | marca do autor, não licenciada pelo código |
| Logotipo e símbolo do Hane | obra do autor, não licenciada pelo código |
| `Hane Sans` / `HaneSans` | nome reservado (RFN) da fonte, ver abaixo |
| Identidade visual, combinação de cores e tratamento tipográfico da marca | não licenciado pelo código |

## Permitido sem autorização

- Descrever o que você fez com honestidade: *"um fork do Hane"*, *"construído com Hane"*,
  *"compatível com a API do Hane"*.
- Manter os avisos de copyright e o arquivo `LICENSE` no código que você redistribui.
- Publicar seu próprio produto derivado, com **seu** nome e **sua** marca.
- Escrever sobre o projeto, usar o nome em documentação, artigo, palestra ou comparativo.

## Precisa de autorização escrita

- Dar ao seu produto, serviço, app, instância hospedada ou conta o nome **Hane**, ou algo que
  leve gente a confundi-lo com o projeto original.
- Usar o logotipo ou o símbolo do Hane em interface, material de marketing ou embalagem.
- Sugerir endosso, afiliação ou patrocínio do projeto original.
- Registrar `hane` como marca, domínio ou identidade comercial de outra coisa.

Um fork que se chamasse Hane pararia de ser um fork e viraria um segundo produto com o nome de
outra pessoa. O código permite o primeiro; a marca proíbe o segundo.

## Como renomear um fork

Renomear é a única exigência prática para redistribuir o produto:

1. Troque o nome em toda superfície que o usuário vê — título da janela, cabeçalho, `README`,
   descritor do pacote, nome do binário e strings do CLI.
2. Remova logotipo e símbolos; substitua pela sua identidade.
3. Mantenha `LICENSE`, os avisos de copyright do código e este arquivo como referência de
   proveniência (a Apache exige a atribuição; não exige que você mantenha a marca).
4. Se você distribuir a fonte, cumpra a OFL — ver abaixo.

## A tipografia: Hane Sans

As Hane Sans são publicadas sob a **SIL Open Font License 1.1**
([`src/Hane fonts/OFL.txt`](src/Hane%20fonts/OFL.txt)), com *Reserved Font Names* `Hane Sans` e
`HaneSans`.

A OFL é uma licença livre de propósito: usar a fonte em texto, pôster, interface ou vídeo, e
embuti-la num app, é permitido, inclusive comercialmente, sem pedir autorização. O que ela
reserva é o **nome**. Traduzindo as quatro cláusulas para o caso do Hane:

- Você pode usar, embutir e redistribuir os binários como eles são.
- Você pode modificar os contornos e redistribuir o resultado — mas a versão modificada **não
  pode se chamar `Hane Sans` nem `HaneSans`**, porque esses nomes estão reservados.
- Uma versão modificada não pode ser vendida isoladamente; junto com software, pode.
- Toda redistribuição continua sob a OFL, com esta licença anexada aos binários.

É assim que a tipografia fica protegida neste projeto: pelo mecanismo de nome reservado, que é o
que a OFL oferece, e não por uma proibição de uso. Quem quiser uma tipografia própria para um
produto derivado pode fazer uma a partir desta — só não pode chamá-la de Hane Sans.

Marca continua sendo outra coisa: **usar a Hane Sans para compor um logotipo que se chama Hane**
não é problema da fonte, é problema da marca, e cai na seção *Precisa de autorização escrita*.

## Sobre este arquivo

Este arquivo não é licença e não altera a `LICENSE`. Ele descreve como o titular da marca
pretende exercê-la, para que quem contribui ou faz um fork saiba onde pisa antes de descobrir
depois. Autorização se pede por escrito ao endereço no topo desta página.
