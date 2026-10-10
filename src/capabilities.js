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

/**
 * These two capabilities resolve against the filesystem, so their scope is a
 * path the containment check has to follow. A wildcard would silently widen a
 * grant past whatever the user meant to allow.
 */
const PATH_SCOPE_CAPABILITIES = Object.freeze(new Set([
  CAPABILITY.WORKSPACE_READ,
  CAPABILITY.WORKSPACE_WRITE,
]));

/**
 * A path scope is read as a location inside the mission's workspace root, so an
 * absolute path or one that climbs out with `..` could only ever mean a place
 * the root does not cover. The plan itself can never name such a path, so
 * accepting it would widen a grant rather than express one.
 */
function escapesWorkspaceRoot(scope) {
  const normalized = scope.replace(/\\/g, '/');
  if (/^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith('/')) return true;
  return normalized.split('/').includes('..');
}

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
    if (PATH_SCOPE_CAPABILITIES.has(name) && scope.includes('*')) {
      throw new TypeError(`capability "${name}" scope must be a plain relative path, not a glob.`);
    }
    if (PATH_SCOPE_CAPABILITIES.has(name) && escapesWorkspaceRoot(scope)) {
      throw new TypeError(`capability "${name}" scope must be a relative path inside the workspace root.`);
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
