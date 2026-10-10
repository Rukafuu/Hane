import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { CAPABILITY } from '../src/capabilities.js';
import { createScopeResolver } from '../src/workspace-scope.js';
import { listWorkspaceDir, readWorkspaceFile } from '../src/tools/workspace-read.js';
import { SANDBOX_DENIAL_REASONS, SANDBOX_METHODS, defineSandbox, unavailable } from '../src/sandbox/interface.js';
import { createWorkspaceDirSandbox } from '../src/sandbox/workspace-dir.js';

const read = (scope) => ({ name: CAPABILITY.WORKSPACE_READ, scope });

let root;
let resolver;
let sandbox;

function write(relative, content) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hane-sandbox-')));
  write('src/small.js', 'export const a = 1;\n');
  write('src/binary.bin', Buffer.from([0x68, 0x69, 0x00, 0x01]));
  write('docs/readme.md', 'docs\n');
  write('README.md', 'root\n');
  write('.env', 'SECRET=leak');
  const grants = [read('src'), read('docs')];
  resolver = createScopeResolver({ root, grants });
  sandbox = createWorkspaceDirSandbox({ root, grants });
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// The seam must be a rename, not a behaviour change: whatever the core read and
// refused through its own tools, the sandbox answers with the same bytes and the
// same token.
test('the workspace-dir sandbox reads and lists exactly what the core read before the seam', async () => {
  for (const candidate of ['src/small.js', 'docs/readme.md', 'src', '.', 'src/', 'nope.txt']) {
    assert.deepEqual(
      await sandbox.read({ path: candidate }),
      await readWorkspaceFile({ resolver, relPath: candidate.replace(/[\\/]+$/, '') || '.' }),
      `read(${candidate})`,
    );
    assert.deepEqual(
      await sandbox.list({ path: candidate }),
      await listWorkspaceDir({ resolver, relPath: candidate.replace(/[\\/]+$/, '') || '.' }),
      `list(${candidate})`,
    );
  }
});

test('a containment refusal comes back as the same reason token the resolver emits', async () => {
  const cases = [
    ['absolute_path_rejected', path.join(root, 'src', 'small.js')],
    ['escapes_workspace_root', '../outside.txt'],
    ['outside_granted_scope', 'README.md'],
    ['denied_by_secret_policy', '.env'],
    ['not_found', 'src/missing.js'],
    ['binary_content', 'src/binary.bin'],
    ['not_a_file', 'src'],
  ];
  for (const [reason, candidate] of cases) {
    const denied = await sandbox.read({ path: candidate });
    assert.equal(denied.ok, false, `${candidate} should be refused`);
    assert.equal(denied.reason, reason, candidate);
    assert.ok(SANDBOX_DENIAL_REASONS.includes(reason), `${reason} is in the published taxonomy`);
  }
});

test('a verb with no executor is a refusal the caller can print, not a crash', async () => {
  for (const name of ['write', 'run', 'fetch', 'snapshotWorkdir']) {
    assert.equal(sandbox.executable.includes(name), false, `${name} is not executable here`);
    const outcome = await sandbox[name]({ path: 'src/small.js', content: 'x', argv: ['echo'], url: 'https://example.com' });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'capability_not_available');
    assert.equal(outcome.method, name);
  }
  assert.deepEqual(sandbox.executable, ['read', 'list']);
});

test('a missing byte cap keeps the tool default instead of inventing a number', async () => {
  const capped = createWorkspaceDirSandbox({ root, grants: [read('src')], limits: { maxFileBytes: 8 } });
  const outcome = await capped.read({ path: 'src/small.js' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.truncated, true);
  assert.ok(outcome.bytes <= 8, `bytes ${outcome.bytes}`);
  assert.equal(outcome.totalBytes > 8, true);
});

test('the sandbox shape refuses a backend that cannot describe itself', () => {
  assert.throws(() => defineSandbox({ read: () => ({ ok: true }) }), /needs an id/);
  assert.throws(() => defineSandbox({ id: 'typo', red: async () => ({ ok: true }) }), /unknown methods: red/);
});

test('an outcome without ok is a broken backend, said loudly', async () => {
  const broken = defineSandbox({ id: 'broken', read: async () => ({ content: 'no envelope' }) });
  await assert.rejects(() => broken.read({ path: 'src/small.js' }), /without ok/);
});

test('every published method exists, even where nothing runs', async () => {
  const bare = defineSandbox({ id: 'bare' });
  for (const name of SANDBOX_METHODS) {
    assert.equal(typeof bare[name], 'function', name);
    assert.deepEqual(await bare[name]({}), unavailable(name));
  }
  assert.deepEqual(bare.executable, []);
});
