export class TeamError extends Error {
  constructor(status, message) { super(message); this.name = 'TeamError'; this.status = status; }
}
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertId(value, name = 'id') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TeamError(400, name + ' must be a UUID.');
  return value;
}
export function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TeamError(400, 'Expected an object.');
  for (const key of ['apiKey','secret','token','credential','credentials','password']) {
    if (Object.hasOwn(value,key)) throw new TeamError(400, 'Credentials must never be stored in agents or teams.');
  }
}
export function text(value, name, max, min = 0) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new TeamError(400, name + ' must contain ' + min + '-' + max + ' characters.');
  return value.trim();
}
