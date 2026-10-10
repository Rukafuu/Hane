import { parseArgs } from 'node:util';
import { detectWsl } from '../machine/detect.js';

/**
 * `hane machine status` — what this machine can prove about a mission box, in
 * the machine's own words. It installs nothing, writes nothing and asks for
 * nothing: a hint is a line to read, never a command Hane runs on the user's
 * behalf.
 */
export async function machineStatusCommand({ args, stdout, stderr, dependencies = {} }) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' } }, allowPositionals: false });
  const detect = dependencies.detectMachine ?? detectWsl;

  let report;
  try {
    report = await detect();
  } catch (error) {
    stderr.write(`error: the machine could not be probed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  if (values.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  stdout.write(`backend: ${report.backend} · ${report.available ? 'answers' : 'does not answer'}${report.wslVersion ? ` · WSL ${report.wslVersion}` : ''}\n`);
  stdout.write(`reason: ${report.reason ?? 'none'}\n`);
  if (report.detail) stdout.write(`detail: ${report.detail}\n`);
  if (report.distros.length > 0) {
    for (const distro of report.distros) {
      const version = distro.version === null ? '?' : distro.version;
      stdout.write(`distro: ${distro.name} · wsl${version}${distro.state ? ` · ${distro.state}` : ''}\n`);
    }
  } else {
    stdout.write('distros: none\n');
  }
  stdout.write('executors behind the seam: read, list (write · run · fetch have none yet)\n');
  if (report.hint) stdout.write(`hint: ${report.hint} — Hane never runs this for you.\n`);
  return 0;
}
