import path from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { CAPABILITY } from './capabilities.js';

/**
 * Deny-list outranks grants: a mission granted the whole repository must still
 * not read the credentials the product promises to keep out of disk and HTTP.
 */
const SECRET_DIRECTORIES = Object.freeze([
  'node_modules', '.git', '.ssh', '.aws', '.azure', '.gcloud', '.gnupg', '.docker', '.kube', 'outputs',
].map((name) => name.toLowerCase()));
const SECRET_FILE_PATTERNS = Object.freeze([
  /^\.env(\..*)?$/i,
  /\.(pem|pfx|p12|key|kdbx)$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i,
  /^(credentials|secrets)(\.(json|ya?ml|toml|txt))?$/i,
  /^\.(npmrc|netrc|git-credentials|kubeconfig|dockerconfigjson)$/i,
  /^kubeconfig(\..*)?$/i,
  /^application_default_credentials\.json$/i,
  /\.tfstate(\..*)?$/i,
  /\.sqlite(-wal|-shm)?$/i,
]);

export function grantsForWorkspaceRead(grants = []) {
  return grants.filter((grant) => grant?.name === CAPABILITY.WORKSPACE_READ);
}

function comparable(absolutePath) {
  const posix = absolutePath.replace(/\\/g, '/');
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

export function containsPath(outer, inner) {
  const a = comparable(outer);
  const b = comparable(inner);
  return a === b || b.startsWith(a.endsWith('/') ? a : `${a}/`);
}

function looksAbsolute(candidate) {
  return /^[a-zA-Z]:/.test(candidate)
    || candidate.startsWith('\\\\')
    || candidate.startsWith('//')
    || candidate.startsWith('\\\\?\\')
    || path.isAbsolute(candidate);
}

function toPosixRelative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function isSecretPath(relPath) {
  const segments = relPath.split('/');
  // A deny-list ignores case even where the filesystem does not: `OUTPUTS/x` is
  // the same directory the user was promised would stay unreadable.
  if (segments.some((segment) => SECRET_DIRECTORIES.includes(segment.toLowerCase()))) {
    return 'denied_by_secret_policy';
  }
  const basename = segments.at(-1) ?? '';
  if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(basename))) {
    return 'denied_by_secret_policy';
  }
  return null;
}

/**
 * Resolves the directory a mission's scopes are relative to. Symlinks and
 * junctions are folded here so every later comparison happens on real paths.
 */
export function resolveWorkspaceRoot(rawRoot) {
  if (typeof rawRoot !== 'string' || rawRoot.trim() === '') {
    throw new TypeError('workspaceRoot must be a non-empty path.');
  }
  if (/[\r\n\0]/.test(rawRoot)) throw new TypeError('workspaceRoot cannot contain control characters.');
  const absolute = path.resolve(rawRoot.trim());
  let real;
  try {
    real = realpathSync(absolute);
  } catch {
    throw new Error(`Workspace root "${rawRoot}" does not exist.`);
  }
  if (!statSync(real).isDirectory()) throw new Error(`Workspace root "${rawRoot}" is not a directory.`);
  return real;
}

function describeScope(root, scope) {
  const absolute = path.resolve(root, scope);
  let real;
  let kind = null;
  try {
    real = realpathSync(absolute);
    const info = statSync(real);
    kind = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other';
  } catch {
    real = absolute;
  }
  // The root is the ceiling, so a scope is only a grant while its real target
  // stays inside it: a scope naming a link that points elsewhere — or one that
  // climbs out with `..` — would otherwise punch a hole the plan could walk
  // through from a path it is allowed to name.
  return Object.freeze({ scope, real, kind, enforceable: containsPath(root, real) });
}

/**
 * @param {{ root: string, grants: readonly {name: string, scope: string}[] }} options
 * @returns {{ root: string, scopes: readonly object[], check(relPath: string): object, checkDirectory(relPath: string): object }}
 */
export function createScopeResolver({ root, grants = [] }) {
  const scopes = grantsForWorkspaceRead(grants).map((grant) => describeScope(root, grant.scope));

  const granted = (real) => scopes.some((scope) => scope.enforceable && (scope.kind === 'file'
    ? comparable(scope.real) === comparable(real)
    : containsPath(scope.real, real)));

  function prepare(candidate) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      return { ok: false, reason: 'invalid_path' };
    }
    if (/[\r\n\0]/.test(candidate)) return { ok: false, reason: 'invalid_path' };

    const trimmed = candidate.trim().replace(/\\/g, '/');
    if (looksAbsolute(trimmed)) return { ok: false, reason: 'absolute_path_rejected' };

    const segments = trimmed.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.includes('..')) return { ok: false, reason: 'escapes_workspace_root' };

    // "." and "./" mean the root itself, which a whole-repository grant has to be
    // able to list.
    const absolute = segments.length === 0 ? root : path.resolve(root, ...segments);
    const relPath = toPosixRelative(root, absolute);
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      return { ok: false, reason: 'escapes_workspace_root' };
    }

    const secret = isSecretPath(relPath);
    if (secret) return { ok: false, reason: secret, relPath };

    let real;
    try {
      real = realpathSync(absolute);
    } catch {
      return { ok: false, reason: 'not_found', relPath };
    }
    // The name the plan used is not the file that opens: a link inside a granted
    // scope that lands on `.git/config` is still a secret read.
    const realRelPath = toPosixRelative(root, real);
    const secretAfterResolve = isSecretPath(realRelPath);
    if (secretAfterResolve) return { ok: false, reason: secretAfterResolve, relPath };
    if (!granted(real)) return { ok: false, reason: 'outside_granted_scope', relPath };

    try {
      return { ok: true, relPath, realPath: real, info: statSync(real) };
    } catch {
      return { ok: false, reason: 'not_found', relPath };
    }
  }

  return Object.freeze({
    root,
    scopes: Object.freeze(scopes),
    isSecret(relPath) {
      return isSecretPath(String(relPath ?? '').replace(/\\/g, '/')) !== null;
    },
    check(candidate) {
      const prepared = prepare(candidate);
      if (!prepared.ok) return prepared;
      if (!prepared.info.isFile()) return { ok: false, reason: 'not_a_file', relPath: prepared.relPath };
      return { ok: true, relPath: prepared.relPath, absolutePath: prepared.realPath, size: prepared.info.size };
    },
    checkDirectory(candidate) {
      const prepared = prepare(candidate);
      if (!prepared.ok) return prepared;
      if (!prepared.info.isDirectory()) return { ok: false, reason: 'not_a_directory', relPath: prepared.relPath };
      return { ok: true, relPath: prepared.relPath, absolutePath: prepared.realPath };
    },
  });
}
