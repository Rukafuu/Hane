export function attachmentText(item) {
  if (!item.scope) return item.text;
  return (item.kind === 'directory' ? 'Pasta' : 'Arquivo') + ' do workspace: ' + JSON.stringify(item.scope) + '\nLeitura autorizada apenas neste escopo. Consulte com as ferramentas de workspace quando necessário.';
}

export function attachmentGrants(attachments, manual = []) {
  const grants = [...manual];
  for (const item of attachments) {
    if (item.scope && !grants.some(grant => grant.name === 'workspace.read' && grant.scope === item.scope)) grants.push({name:'workspace.read',scope:item.scope});
  }
  if (grants.length > 12) throw new Error('A execução aceita até 12 permissões. Remova um anexo ou permissão.');
  return grants;
}
