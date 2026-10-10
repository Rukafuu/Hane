/**
 * The sandbox is the seam between a mission's grants and the machine that
 * carries them out. One backend exists today — a granted directory on this disk
 * (`workspace-dir.js`) — and the point of naming the seam is that a Linux box
 * behind the same shape changes nothing above it: the orchestrator, the audit
 * trail and the UI all read the same envelopes.
 *
 * A refusal is a value, never an exception. A model asking for something the
 * user did not grant is expected traffic: the run records the reason and keeps
 * going instead of failing the mission.
 */

/** The full verb set. A backend implements the verbs it can actually carry out. */
export const SANDBOX_METHODS = Object.freeze(['read', 'list', 'write', 'run', 'fetch', 'snapshotWorkdir']);

/**
 * Every token a backend may answer with. The UI translates these and shows an
 * unknown token verbatim rather than guessing at a reason we never emitted.
 */
export const SANDBOX_DENIAL_REASONS = Object.freeze([
  'invalid_path',
  'absolute_path_rejected',
  'escapes_workspace_root',
  'outside_granted_scope',
  'denied_by_secret_policy',
  'not_found',
  'not_a_file',
  'not_a_directory',
  'binary_content',
  'read_failed',
  'list_failed',
  'capability_not_available',
  // The verbs a Linux box carries out. A box that is not on this machine, a
  // command the grant never named, and a run that outlived its timeout are all
  // facts about the machine rather than policy the user changed.
  'box_unavailable',
  'wsl_not_found',
  'command_not_allowed',
  'timed_out',
  'run_failed',
  'write_failed',
  'content_too_large',
  'invalid_content',
]);

export function denial(reason, details = {}) {
  return Object.freeze({ ok: false, reason, ...details });
}

/**
 * A verb with no executor is a fact about the backend, not a policy the user
 * can change, so it says which verb is missing rather than pretending a grant
 * was refused.
 */
export function unavailable(method) {
  return denial('capability_not_available', {
    method,
    message: `"${method}" has no executor behind it on this backend.`,
  });
}

function isOutcome(candidate) {
  return candidate !== null && typeof candidate === 'object' && typeof candidate.ok === 'boolean';
}

/**
 * @param {{ id: string, root?: string|null, available?: boolean }} identity and
 * the verbs this backend actually carries out, keyed by `SANDBOX_METHODS`.
 * @returns a frozen sandbox exposing all six verbs.
 */
export function defineSandbox({ id, root = null, available = true, ...implementations }) {
  if (typeof id !== 'string' || id.trim() === '') throw new TypeError('a sandbox needs an id.');
  const unknown = Object.keys(implementations).filter((key) => !SANDBOX_METHODS.includes(key));
  if (unknown.length > 0) {
    // A misspelled verb would otherwise sit silently behind a refusal that looks
    // like a policy decision.
    throw new TypeError(`sandbox "${id}" implements unknown methods: ${unknown.join(', ')}.`);
  }

  const sandbox = { id, root, available };
  for (const name of SANDBOX_METHODS) {
    const method = implementations[name];
    if (typeof method !== 'function') {
      sandbox[name] = async () => unavailable(name);
      continue;
    }
    sandbox[name] = async (request) => {
      const outcome = await method(request);
      if (!isOutcome(outcome)) throw new TypeError(`sandbox "${id}" method "${name}" returned an outcome without ok.`);
      return outcome;
    };
  }
  sandbox.executable = Object.freeze(SANDBOX_METHODS.filter((name) => typeof implementations[name] === 'function'));
  return Object.freeze(sandbox);
}
