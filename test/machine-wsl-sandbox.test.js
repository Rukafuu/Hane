import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPABILITY } from '../src/capabilities.js';
import { SANDBOX_DENIAL_REASONS } from '../src/sandbox/interface.js';
import { BOX_USER, DEFAULT_BOX_WORKDIR, commandRulesFor, createWslBoxSandbox } from '../src/machine/wsl-sandbox.js';

const buf = (value) => Buffer.from(value, 'utf8');
const ok = (stdout = '') => ({ status: 0, error: null, stdout: buf(stdout), stderr: buf('') });
const read = (scope) => ({ name: CAPABILITY.WORKSPACE_READ, scope });
const write = (scope) => ({ name: CAPABILITY.WORKSPACE_WRITE, scope });
const run = (scope) => ({ name: CAPABILITY.PROCESS_RUN, scope });

/** The `mkdir -p` call that proves the distribution, the uid and the root exist. */
const isProbe = (args) => args[5] === 'mkdir' && args[6] === '-p' && args.at(-1) === DEFAULT_BOX_WORKDIR;

/**
 * The box is tested against its spawn seam: an argv recorder. That is what
 * proves the claim the file makes — nothing here is assembled as a shell line —
 * and it is what lets a backend that has never touched a distribution be
 * checked for the answers it gives when a distribution says something
 * unexpected. `probe` answers the reachability call, which is not a mission
 * action and must not be confused with one.
 */
function fakeBox({ responder, probe = null, grants = [read('.'), write('.')], limits = {}, platform = 'win32', distro = 'hane', signal = null } = {}) {
  const calls = [];
  const sandbox = createWslBoxSandbox({
    distro,
    grants,
    platform,
    signal,
    limits,
    run: (args, options) => {
      calls.push({ args, ...options });
      if (isProbe(args)) return Promise.resolve(probe ?? ok());
      return Promise.resolve(responder?.(args, options, calls.length) ?? ok());
    },
  });
  return { sandbox, calls };
}

/** Answers the `find` probe every verb starts with, then one follow-up call. */
function boxWith(findAnswer, rest) {
  return fakeBox({
    responder: (args) => (args.includes('find')
      ? (findAnswer === null ? { status: 1, error: null, stdout: buf(''), stderr: buf('does not exist') } : ok(findAnswer))
      : (rest ?? ok())),
  });
}

test('a box call proves the distribution first, and that proof is asked once', async () => {
  const { sandbox, calls } = boxWith('f 3\n', ok('oi\n'));
  await sandbox.read({ path: 'notas.txt' });
  await sandbox.list({ path: '.' });
  assert.equal(calls.filter((call) => isProbe(call.args)).length, 1, 'two verbs, one reachability check');
  assert.deepEqual(calls[0].args, ['-d', 'hane', '-u', BOX_USER, '--', 'mkdir', '-p', '--', DEFAULT_BOX_WORKDIR]);
});

test('a box that does not start is a stated absence, never a missing file', async () => {
  const absent = fakeBox({ grants: [read('.'), write('.'), run('ls *')], probe: { status: 4294967295, error: null, stdout: buf(''), stderr: buf('The distribution was not found.') }, responder: () => ok() });
  for (const verb of ['read', 'list', 'write', 'run']) {
    const outcome = await absent.sandbox[verb](verb === 'run' ? { argv: ['ls'] } : { path: 'a', content: 'x' });
    assert.equal(outcome.ok, false, `${verb} cannot be carried out in a box that is not there`);
    assert.equal(outcome.reason, 'box_unavailable');
    assert.match(outcome.detail, /distribution was not found/, 'wsl.exe words the absence and Hane keeps its words');
  }
});

test("wsl.exe's own words arrive readable, not as a byte between every character", async () => {
  // Measured on the machine: the reachability failure is spoken by wsl.exe in
  // UTF-16LE with a BOM, while a command inside the box answers in UTF-8. The
  // human has to be able to read the refusal.
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Sistema operacional não encontrado.\r\nWsl/Service/WSL_E_DISTRO_NOT_FOUND', 'utf16le')]);
  const dead = fakeBox({ grants: [read('.')], probe: { status: 4294967295, error: null, stdout: buf(''), stderr: utf16 } });

  const outcome = await dead.sandbox.read({ path: 'a' });

  assert.equal(outcome.reason, 'box_unavailable');
  assert.match(outcome.detail, /Wsl\/Service\/WSL_E_DISTRO_NOT_FOUND/);
  assert.equal(outcome.detail.includes('\u0000'), false, 'a decoded message carries no NUL');
});

test('every verb reaches wsl.exe as a list, under the agent identity, never as a shell line', async () => {
  const { sandbox, calls } = fakeBox({ grants: [read('.'), run('git status')], responder: (args) => (args.includes('find') ? ok('f 3\n') : ok('oi\n')) });
  await sandbox.read({ path: 'notas.txt' });
  await sandbox.run({ argv: ['git', 'status'] });

  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.deepEqual(call.args.slice(0, 4), ['-d', 'hane', '-u', BOX_USER], `the distro is named and the uid is the unprivileged one: ${call.args.join(' ')}`);
  }
  assert.deepEqual(calls[1].args.slice(5), ['find', `${DEFAULT_BOX_WORKDIR}/notas.txt`, '-maxdepth', '0', '-printf', '%y %s\n']);
  assert.deepEqual(calls[2].args.slice(5), ['head', '-c', '65537', `${DEFAULT_BOX_WORKDIR}/notas.txt`]);
  assert.deepEqual(calls[3].args.slice(4, 7), ['--cd', DEFAULT_BOX_WORKDIR, '--'], 'a command runs in the box root, not wherever wsl.exe lands');
  assert.deepEqual(calls[3].args.slice(7), ['git', 'status']);
});

test('a path with spaces, quotes and && in it stays one argument', async () => {
  const granted = fakeBox({ grants: [run('sh *')], responder: () => ok('said') });
  const outcome = await granted.sandbox.run({ argv: ['sh', '-c', 'echo a && rm -rf /', 'um caminho com espaço'] });
  const call = granted.calls.at(-1);
  assert.deepEqual(call.args.slice(7), ['sh', '-c', 'echo a && rm -rf /', 'um caminho com espaço']);
  assert.equal(call.args.length, 11, 'four arguments in, four arguments out — nothing was split or escaped');
  assert.equal(outcome.stdout, 'said');
});

test('a path that climbs out of the box root is refused before anything spawns', async () => {
  const { sandbox, calls } = boxWith('f 1\n');
  for (const candidate of ['/etc/passwd', '../segredo', 'C:\\Users\\amari\\Desktop\\x', '..', '', 'a\r\nb', null, 42]) {
    const outcome = await sandbox.read({ path: candidate });
    assert.equal(outcome.ok, false, `${String(candidate)} is refused`);
    assert.ok(SANDBOX_DENIAL_REASONS.includes(outcome.reason), `${outcome.reason} is a published token`);
  }
  assert.equal(calls.length, 0, 'a refusal at the door never asks the machine, not even to prove the machine exists');
});

test('what a path is comes from the box, and a link or a directory is not a file', async () => {
  assert.equal((await boxWith(null).sandbox.read({ path: 'somefile' })).reason, 'not_found');
  assert.equal((await boxWith('d 4096\n').sandbox.read({ path: 'pasta' })).reason, 'not_a_file');
  assert.equal((await boxWith('l 12\n').sandbox.read({ path: 'link' })).reason, 'not_a_file', 'a link is not a file to read through');
  const binary = boxWith('f 4\n', ok('ab\u0000c'));
  assert.equal((await binary.sandbox.read({ path: 'bin' })).reason, 'binary_content');
});

test('a read takes the byte window it was given and says the file is bigger', async () => {
  const capped = fakeBox({
    limits: { maxFileBytes: 8 },
    responder: (args) => (args.includes('find') ? ok('f 5000\n') : ok('x'.repeat(9))),
  });
  const outcome = await capped.sandbox.read({ path: 'src/long.js' });
  assert.equal(capped.calls.at(-1).args[7], '9', 'head was told the cap plus one');
  assert.equal(outcome.truncated, true);
  assert.equal(outcome.bytes, 8);
  assert.equal(outcome.totalBytes, 5000);
  assert.equal(outcome.relPath, 'src/long.js');
});

test('a listing marks directories and links and refuses a file as one', async () => {
  const listed = boxWith('d\tmission\nf\tnotas.txt\nd\tpasta\nl\tlink\n');
  const outcome = await listed.sandbox.list({ path: '.' });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.entries, ['link@', 'notas.txt', 'pasta/']);
  assert.equal(outcome.total, 3);
  assert.equal(outcome.truncated, false);
  assert.deepEqual(listed.calls.at(-1).args.slice(5), ['find', DEFAULT_BOX_WORKDIR, '-mindepth', '0', '-maxdepth', '1', '-printf', '%y\t%f\n']);

  const capped = fakeBox({ grants: [read('.')], limits: { maxEntries: 1 }, responder: () => ok('d\tmission\nf\ta\nf\tb\n') });
  const shortList = await capped.sandbox.list({ path: '.' });
  assert.deepEqual(shortList.entries, ['a'], 'the entry cap is enforced here, not in the caller');
  assert.equal(shortList.truncated, true);

  assert.equal((await boxWith('f\tmission\n').sandbox.list({ path: '.' })).reason, 'not_a_directory');
});

test('a write makes its parent directory and sends the bytes on stdin', async () => {
  const { sandbox, calls } = boxWith('f 0\n');
  const outcome = await sandbox.write({ path: 'saida/relatorio.md', content: '# Feito\n' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.bytes, Buffer.byteLength('# Feito\n', 'utf8'));
  assert.equal(calls.length, 3, 'the reachability proof, the parent directory, the file');
  assert.deepEqual(calls[1].args.slice(5), ['mkdir', '-p', '--', `${DEFAULT_BOX_WORKDIR}/saida`]);
  assert.deepEqual(calls[2].args.slice(5), ['dd', `of=${DEFAULT_BOX_WORKDIR}/saida/relatorio.md`, 'bs=65536', 'status=none']);
  assert.equal(calls[2].input, '# Feito\n', 'the content travels as stdin, never as an argument');
});

test('a write that cannot be a file is refused without touching the box', async () => {
  const { sandbox, calls } = boxWith('f 0\n');
  assert.equal((await sandbox.write({ path: 'a.txt', content: 'x'.repeat(200_000) })).reason, 'content_too_large');
  assert.equal((await sandbox.write({ path: 'a.txt', content: 'com \u0000 nul' })).reason, 'invalid_content');
  assert.equal((await sandbox.write({ path: 'a.txt' })).reason, 'invalid_content');
  assert.equal((await sandbox.write({ path: 'a.txt', content: 12 })).reason, 'invalid_content');
  assert.equal(calls.length, 0);

  const failed = fakeBox({ grants: [write('.')], responder: () => ({ status: 1, error: null, stdout: buf(''), stderr: buf('Is a directory') }) });
  const refused = await failed.sandbox.write({ path: 'pasta', content: 'oi' });
  assert.equal(refused.reason, 'write_failed');
  assert.equal(refused.detail, 'Is a directory', 'the box words the failure and Hane keeps them');
});

test('a command runs only when the grant parses to a rule that covers it', async () => {
  const { sandbox, calls } = fakeBox({ grants: [run('git status, python3 *')], responder: () => ok('feito') });

  assert.equal((await sandbox.run({ argv: ['git', 'status'] })).ok, true);
  assert.equal((await sandbox.run({ argv: ['git', 'status', '--short'] })).reason, 'command_not_allowed', 'a prefix rule without a wildcard does not grow arguments');
  assert.equal((await sandbox.run({ argv: ['git', 'commit'] })).reason, 'command_not_allowed');
  assert.equal((await sandbox.run({ argv: ['python3', '-c', 'print(1)'] })).ok, true, 'the wildcard rule allows any arguments');
  assert.equal((await sandbox.run({ argv: ['./esquecido.sh'] })).reason, 'command_not_allowed', 'a grant names a program, not a path');
  assert.equal((await sandbox.run({ argv: [] })).reason, 'command_not_allowed');
  assert.equal((await sandbox.run({})).reason, 'command_not_allowed');
  assert.equal(calls.filter((call) => !isProbe(call.args)).length, 2, 'only the two allowed commands reached the machine');
});

test('a prose command grant parses to no rule, so the box runs nothing at all', async () => {
  const { sandbox, calls } = fakeBox({ grants: [run('approved commands only')], responder: () => ok() });
  const outcome = await sandbox.run({ argv: ['ls'] });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'command_not_allowed');
  assert.equal(calls.length, 0, 'a scope nobody can match is not a licence to guess');
});

test('a non-zero exit is an answer, not a refusal', async () => {
  const { sandbox } = fakeBox({ grants: [run('git *')], responder: () => ({ status: 128, error: null, stdout: buf(''), stderr: buf('not a git repository') }) });
  const outcome = await sandbox.run({ argv: ['git', 'status'] });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.exit, 128);
  assert.equal(outcome.stderr, 'not a git repository');
});

test('a clock that runs out says so, and so does a runtime that is not there', async () => {
  const slow = fakeBox({ grants: [run('sleep *')], limits: { timeoutMs: 250 }, responder: () => ({ status: null, error: null, stdout: buf(''), stderr: buf(''), timedOut: true }) });
  assert.equal((await slow.sandbox.run({ argv: ['sleep', '9'] })).reason, 'timed_out');

  const cancelled = fakeBox({ grants: [run('ls *')], responder: () => ({ status: null, error: null, stdout: buf(''), stderr: buf(''), killed: true }) });
  assert.equal((await cancelled.sandbox.run({ argv: ['ls'] })).reason, 'run_failed');

  const missing = fakeBox({ grants: [run('ls *')], responder: () => ({ status: null, error: 'ENOENT', stdout: buf(''), stderr: buf('') }) });
  assert.equal((await missing.sandbox.run({ argv: ['ls'] })).reason, 'wsl_not_found');
  assert.equal((await boxWith('f 1\n', { status: null, error: 'ENOENT', stdout: buf(''), stderr: buf('') }).sandbox.read({ path: 'a' })).reason, 'wsl_not_found');
  assert.equal(slow.calls.at(-1).timeoutMs, 250, 'the limit the caller set is the limit the spawn got');
});

test('no Windows, no box: nothing spawns and the answer is a stated fact', async () => {
  const { sandbox, calls } = fakeBox({ platform: 'linux', grants: [read('.'), write('.'), run('ls *')], responder: () => ok('f 1\n') });
  for (const verb of ['read', 'list', 'write', 'run']) {
    const outcome = await sandbox[verb](verb === 'run' ? { argv: ['ls'] } : { path: 'a', content: 'x' });
    assert.equal(outcome.ok, false, `${verb} cannot be carried out here`);
    assert.equal(outcome.reason, 'box_unavailable');
  }
  assert.equal(calls.length, 0);
});

test('the box carries four verbs and names none of the others as a policy refusal', async () => {
  const { sandbox } = boxWith('f 1\n');
  assert.equal(sandbox.id, 'wsl-box');
  assert.equal(sandbox.root, DEFAULT_BOX_WORKDIR);
  assert.deepEqual(sandbox.executable, ['read', 'list', 'write', 'run']);
  for (const name of ['fetch', 'snapshotWorkdir']) {
    const outcome = await sandbox[name]({ path: 'a', url: 'https://example.com' });
    assert.equal(outcome.reason, 'capability_not_available');
    assert.equal(outcome.method, name);
  }
});

test('the box is built from a real target, and its rules come from the grant grammar alone', () => {
  assert.throws(() => createWslBoxSandbox({ distro: '' }), /name of the distribution/);
  assert.throws(() => createWslBoxSandbox({ distro: 'hane', workdir: 'home/haneagent' }), /absolute path inside the distribution/);
  assert.deepEqual(commandRulesFor([read('.'), run('git status'), run('python3 *')]), [
    { program: 'git', arguments: ['status'], prefix: false },
    { program: 'python3', arguments: [], prefix: true },
  ]);
  assert.deepEqual(commandRulesFor([read('.')]), []);
});
