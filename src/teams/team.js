import { assertId, assertObject, text, TeamError } from './domain.js';
export function assertTeam(candidate) {
  assertObject(candidate);
  const members = candidate.members;
  if (!Array.isArray(members) || members.length < 1 || members.length > 8) throw new TeamError(400, 'A team needs 1-8 members.');
  members.forEach(id => assertId(id,'member'));
  if (new Set(members).size !== members.length) throw new TeamError(400, 'Team members must be unique.');
  const leaderAgentId = candidate.leaderAgentId ?? null;
  if (leaderAgentId !== null && !members.includes(leaderAgentId)) throw new TeamError(400, 'The leader must be a team member.');
  return Object.freeze({ id: assertId(candidate.id), name: text(candidate.name,'name',80,2), description: text(candidate.description ?? '','description',1000), members: Object.freeze([...members]), leaderAgentId });
}
