/**
 * Capability grants are user-authored constraints, not instructions from a
 * model. Keeping them declarative lets the future sandbox enforce exactly the
 * same contract shown in the UI and audit trail.
 */
export const CAPABILITY = Object.freeze({
  WORKSPACE_READ: 'workspace.read',
  WORKSPACE_WRITE: 'workspace.write',
  PROCESS_RUN: 'process.run',
  NETWORK_REQUEST: 'network.request',
});

export const KNOWN_CAPABILITIES = Object.freeze(new Set(Object.values(CAPABILITY)));

const MAX_GRANTS = 12;
const MAX_SCOPE_LENGTH = 512;

export function assertCapabilityGrants(candidate) {
  if (candidate === undefined || candidate === null) return Object.freeze([]);
  if (!Array.isArray(candidate)) throw new TypeError('capabilities must be an array.');
  if (candidate.length > MAX_GRANTS) throw new TypeError(`capabilities cannot contain more than ${MAX_GRANTS} grants.`);

  const seen = new Set();
  const grants = candidate.map((grant) => {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)) throw new TypeError('each capability grant must be an object.');
    const { name, scope } = grant;
    if (!KNOWN_CAPABILITIES.has(name)) throw new TypeError(`Unknown capability "${name}".`);
    if (typeof scope !== 'string' || scope.trim().length === 0 || scope.length > MAX_SCOPE_LENGTH || /[\r\n\0]/.test(scope)) {
      throw new TypeError(`capability "${name}" requires a single-line scope up to ${MAX_SCOPE_LENGTH} characters.`);
    }
    const normalized = Object.freeze({ name, scope: scope.trim() });
    const key = `${normalized.name}\u0000${normalized.scope}`;
    if (seen.has(key)) throw new TypeError(`Duplicate capability grant "${normalized.name}" for the same scope.`);
    seen.add(key);
    return normalized;
  });
  return Object.freeze(grants);
}

export function hasCapability(grants, name, scope) {
  return grants.some((grant) => grant.name === name && grant.scope === scope);
}

/**
 * Workspace scopes are relative paths, so they mean nothing without a root.
 * Rejected at ingress instead of silently authorizing nothing later.
 */
export function grantsNeedWorkspaceRoot(grants = []) {
  return grants.some((grant) => grant.name === CAPABILITY.WORKSPACE_READ || grant.name === CAPABILITY.WORKSPACE_WRITE);
}
