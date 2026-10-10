import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectImage, installBox, planInstall } from '../src/machine/install.js';

const utf16 = (text) => Buffer.from(text, 'utf16le');
const boxDir = () => mkdtempSync(path.join(tmpdir(), 'hane-box-'));
const boxImage = (directory = boxDir(), name = 'hane-box-0.1.wsl') => {
  const imagePath = path.join(directory, name);
  writeFileSync(imagePath, 'not a real rootfs, only a file for the validator');
  return imagePath;
};

/** A run that records every spawn; a test that expects none reads `calls`. */
function spyRun(answer = () => ({ status: 0, error: null, stdout: utf16('Installing...\r\n'), stderr: Buffer.alloc(0) })) {
  const calls = [];
  return {
    calls,
    run: async (file, args) => {
      calls.push([file, [...args]]);
      return answer();
    },
  };
}

const presentWsl = () => async () => ({ backend: 'wsl', available: true, reason: 'no_distro', distros: [] });
const absentWsl = (reason = 'wsl_not_found') => async () => ({ backend: 'wsl', available: false, reason, distros: [] });

test('the install plan is an argv array, and a path with spaces stays one argument', () => {
  const plan = planInstall({ imagePath: 'A:\\um caminho && outro\\hane-box.wsl', cwd: 'A:\\' });
  assert.equal(plan.file, 'wsl.exe');
  assert.deepEqual([...plan.args], ['--install', '--from-file', 'A:\\um caminho && outro\\hane-box.wsl']);
  assert.equal(plan.args.length, 3);
  assert.equal(Object.isFrozen(plan.args), true);
});

test('the install plan resolves a relative path against the caller’s cwd', () => {
  const plan = planInstall({ imagePath: 'boxes/hane-box.wsl', cwd: path.join('A:', 'Hane') });
  assert.equal(plan.imagePath, path.resolve(path.join('A:', 'Hane'), 'boxes/hane-box.wsl'));
});

test('the install plan refuses to invent an image out of nothing', () => {
  assert.throws(() => planInstall({}), /path to a \.wsl image/);
  assert.throws(() => planInstall({ imagePath: '   ' }), /path to a \.wsl image/);
});

test('an image is accepted for its extension and rejected for being absent or a directory', () => {
  assert.equal(inspectImage(path.join(boxDir(), 'nope.wsl')).reason, 'image_missing');
  assert.equal(inspectImage(boxDir()).reason, 'image_not_a_file');
  assert.equal(inspectImage(boxImage(boxDir(), 'notes.txt')).reason, 'image_extension');
  assert.equal(inspectImage(boxImage()).ok, true);
  assert.equal(inspectImage(boxImage(boxDir(), 'rootfs.tar.gz')).ok, true);
});

test('without --yes nothing runs at all: not the install, not even the probe', async () => {
  const { run, calls } = spyRun();
  let probes = 0;
  const detect = async () => {
    probes += 1;
    return { backend: 'wsl', available: true, reason: 'no_distro', distros: [] };
  };

  const outcome = await installBox({ imagePath: boxImage(), detect, run, platform: 'win32' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'needs_confirmation');
  assert.equal(calls.length, 0);
  assert.equal(probes, 0);
  assert.match(outcome.printed, /^wsl\.exe --install --from-file /);
  assert.match(outcome.detail, /Nothing was run/);
});

test('a missing image is caught before the runtime is probed', async () => {
  const { run, calls } = spyRun();
  let probes = 0;
  const outcome = await installBox({
    imagePath: path.join(boxDir(), 'hane-box-0.1.wsl'),
    confirm: true,
    detect: async () => {
      probes += 1;
      return { backend: 'wsl', available: true, reason: 'no_distro', distros: [] };
    },
    run,
    platform: 'win32',
  });
  assert.equal(outcome.reason, 'image_missing');
  assert.equal(calls.length, 0);
  assert.equal(probes, 0);
});

test('a non-Windows platform is answered without probing, spawning or looking at files', async () => {
  const { run, calls } = spyRun();
  let probes = 0;
  const outcome = await installBox({
    imagePath: boxImage(),
    confirm: true,
    detect: async () => {
      probes += 1;
      return { backend: 'wsl', available: true, reason: null, distros: [] };
    },
    run,
    platform: 'linux',
  });
  assert.equal(outcome.reason, 'not_windows');
  assert.equal(probes, 0);
  assert.equal(calls.length, 0);
});

test('--yes without a WSL runtime is refused without spawning the installer', async () => {
  const { run, calls } = spyRun();
  const outcome = await installBox({ imagePath: boxImage(), confirm: true, detect: absentWsl('no_distro'), run, platform: 'win32' });
  assert.equal(outcome.reason, 'wsl_unavailable');
  assert.equal(calls.length, 0);
  assert.match(outcome.detail, /no_distro/);
});

test('an accepted image is handed over with the exact command that was printed', async () => {
  const imagePath = boxImage();
  const { run, calls } = spyRun();
  const outcome = await installBox({ imagePath, confirm: true, detect: presentWsl(), run, platform: 'win32' });
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['wsl.exe', ['--install', '--from-file', imagePath]]);
  assert.equal(outcome.printed.startsWith('wsl.exe --install --from-file '), true);
  assert.equal(outcome.printed.includes(imagePath), true);
});

test('a path with a space is quoted in the printed preview but never split in the argv', async () => {
  const imagePath = boxImage(boxDir(), 'hane box 0.1.wsl');
  const { run, calls } = spyRun();
  const outcome = await installBox({ imagePath, confirm: true, detect: presentWsl(), run, platform: 'win32' });
  assert.deepEqual(calls[0][1][2], imagePath);
  assert.match(outcome.printed, /hane box 0\.1\.wsl"$/);
});

test('a failing installer keeps the machine’s own words, decoded and bounded', async () => {
  const { run } = spyRun(() => ({
    status: -1,
    error: null,
    stdout: Buffer.alloc(0),
    stderr: utf16('A instalação falhou porque o disco está cheio.\r\n'),
  }));
  const outcome = await installBox({ imagePath: boxImage(), confirm: true, detect: presentWsl(), run, platform: 'win32' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'install_failed');
  assert.equal(outcome.detail, 'A instalação falhou porque o disco está cheio.');
  assert.equal(outcome.detail.includes('\u0000'), false);
});

test('a wsl.exe that cannot even start is reported as missing, not as a failed install', async () => {
  const { run } = spyRun(() => ({ status: null, error: 'ENOENT', stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }));
  const outcome = await installBox({ imagePath: boxImage(), confirm: true, detect: presentWsl(), run, platform: 'win32' });
  assert.equal(outcome.reason, 'wsl_not_found');
});

test('a silent success still says what happened', async () => {
  const { run } = spyRun(() => ({ status: 0, error: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }));
  const outcome = await installBox({ imagePath: boxImage(), confirm: true, detect: presentWsl(), run, platform: 'win32' });
  assert.equal(outcome.ok, true);
  assert.match(outcome.detail, /accepted the image/);
});
