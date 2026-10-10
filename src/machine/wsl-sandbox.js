import { spawn } from 'node:child_process';
import { decodeWslOutput } from './detect.js';
import { DEFAULT_MAX_ENTRIES, DEFAULT_MAX_FILE_BYTES } from '../tools/workspace-read.js';
import { defineSandbox, denial } from '../sandbox/interface.js';
import { CAPABILITY, commandAllowedBy, parseCommandScope } from '../capabilities.js';

/**
 * The second backend of the seam: a Linux distribution that is not this disk.
 * Everything a mission does here happens as `haneagent`, a uid with no sudo,
 * inside one working directory, and the shipped image mounts no Windows drive
 * and appends no Windows PATH (ADR-0007). That baked boundary is what lets a
 * write or a command run without a click: there is nothing on the other side of
 * it to click through to, and the human who owns the box keeps his own identity
 * and his own freedom in the same distribution (ADR-0008).
 *
 * No argv ever reaches a shell. `wsl.exe` runs what follows `--` directly, so a
 * path carrying a space, a quote or `&&` stays one argument and never becomes
 * syntax. A non-zero exit is an answer, not a refusal: `ok: true` with the code
 * and the output is what the model reads.
 */

const WSL_EXECUTABLE = 'wsl.exe';
/** The unprivileged identity baked into the image. Never the human's uid. */
export const BOX_USER = 'haneagent';
export const DEFAULT_BOX_WORKDIR = '/home/haneagent/mission';
export const DEFAULT_RUN_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RUN_OUTPUT_BYTES = 32 * 1024;
export const DEFAULT_MAX_WRITE_BYTES = 128 * 1024;
const MAX_DETAIL_CHARS = 400;

function bounded(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_DETAIL_CHARS) : '';
}

function text(chunk) {
  if (chunk === null || chunk === undefined) return '';
  if (typeof chunk === 'string') return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
  return String(chunk);
}

/**
 * A path grant says where a mission may look, and inside the box it says the
 * same thing it says on a directory: a location under the working root. A climb
 * out of it is refused rather than resolved, so the mission's map of its own
 * files matches what the machine can actually reach.
 */
function contain(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return { ok: false, reason: 'invalid_path' };
  const normalized = rawPath.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return { ok: false, reason: 'absolute_path_rejected' };
  if (/^[a-zA-Z]:/.test(normalized)) return { ok: false, reason: 'absolute_path_rejected' };
  if (/[\r\n\0]/.test(normalized)) return { ok: false, reason: 'invalid_path' };
  if (normalized.split('/').includes('..')) return { ok: false, reason: 'escapes_workspace_root' };
  const rel = normalized.replace(/^\.\//, '').replace(/\/+$/, '') || '.';
  return { ok: true, rel };
}

/** The programs this mission's `process.run` grants allow. A prose scope parses to nothing. */
export function commandRulesFor(grants = []) {
  const rules = [];
  for (const grant of grants) {
    if (grant?.name !== CAPABILITY.PROCESS_RUN) continue;
    const parsed = parseCommandScope(grant.scope);
    if (parsed.ok) rules.push(...parsed.parsed);
  }
  return Object.freeze(rules);
}

/**
 * Spawns one `wsl.exe` call and answers with its bytes, bounded and killed on
 * the clock. Output past `maxOutputBytes` is dropped, not buffered: a command
 * that prints forever is a command this function must not let fill the process.
 */
function defaultRun(args, { input = null, timeoutMs = 0, maxOutputBytes = 0, signal = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(WSL_EXECUTABLE, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    const state = { out: { bytes: 0, overflowed: false, truncated: false }, err: { bytes: 0, overflowed: false, truncated: false } };
    const capture = (bucket, stats) => (chunk) => {
      if (stats.overflowed) { stats.truncated = true; return; }
      bucket.push(chunk);
      stats.bytes += chunk.length;
      if (stats.bytes >= maxOutputBytes) { stats.overflowed = true; if (stats.bytes > maxOutputBytes) stats.truncated = true; }
    };
    child.stdout.on('data', capture(stdout, state.out));
    child.stderr.on('data', capture(stderr, state.err));

    let timedOut = false;
    let killed = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* the channel is already gone */ } }, timeoutMs)
      : null;
    const onAbort = () => { killed = true; try { child.kill(); } catch { /* the channel is already gone */ } };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const finish = (outcome) => {
      if (timer !== null) clearTimeout(timer);
      if (signal) signal.removeEventListener?.('abort', onAbort);
      const cap = Math.max(0, maxOutputBytes);
      resolve({
        stdout: Buffer.concat(stdout).subarray(0, cap),
        stderr: Buffer.concat(stderr).subarray(0, cap),
        truncated: state.out.truncated || state.err.truncated,
        timedOut,
        killed,
        ...outcome,
      });
    };

    child.on('error', (error) => finish({ status: null, error: error.code ?? 'spawn_failed' }));
    child.on('close', (status) => finish({ status, error: null }));

    if (child.stdin) {
      child.stdin.on('error', () => { /* a command that never reads is not an error */ });
      child.stdin.end(input ?? '');
    }
  });
}

/**
 * @param {{ distro: string, workdir?: string, grants?: readonly object[],
 *           limits?: object, run?: (args: string[], options: object) => Promise<object>,
 *           platform?: NodeJS.Platform, signal?: AbortSignal|null }} options
 *   `run` is the spawn seam: tests hand in an argv recorder, which is exactly
 *   what proves nothing here is assembled as a shell line.
 */
export function createWslBoxSandbox({
  distro,
  workdir = DEFAULT_BOX_WORKDIR,
  grants = [],
  limits = {},
  run = defaultRun,
  platform = process.platform,
  signal = null,
} = {}) {
  if (typeof distro !== 'string' || distro.trim() === '') {
    throw new TypeError('a WSL box needs the name of the distribution it runs in.');
  }
  if (typeof workdir !== 'string' || !workdir.startsWith('/')) {
    throw new TypeError('a WSL box working directory must be an absolute path inside the distribution.');
  }

  const maxFileBytes = limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxWriteBytes = limits.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES;
  const maxOutputBytes = limits.maxOutputBytes ?? DEFAULT_MAX_RUN_OUTPUT_BYTES;
  const timeoutMs = limits.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const rules = commandRulesFor(grants);

  const target = (rel) => (rel === '.' ? workdir : `${workdir}/${rel}`);
  const inBox = (command) => ['-d', distro, '-u', BOX_USER, '--', ...command];
  const exec = (args, options = {}) => run(args, { timeoutMs, maxOutputBytes, signal, ...options });
  const ask = (command, options = {}) => exec(inBox(command), options);

  const unavailable = () => {
    if (platform === 'win32') return null;
    return denial('box_unavailable', { detail: 'A WSL box is a Windows facility; this platform has no WSL to run in.' });
  };
  const missingRuntime = (result) => (result.error === 'ENOENT'
    ? denial('wsl_not_found', { detail: 'wsl.exe could not be run. The box cannot be reached without the WSL runtime.' })
    : null);

  /**
   * One call that proves three things at once: the distribution starts, the
   * unprivileged identity exists in it, and its mission root is there. Without
   * that proof a non-zero exit could only be answered as "the file is missing",
   * which would be a lie about a box that is not on the machine at all. Cached,
   * because a mission that reads four files asks the same question four times.
   */
  let reachability = null;
  const ensureBox = () => {
    const blocked = unavailable();
    if (blocked) return Promise.resolve(blocked);
    if (reachability === null) {
      reachability = ask(['mkdir', '-p', '--', workdir]).then((probe) => {
        const runtime = missingRuntime(probe);
        if (runtime) return runtime;
        if (probe.status === 0) return null;
        return denial('box_unavailable', {
          // wsl.exe narrates its own failures in UTF-16LE; a command inside the box
          // answers in UTF-8. Decoding the wrong way shows a human nothing readable.
          detail: bounded(`${decodeWslOutput(probe.stderr)} ${decodeWslOutput(probe.stdout)}`)
            || `wsl.exe did not start "${distro}" as ${BOX_USER}, so there is no box to carry this mission.`,
        });
      });
    }
    return reachability;
  };

  return defineSandbox({
    id: 'wsl-box',
    root: workdir,

    async read({ path } = {}) {
      const where = contain(path);
      if (!where.ok) return denial(where.reason, { relPath: typeof path === 'string' ? path : null });
      const blocked = await ensureBox();
      if (blocked) return blocked;

      // One `find` says whether the path exists, what it is and how big it is,
      // without a shell and without trusting the file's own words.
      const probe = await ask(['find', target(where.rel), '-maxdepth', '0', '-printf', '%y %s\n']);
      const runtime = missingRuntime(probe);
      if (runtime) return runtime;
      if (probe.status !== 0) return denial('not_found', { relPath: where.rel, detail: bounded(text(probe.stderr)) });
      const [kind, size] = text(probe.stdout).trim().split(/\s+/);
      if (kind !== 'f') return denial('not_a_file', { relPath: where.rel });

      const data = await ask(['head', '-c', String(maxFileBytes + 1), target(where.rel)]);
      const stillThere = missingRuntime(data);
      if (stillThere) return stillThere;
      if (data.status !== 0) return denial('read_failed', { relPath: where.rel, detail: bounded(text(data.stderr)) });
      const buffer = Buffer.isBuffer(data.stdout) ? data.stdout : Buffer.from(text(data.stdout), 'utf8');
      if (buffer.includes(0x00)) return denial('binary_content', { relPath: where.rel });

      const truncated = buffer.length > maxFileBytes;
      let content = buffer.subarray(0, maxFileBytes).toString('utf8');
      if (truncated) {
        const lastBreak = content.lastIndexOf('\n');
        if (lastBreak > maxFileBytes * 0.5) content = content.slice(0, lastBreak + 1);
      }
      return {
        ok: true,
        relPath: where.rel,
        content,
        truncated,
        bytes: Buffer.byteLength(content, 'utf8'),
        totalBytes: Number.isFinite(Number(size)) ? Number(size) : buffer.length,
      };
    },

    async list({ path } = {}) {
      const where = contain(path);
      if (!where.ok) return denial(where.reason, { relPath: typeof path === 'string' ? path : null });
      const blocked = await ensureBox();
      if (blocked) return blocked;

      const probe = await ask(['find', target(where.rel), '-mindepth', '0', '-maxdepth', '1', '-printf', '%y\t%f\n']);
      const runtime = missingRuntime(probe);
      if (runtime) return runtime;
      if (probe.status !== 0) return denial('not_found', { relPath: where.rel, detail: bounded(text(probe.stderr)) });
      const lines = text(probe.stdout).split('\n').filter((line) => line !== '');
      const [selfType] = lines[0]?.split('\t') ?? [];
      if (selfType !== 'd') return denial('not_a_directory', { relPath: where.rel });

      const visible = lines.slice(1).map((line) => {
        const [type, ...rest] = line.split('\t');
        const name = rest.join('\t');
        if (type === 'd') return `${name}/`;
        if (type === 'l') return `${name}@`;
        return name;
      }).sort((a, b) => a.localeCompare(b));
      return {
        ok: true,
        relPath: where.rel,
        entries: visible.slice(0, maxEntries),
        truncated: visible.length > maxEntries,
        total: visible.length,
      };
    },

    async write({ path, content } = {}) {
      const where = contain(path);
      if (!where.ok) return denial(where.reason, { relPath: typeof path === 'string' ? path : null });
      if (typeof content !== 'string' || content.includes('\0')) {
        return denial('invalid_content', { relPath: where.rel, detail: 'A write carries one UTF-8 text string, not bytes and not a sentence about bytes.' });
      }
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > maxWriteBytes) {
        return denial('content_too_large', { relPath: where.rel, bytes, maxBytes: maxWriteBytes });
      }

      const blocked = await ensureBox();
      if (blocked) return blocked;

      const parent = where.rel.includes('/') ? where.rel.slice(0, where.rel.lastIndexOf('/')) : '.';
      if (parent !== '.') {
        const made = await ask(['mkdir', '-p', '--', target(parent)]);
        const runtime = missingRuntime(made);
        if (runtime) return runtime;
        if (made.status !== 0) return denial('write_failed', { relPath: where.rel, detail: bounded(text(made.stderr)) });
      }

      // `dd` takes the bytes on stdin and writes the file without a shell
      // interpreting anything, and it does not echo the content back.
      const wrote = await ask(['dd', `of=${target(where.rel)}`, 'bs=65536', 'status=none'], { input: content });
      const runtime = missingRuntime(wrote);
      if (runtime) return runtime;
      if (wrote.status !== 0) return denial('write_failed', { relPath: where.rel, detail: bounded(text(wrote.stderr)) });
      return { ok: true, relPath: where.rel, bytes, machine: distro };
    },

    async run({ argv } = {}) {
      if (rules.length === 0) {
        return denial('command_not_allowed', { detail: 'This mission carries no command prefix this box can check, so nothing may run.' });
      }
      const allowed = commandAllowedBy(rules, argv);
      if (!allowed.ok) {
        return denial('command_not_allowed', {
          detail: allowed.reason,
          requested: Array.isArray(argv) ? argv.join(' ').slice(0, MAX_DETAIL_CHARS) : null,
        });
      }

      const blocked = await ensureBox();
      if (blocked) return blocked;

      const result = await exec(['-d', distro, '-u', BOX_USER, '--cd', workdir, '--', ...argv]);
      const runtime = missingRuntime(result);
      if (runtime) return runtime;
      if (result.timedOut) {
        // Killing the channel is not reaping the process inside the box, and
        // Hane does not claim it did: the answer says the clock ran out.
        return denial('timed_out', { detail: `No answer in ${timeoutMs}ms; the wsl.exe channel was closed.`, command: argv.join(' ') });
      }
      if (result.killed || result.status === null) {
        return denial('run_failed', { detail: bounded(text(result.stderr)) || 'The command ended without an exit status.' });
      }
      return {
        ok: true,
        command: argv.join(' '),
        exit: result.status,
        stdout: text(result.stdout),
        stderr: text(result.stderr),
        truncated: result.truncated === true,
      };
    },
  });
}
