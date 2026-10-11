# Configurações do Hane — verificação do runtime

A interface ativa é `work/mission-ui-prototype`, conferida no Chrome com banco separado em `.tmp/settings-preview.sqlite`. Os componentes, tokens de tema, fontes e hierarquia de cards existentes foram preservados. Nenhuma credencial do usuário foi lida para a validação.

| Seção | Estado e alcance real |
| --- | --- |
| Meu perfil | Perfil, foto, senha, recuperação e bloqueio já fornecidos pelo backend existente. |
| Geral | Preferências no navegador; início, confirmação e avisos têm consumidores reais. |
| Aparência | Temas, fonte, cor, escala, densidade, largura, peso e movimento permanecem ligados ao workspace. |
| Atalhos | Referência dos atalhos existentes; não oferece remapeamento fictício. |
| Notificações | Avisos internos e notificações do navegador para mudanças terminais de missões em segundo plano; exigem permissão real. |
| Agentes | Biblioteca no SQLite; instruções e documentos usados pelas conversas. |
| Modelos e provedores | Cadastro, edição e remoção; chave separada no cofre do Windows; teste consulta o catálogo `/models` sem geração nem custo de inferência. Catálogo acessível não garante que uma geração será aceita. |
| Orquestração | Limites de novas missões. Conversas continuam com orçamento próprio por rodada. |
| Memória | Notas compartilhadas, por agente ou por grupo no SQLite. Até 12 notas recentes pertinentes são enviadas como contexto não confiável nas conversas. Não alteram permissões ou missões. |
| Conectores | GitHub mantém Device Flow real existente. Serviços com endpoint MCP podem ser cadastrados e consultados; não há botões Figma/Supabase que finjam uma integração nativa. |
| MCP | Cadastro e token no cofre, conexão HTTP, handshake, catálogo paginado e chamadas manuais com revisão dos argumentos e aprovação. Histórico de chamadas persistido sem argumentos, tokens ou resultados privados. Suporte explícito aos protocolos 2025-03-26, 2025-06-18 e 2025-11-25; OAuth, stdio e concessão automática de ferramentas a agentes não implementados. |
| Workspace | Diálogo nativo no computador do servidor. Raiz lembrada no navegador para missões. Troca de raiz revoga anexos de disco e grants do compositor; escolher uma pasta não lê arquivos. |
| Permissões | Expõe os controles de escopo e capacidades do runtime e não cria uma autorização global implícita. |
| Armazenamento | Tamanho do SQLite, contagens de registros e verificação de integridade consultados no servidor. |
| Backup e importação | Importação/exportação existente de preferências/biblioteca; nova exportação de missões, saídas, auditoria e conversas para consulta. Não é restauração completa do banco. Não inclui verificadores de senha/recovery nem chaves do cofre. Conteúdo escrito nas conversas pode ser privado. |
| Segurança | Estado real da sessão/cofre e diagnóstico do banco. Não há expiração automática de histórico. |
| Monitor | Missões existentes, conversas persistidas e auditoria manual MCP; dados não disponíveis resultam em erro visível. |
| Avançado e Sobre | Versão, runtime Node, SO, tempo ativo e diagnóstico reais. Não simula instalador ou atualizador desktop. |

## Evidências

- Cadastro de provedor pela interface, atualização imediata do modelo padrão.
- Memória criada pela interface e mantida após recarregar.
- Testes de SQLite, escopo de memória e inclusão no prompt da conversa; negação de sessão bloqueada e de origem não permitida.
- Teste HTTP MCP com servidor local de teste: inicialização, descoberta, chamada e auditoria; requisição sem aprovação não chega ao servidor remoto.
- Cofre testado por adaptador isolado, sem armazenar credenciais reais durante QA.
- Integrações remotas e notificações do sistema dependem das credenciais/serviços/permissões fornecidos pelo usuário; não foram declaradas verificadas com contas reais.

Referência de transporte MCP: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

## Resultado da verificação

- `npm run verify`: 426 testes passaram, sem falhas; executado depois do build para evitar concorrência sobre `dist`.
- `npm run build`: passou; aviso existente de bundle JavaScript acima de 500 kB.
- `npm run test:sites`: 47 testes passaram.
- `node --test test/settings-api.test.js`: 7 testes passaram na versão final, incluindo privacidade de respostas externas inválidas.
- `git diff --check`: passou.
- Chrome: cadastro de provedor e atualização do seletor; memória salva e preservada após reload; armazenamento com integridade `ok`; monitor com estados vazios reais.
- Captura visual: `C:/Users/amari/.codex/visualizations/2026/10/11/01a12892-b2f9-7be3-8b37-54f0a8590aeb/settings-memory-proof.png`.
