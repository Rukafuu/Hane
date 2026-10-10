import { spawn } from 'node:child_process';

/**
 * Detection, never installation, and never a claim of readiness. The box that
 * will carry writes and commands is a Linux distribution the user chooses to
 * install; what these read-only `wsl.exe` probes can prove is whether WSL
 * answers here, which distributions exist and what is missing. `reason` is the
 * whole vocabulary of that proof: `not_windows`, `wsl_not_found`,
 * `wsl_command_failed`, `no_distro`, `distro_present` (a distribution exists
 * that Hane has not configured as a mission box), or `null` only when nothing
 * was wrong and nothing was asked. Installation belongs to `hane machine
 * install` (ADR-0007), which lives in another file: nothing here has the
 * authority to run an installer.
 */

const WSL_EXECUTABLE = 'wsl.exe';
/** Microsoft's own command; surfaced as a hint, never run by Hane. */
export const WSL_INSTALL_HINT = 'wsl --install -d Ubuntu';
const MAX_DETAIL_CHARS = 400;

/**
 * `wsl.exe` writes UTF-16LE with CRLF, so read as latin1 the output looks like
 * binary with a NUL between every character. Decode by evidence: a BOM or a NUL
 * in the second byte means UTF-16, anything else is taken as UTF-8, because a
 * shim in front of wsl.exe may answer in plain bytes.
 */
export function decodeWslOutput(chunk) {
  if (!chunk || chunk.length === 0) return '';
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const hasBom = buffer[0] === 0xff && buffer[1] === 0xfe;
  const looksUtf16 = hasBom || (buffer.length > 1 && buffer[1] === 0x00);
  const text = looksUtf16 ? buffer.toString('utf16le') : buffer.toString('utf8');
  return (hasBom ? text.slice(1) : text).replace(/\r/g, '');
}

function defaultRun(file, args) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => resolve({ status: null, error: error.code ?? 'spawn_failed', stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    child.on('close', (status) => resolve({ status, error: null, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

const lines = (text) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '');

/**
 * `wsl -l -v` prints a header row and then `NAME  STATE  VERSION`. The state is
 * localized and the header is localized, but the version column is a digit and
 * the name is the first field, so those are the two facts taken from the table.
 * The state is kept verbatim: it is a label for a human, never a condition.
 */
function parseVerboseTable(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const columns = trimmed.split(/\s{2,}/);
    const version = Number(columns.at(-1));
    if (columns.length < 2 || !Number.isInteger(version)) continue;
    rows.push({ name: columns[0], state: columns.slice(1, -1).join(' '), version });
  }
  return rows;
}

/** The first dotted number `wsl --version` prints, which is the WSL package version. */
function parseWslVersion(text) {
  for (const line of lines(text)) {
    const match = line.match(/\d+(?:\.\d+){2,}/);
    if (match) return match[0];
  }
  return null;
}

const report = (fields) => {
  const { distros = [], detail = null, ...rest } = fields;
  return Object.freeze({
    backend: 'wsl',
    available: false,
    reason: 'not_detected',
    wslVersion: null,
    hint: null,
    ...rest,
    detail: typeof detail === 'string' && detail !== '' ? detail.slice(0, MAX_DETAIL_CHARS) : null,
    distros: Object.freeze(distros),
  });
};

/**
 * Probes this machine for a WSL backend.
 * @param {{ run?: (file: string, args: string[]) => Promise<{ status: number|null, error: string|null, stdout: Buffer, stderr: Buffer }>,
 *           platform?: NodeJS.Platform }} options injectable so the suite runs without a distribution
 * @returns {Promise<Readonly<object>>}
 */
export async function detectWsl({ run = defaultRun, platform = process.platform } = {}) {
  // The probes are Windows-only by construction; on another platform the honest
  // answer is that there is nothing to ask, and no process is spawned.
  if (platform !== 'win32') {
    return report({ reason: 'not_windows', detail: `WSL is a Windows facility; this is "${platform}".` });
  }

  const listing = await run(WSL_EXECUTABLE, ['-l', '--quiet']);
  if (listing.error) {
    return report({ reason: 'wsl_not_found', detail: `wsl.exe could not be run (${listing.error}).`, hint: WSL_INSTALL_HINT });
  }
  if ((listing.status ?? 1) !== 0) {
    // A non-zero `--quiet` listing is not "no distros": that answer is an empty
    // zero-status stdout. So this is reported as a failed probe, with what wsl
    // said kept verbatim rather than translated into a reason we did not prove.
    const spoken = lines(`${decodeWslOutput(listing.stderr)}\n${decodeWslOutput(listing.stdout)}`).join(' ');
    return report({ reason: 'wsl_command_failed', detail: spoken || `wsl.exe exited with status ${listing.status}.`, hint: WSL_INSTALL_HINT });
  }

  // Names come from stdout only: stderr on a zero exit is noise, and a noise
  // line read as a distro name would become a target for `wsl -d <noise>`.
  const names = lines(decodeWslOutput(listing.stdout));
  const versionProbe = await run(WSL_EXECUTABLE, ['--version']);
  const wslVersion = (versionProbe.error || (versionProbe.status ?? 1) !== 0)
    ? null
    : parseWslVersion(decodeWslOutput(versionProbe.stdout));

  if (names.length === 0) {
    return report({ available: true, reason: 'no_distro', wslVersion, detail: 'WSL answers but no distribution is installed.', hint: WSL_INSTALL_HINT });
  }

  const verbose = await run(WSL_EXECUTABLE, ['-l', '-v']);
  const rows = verbose.error || (verbose.status ?? 1) !== 0
    ? []
    : parseVerboseTable(decodeWslOutput(verbose.stdout));
  const distros = names.map((name) => {
    const row = rows.find((candidate) => candidate.name === name);
    return { name, state: row?.state ?? null, version: row?.version ?? null };
  });

  return report({
    available: true,
    reason: 'distro_present',
    detail: 'A distribution exists. Hane has not configured it as a mission box, and no write or run executor answers behind the seam yet.',
    wslVersion,
    distros,
  });
}
