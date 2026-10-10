import { parseArgs } from 'node:util';
import { detectWsl } from '../machine/detect.js';
import { installBox } from '../machine/install.js';

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

/**
 * `hane machine install <image.wsl> [--yes]` — the one command in Hane that can
 * put something on the machine, so it prints the exact argv first and runs it
 * only when told to. Without `--yes` the machine is untouched and the exit code
 * says so; that is the product, not an error.
 */
export async function machineInstallCommand({ args, stdout, stderr, dependencies = {} }) {
  const { values, positionals } = parseArgs({ args, options: { yes: { type: 'boolean' } }, allowPositionals: true });
  const imagePath = positionals[0];
  if (imagePath === undefined) {
    stderr.write('error: hane machine install needs the path to a .wsl image.\nhint: hane machine install hane-box-0.1.wsl --yes\n');
    return 1;
  }

  let outcome;
  try {
    outcome = await installBox({
      imagePath,
      confirm: values.yes === true,
      detect: dependencies.detectMachine ?? detectWsl,
      run: dependencies.runWslInstall,
      platform: dependencies.machinePlatform,
    });
  } catch (error) {
    stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  stdout.write(`command: ${outcome.printed}\n`);
  if (outcome.ok) {
    stdout.write(`installed: yes\noutput: ${outcome.detail}\n`);
    stdout.write('next: hane machine status to see the distribution WSL registered.\n');
    return 0;
  }
  stdout.write(`installed: no · ${outcome.reason}\n`);
  stdout.write(`why: ${outcome.detail}\n`);
  return 1;
}
