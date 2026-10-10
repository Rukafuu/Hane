import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { decodeWslOutput } from './detect.js';

/**
 * Bringing the box onto the machine is the one place where Hane installs
 * something, so it is the one place that shows its work first: the command is
 * printed before it runs, it runs only when the caller says `--yes`, and a
 * missing WSL runtime is answered without spawning anything. The image itself
 * is built by the release (ADR-0007) — this module has no authority to make one.
 */

const WSL_EXECUTABLE = 'wsl.exe';
const BOX_EXTENSIONS = Object.freeze(['.wsl', '.tar', '.gz', '.tgz']);
const MAX_OUTPUT_CHARS = 2000;

/**
 * The argv Hane would run, built as a list and never as a shell line: a path
 * with spaces, quotes or `&&` in it is one argument, not syntax.
 */
export function planInstall({ imagePath, cwd = process.cwd() } = {}) {
  if (typeof imagePath !== 'string' || imagePath.trim() === '') {
    throw new TypeError('hane machine install needs the path to a .wsl image.');
  }
  const absolute = path.resolve(cwd, imagePath);
  return Object.freeze({ file: WSL_EXECUTABLE, args: Object.freeze(['--install', '--from-file', absolute]), imagePath: absolute });
}

/** Why this path cannot be a box image, or null when it can. */
export function inspectImage(imagePath) {
  let stats;
  try {
    stats = statSync(imagePath);
  } catch {
    return { ok: false, reason: 'image_missing', detail: `No file at ${imagePath}.` };
  }
  if (!stats.isFile()) return { ok: false, reason: 'image_not_a_file', detail: `${imagePath} is not a regular file.` };
  const lower = imagePath.toLowerCase();
  if (!BOX_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return { ok: false, reason: 'image_extension', detail: `Expected one of ${BOX_EXTENSIONS.join(', ')}; a Hane box image is a root filesystem tar.` };
  }
  return { ok: true, bytes: stats.size };
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

const refusal = (reason, detail, printed) => Object.freeze({ ok: false, reason, detail, printed });

/**
 * Installs a shipped box image. Nothing here runs without `confirm`, and nothing
 * here pretends a container exists when the runtime is absent.
 * @param {{ imagePath: string, confirm?: boolean, detect?: () => Promise<object>,
 *           run?: (file: string, args: string[]) => Promise<object>,
 *           platform?: NodeJS.Platform, cwd?: string }} options
 */
export async function installBox({ imagePath, confirm = false, detect, run = defaultRun, platform = process.platform, cwd = process.cwd() } = {}) {
  const plan = planInstall({ imagePath, cwd });
  const printed = `${plan.file} ${plan.args.map((argument) => (argument.includes(' ') ? `"${argument}"` : argument)).join(' ')}`;

  if (platform !== 'win32') {
    return refusal('not_windows', 'A WSL box is a Windows facility; this platform has no WSL to install into.', printed);
  }

  const image = inspectImage(plan.imagePath);
  if (!image.ok) return refusal(image.reason, image.detail, printed);

  // The preview is the product: a caller who has not said --yes gets the exact
  // command and an untouched machine.
  if (confirm !== true) return refusal('needs_confirmation', 'Nothing was run. Pass --yes to run the command above.', printed);

  const report = await (detect ?? (async () => ({ available: true })))();
  if (!report?.available) {
    return refusal('wsl_unavailable', `WSL does not answer here (${report?.reason ?? 'unknown'}). The box cannot be installed before the runtime exists.`, printed);
  }

  const result = await run(plan.file, [...plan.args]);
  const output = decodeWslOutput(result.stdout) + decodeWslOutput(result.stderr);
  if (result.error) return refusal('wsl_not_found', `wsl.exe could not be run (${result.error}).`, printed);
  if ((result.status ?? 1) !== 0) {
    return refusal('install_failed', output.trim().slice(0, MAX_OUTPUT_CHARS) || `wsl.exe exited with status ${result.status}.`, printed);
  }
  return Object.freeze({ ok: true, reason: null, detail: output.trim().slice(0, MAX_OUTPUT_CHARS) || 'wsl.exe accepted the image.', printed });
}
