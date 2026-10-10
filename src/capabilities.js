/**
 * Capability grants are user-authored constraints, not instructions from a
 * model. The shape and path rules are checked wherever a grant is carried; the
 * scope grammar below is checked wherever a grant is authored, because a scope
 * the executor cannot parse is a promise the executor cannot keep.
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

const MAX_COMMAND_RULES = 8;
const MAX_NETWORK_HOSTS = 16;
const COMMAND_BASENAME = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** Anything a shell would treat as syntax. Commands reach the sandbox as argv arrays. */
const SHELL_METACHARACTERS = /[;|&$`<>(){}'"\\]/;

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

/**
 * A path scope authorizes nothing without a root, so a stored write grant
 * would lie about its reach; refusing at ingress keeps that honest and
 * pre-loads the contract for the day workspace.write grows an executor.
 */
export function grantsNeedWorkspaceRoot(grants = []) {
  return grants.some((grant) => grant.name === CAPABILITY.WORKSPACE_READ || grant.name === CAPABILITY.WORKSPACE_WRITE);
}

/**
 * The scope grammar an executor can check. Prose is not a looser policy but no
 * policy at all: `approved commands only` cannot be matched against an argv
 * array or a request host, so authoring it is refused instead of stored.
 *
 * The shape and path rules above are validated wherever a grant travels,
 * because a mission that is already running has to keep running. This grammar
 * is validated only where a grant is authored: stored missions keep the prose
 * they were granted with, and a resume that finds it enforces nothing wider
 * than the run it is sitting in.
 *
 * @returns {{ ok: true, parsed: readonly object[] } | { ok: false, reason: string }}
 */
export function parseGrantScope(name, scope) {
  if (name === CAPABILITY.PROCESS_RUN) return parseCommandScope(scope);
  if (name === CAPABILITY.NETWORK_REQUEST) return parseHostScope(scope);
  return { ok: true, parsed: Object.freeze([{ path: scope }]) };
}

/**
 * Matching semantics, so the executor that lands later cannot invent its own:
 * a rule with no argument allows that program with any arguments; a rule with
 * arguments allows exactly that argv prefix, and further arguments only when the
 * rule ends with `*`. No rule ever hands a string to a shell — commands reach
 * the sandbox as an argv array — which is why shell syntax is refused here
 * rather than escaped.
 */
export function parseCommandScope(scope) {
  const rules = scope.split(',').map((rule) => rule.trim()).filter((rule) => rule !== '');
  if (rules.length === 0) {
    return { ok: false, reason: 'must list command prefixes, like "python3, git status, npm run *".' };
  }
  if (rules.length > MAX_COMMAND_RULES) {
    return { ok: false, reason: `must list at most ${MAX_COMMAND_RULES} command prefixes.` };
  }

  const parsed = [];
  for (const rule of rules) {
    if (SHELL_METACHARACTERS.test(rule)) {
      return { ok: false, reason: `"${rule}" contains shell syntax. Commands reach the sandbox as arguments, never through a shell.` };
    }
    const tokens = rule.split(/\s+/);
    if (!COMMAND_BASENAME.test(tokens[0])) {
      return { ok: false, reason: `"${tokens[0]}" is not a bare program name. Write the executable alone, like "python3", not a path.` };
    }
    for (const token of tokens.slice(1, -1)) {
      if (token.includes('*')) {
        return { ok: false, reason: `"${rule}" may only wildcard its final argument, like "npm run *".` };
      }
    }
    const last = tokens.at(-1);
    const prefix = last === '*';
    parsed.push(Object.freeze({
      program: tokens[0],
      arguments: Object.freeze(tokens.slice(1, prefix ? -1 : undefined)),
      prefix,
    }));
  }
  return { ok: true, parsed: Object.freeze(parsed) };
}

export function parseHostScope(scope) {
  const entries = scope.split(',').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry !== '');
  if (entries.length === 0) {
    return { ok: false, reason: 'must list hosts, like "docs.example.com, *.registry.npmjs.org".' };
  }
  if (entries.length > MAX_NETWORK_HOSTS) {
    return { ok: false, reason: `must list at most ${MAX_NETWORK_HOSTS} hosts.` };
  }

  const parsed = [];
  for (const entry of entries) {
    if (entry.includes('://')) {
      return { ok: false, reason: `"${entry}" carries a scheme. Grant hosts, not URLs — requests leave over https.` };
    }
    if (entry.includes(':') || entry.includes('/') || entry.includes('@')) {
      return { ok: false, reason: `"${entry}" is not a bare host. Ports, paths and credentials do not belong in a host grant.` };
    }
    // A leading wildcard is the whole label: `*.` matches one label only, so
    // `*.example.com` never reaches `ev1.example.com.attacker.test`.
    const wildcard = entry.startsWith('*.');
    const hostname = wildcard ? entry.slice(2) : entry;
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return { ok: false, reason: `"${entry}" names a machine-local target. The box must not be able to reach the host that runs it.` };
    }
    const labels = hostname.split('.');
    if (labels.length < 2 || labels.some((label) => !HOST_LABEL.test(label))) {
      return { ok: false, reason: `"${entry}" is not a resolvable hostname. Use at least two labels of letters, digits and hyphens.` };
    }
    if (/^\d+$/.test(labels.at(-1))) {
      return { ok: false, reason: `"${entry}" looks like an IP address. Grant the hostname, so the check can pin the name it matched.` };
    }
    parsed.push(Object.freeze({ host: hostname, wildcard }));
  }
  return { ok: true, parsed: Object.freeze(parsed) };
}

/**
 * The one reading of a command grant, written next to the grammar on purpose.
 * A scope means what this function says it means; an executor that worked out
 * its own match would be a second policy nobody authored.
 *
 * @param {readonly object[]} rules exactly as `parseCommandScope` parsed them
 * @param {readonly string[]} argv the argument vector as the model asked for it
 */
export function commandAllowedBy(rules, argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, reason: 'a command is an argument vector: at least the program name, never a sentence.' };
  }
  if (argv.length > MAX_COMMAND_RULES * 8) {
    return { ok: false, reason: `a command may not carry more than ${MAX_COMMAND_RULES * 8} arguments.` };
  }
  if (argv.some((argument) => typeof argument !== 'string' || argument === '' || /[\r\n\0]/.test(argument))) {
    return { ok: false, reason: 'command arguments must be single-line strings.' };
  }
  if (argv[0].includes('/') || argv[0].includes('\\')) {
    return { ok: false, reason: `"${argv[0]}" is a path. A grant names a program, and the machine's PATH decides where it lives.` };
  }

  for (const rule of rules) {
    if (rule.program !== argv[0]) continue;
    if (rule.arguments.length === 0) return { ok: true, rule };
    if (argv.length < rule.arguments.length + 1) continue;
    if (!rule.arguments.every((token, index) => argv[index + 1] === token)) continue;
    if (rule.prefix || argv.length === rule.arguments.length + 1) return { ok: true, rule };
  }
  return { ok: false, reason: `"${argv.join(' ')}" is not on the granted command list.` };
}

/**
 * Refuses a grant whose scope no executor could enforce. Keeps the thrown
 * message a usage error the ingress can print verbatim.
 */
export function assertEnforceableScopes(grants = []) {
  for (const grant of grants) {
    const outcome = parseGrantScope(grant.name, grant.scope);
    if (!outcome.ok) throw new TypeError(`capability "${grant.name}" scope ${outcome.reason}`);
  }
  return grants;
}
