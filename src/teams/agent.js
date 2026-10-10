import { assertId, assertObject, text, TeamError } from './domain.js';
export function assertAgent(candidate) {
  assertObject(candidate);
  const providerLabel = candidate.providerLabel ?? null;
  if (providerLabel !== null && (typeof providerLabel !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(providerLabel))) throw new TeamError(400, 'Invalid providerLabel.');
  if (candidate.exclusive !== undefined && typeof candidate.exclusive !== 'boolean') throw new TeamError(400, 'exclusive must be a boolean.');
  return Object.freeze({ id: assertId(candidate.id), name: text(candidate.name,'name',80,2), description: text(candidate.description ?? '','description',1000), instructions: text(candidate.instructions ?? '','instructions',12000), providerLabel, exclusive: candidate.exclusive ?? false });
}
