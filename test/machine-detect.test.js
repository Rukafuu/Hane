import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeWslOutput, detectWsl, WSL_INSTALL_HINT } from '../src/machine/detect.js';

/** `wsl.exe` answers in UTF-16LE with CRLF; the doubles speak the same way. */
const utf16 = (text) => Buffer.from(text, 'utf16le');
const outcome = ({ status = 0, error = null, stdout = '', stderr = '' }) => ({
  status,
  error,
  stdout: stdout === '' ? Buffer.alloc(0) : utf16(stdout),
  stderr: stderr === '' ? Buffer.alloc(0) : utf16(stderr),
});

function fakeRun(responses) {
  const calls = [];
  return {
    calls,
    run: async (file, args) => {
      const key = args.join(' ');
      calls.push(`${file} ${key}`);
      const answer = responses[key];
      if (answer === undefined) throw new Error(`unexpected probe: ${key}`);
      return typeof answer === 'function' ? answer() : answer;
    },
  };
}

const NO_DISTRO_STDOUT = 'Subsistema do Windows para Linux não tem distribuições instaladas.\r\n';
const VERSION_OUTPUT = 'Versão do WSL: 2.7.14.0\r\nVersão do kernel: 6.18.33.2-2\r\n';

test('a UTF-16LE payload with a BOM decodes to text, not to a NUL-sprinkled string', () => {
  const decoded = decodeWslOutput(Buffer.from('\uFEFFDefault Version: 2\r\n', 'utf16le'));
  assert.equal(decoded, 'Default Version: 2\n');
});

test('a plain UTF-8 payload is decoded as UTF-8', () => {
  assert.equal(decodeWslOutput(Buffer.from('Ubuntu\r\n', 'utf8')), 'Ubuntu\n');
});

test('an empty or missing chunk decodes to nothing', () => {
  assert.equal(decodeWslOutput(Buffer.alloc(0)), '');
  assert.equal(decodeWslOutput(null), '');
});

test('a non-Windows platform is answered without spawning anything', async () => {
  const { run, calls } = fakeRun({});
  const report = await detectWsl({ run, platform: 'linux' });
  assert.equal(calls.length, 0);
  assert.equal(report.available, false);
  assert.equal(report.reason, 'not_windows');
  assert.deepEqual(report.distros, []);
});

test('a missing wsl.exe is reported as missing, with the install hint and no guess', async () => {
  const { run } = fakeRun({ '-l --quiet': () => ({ status: null, error: 'ENOENT', stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.equal(report.available, false);
  assert.equal(report.reason, 'wsl_not_found');
  assert.equal(report.hint, WSL_INSTALL_HINT);
});

test('an empty zero-status listing is the fact "no distribution", and WSL is still available', async () => {
  const { run } = fakeRun({
    '-l --quiet': outcome({ stdout: '' }),
    '--version': outcome({ stdout: VERSION_OUTPUT }),
  });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.equal(report.available, true);
  assert.equal(report.reason, 'no_distro');
  assert.equal(report.wslVersion, '2.7.14.0');
  assert.deepEqual(report.distros, []);
  assert.equal(report.hint, WSL_INSTALL_HINT);
});

test('a failed listing keeps what wsl said instead of translating it into a reason', async () => {
  const { run } = fakeRun({
    '-l --quiet': outcome({ status: 4294967295, stdout: NO_DISTRO_STDOUT }),
  });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.equal(report.reason, 'wsl_command_failed');
  assert.match(report.detail, /não tem distribuições instaladas/);
});

test('stderr on a successful listing never becomes a distribution name', async () => {
  const { run } = fakeRun({
    '-l --quiet': outcome({ stdout: 'Ubuntu\r\n', stderr: 'a warning about something else\r\n' }),
    '--version': outcome({ stdout: VERSION_OUTPUT }),
    '-l -v': outcome({ stdout: '  NAME      STATE           VERSION\r\nUbuntu    Em execução     2\r\n' }),
  });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.deepEqual(report.distros.map((distro) => distro.name), ['Ubuntu']);
});

test('a present distribution is reported as present, not as a configured mission box', async () => {
  const { run } = fakeRun({
    '-l --quiet': outcome({ stdout: 'Ubuntu\r\nDebian\r\n' }),
    '--version': outcome({ stdout: VERSION_OUTPUT }),
    '-l -v': outcome({ stdout: '  NAME      STATE           VERSION\r\nUbuntu    Em execução     2\r\nDebian    Parado          1\r\n' }),
  });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.equal(report.available, true);
  assert.equal(report.reason, 'distro_present');
  assert.equal(report.hint, null);
  assert.deepEqual(report.distros, [
    { name: 'Ubuntu', state: 'Em execução', version: 2 },
    { name: 'Debian', state: 'Parado', version: 1 },
  ]);
  assert.match(report.detail, /has not configured it as a mission box/);
});

test('a distribution is still listed when the verbose table cannot be read', async () => {
  const { run } = fakeRun({
    '-l --quiet': outcome({ stdout: 'Ubuntu\r\n' }),
    '--version': outcome({ stdout: VERSION_OUTPUT }),
    '-l -v': outcome({ status: 1, stderr: 'erro\r\n' }),
  });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.deepEqual(report.distros, [{ name: 'Ubuntu', state: null, version: null }]);
});

test('a failing --version costs the version number and nothing else', async () => {
  const { run } = fakeRun({
    '-l --quiet': outcome({ stdout: '' }),
    '--version': outcome({ status: 1, stderr: 'erro\r\n' }),
  });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.equal(report.reason, 'no_distro');
  assert.equal(report.wslVersion, null);
});

test('the report is frozen so a caller cannot rewrite what the machine said', async () => {
  const { run } = fakeRun({ '-l --quiet': outcome({ stdout: '' }), '--version': outcome({ stdout: VERSION_OUTPUT }) });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.distros), true);
});

test('a long localized message is carried verbatim but bounded', async () => {
  const { run } = fakeRun({ '-l --quiet': outcome({ status: 1, stdout: `${'x'.repeat(2000)}\r\n` }) });
  const report = await detectWsl({ run, platform: 'win32' });
  assert.equal(report.detail.length, 400);
});
