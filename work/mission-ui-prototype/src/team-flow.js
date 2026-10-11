export const TEAM_LIMIT = 8;
export const PRESET_ROLES = ['planner', 'executor', 'reviewer'];

export function validateTeamDraft(team, agents, existing = []) {
  if (typeof team.name !== 'string' || team.name.trim().length < 2 || team.name.trim().length > 80) return 'Use um nome de 2 a 80 caracteres para o Team.';
  if (!Array.isArray(team.members) || team.members.length < 1 || team.members.length > TEAM_LIMIT) return 'Escolha de um a oito integrantes.';
  if (new Set(team.members).size !== team.members.length) return 'Cada agente pode aparecer uma única vez no Team.';
  if (existing.some(id => !team.members.includes(id))) return 'Os integrantes atuais permanecem no Team.';
  if (team.members.some(id => !agents.some(a => a.id === id && (existing.includes(id) || !a.exclusive || !a.groupId || a.groupId === team.id)))) return 'Um integrante não está disponível. Revise a seleção.';
  if (team.leader && !team.members.includes(team.leader)) return 'Escolha um líder entre os integrantes ou deixe sem líder.';
  return '';
}

export function teamPresetState(team, agents, assignments, providers, fallback) {
  const participants = team ? team.members.map(id => agents.find(a => a.id === id)).filter(Boolean) : [];
  const missing = Math.max(0, 3 - participants.length);
  if (!team || missing) return { compatible: false, ready: false, missing, reason: `Adicione mais ${missing || 3} agente${missing === 1 ? '' : 's'} para usar as três etapas do Team.` };
  const ids = PRESET_ROLES.map(role => assignments[role]);
  if (ids.some(id => !participants.some(a => a.id === id)) || new Set(ids).size !== 3) return { compatible: true, ready: false, missing: 0, reason: 'Escolha três integrantes diferentes: planejamento, execução e revisão.' };
  const unavailable = ids.map(id => participants.find(a => a.id === id)).filter(a => {
    const label = a.providerLabel || a.provider || fallback;
    return label ? !providers.some(p => p.label === label) : providers.length !== 1;
  });
  return { compatible: true, ready: unavailable.length === 0, missing: 0, reason: unavailable.length ? `Escolha uma conexão de IA válida para ${unavailable.map(a => a.name).join(', ')}.` : 'Três integrantes selecionados. Os acessos são definidos somente para esta execução.' };
}
