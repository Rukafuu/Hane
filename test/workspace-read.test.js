import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { listWorkspaceDir, parseRequestedPaths, readWorkspaceFile } from '../src/tools/workspace-read.js';
import { createScopeResolver } from '../src/workspace-scope.js';
import { CAPABILITY } from '../src/capabilities.js';

const read = (scope) => ({ name: CAPABILITY.WORKSPACE_READ, scope });

let root;
let resolver;

function write(relative, content) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hane-read-')));
  write('src/small.js', 'export const a = 1;\n');
  write('src/empty.js', '');
  write('src/big.js', Array.from({ length: 4000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n'));
  write('src/binary.bin', Buffer.from([0x68, 0x69, 0x00, 0x01]));
  write('src/nested/deep.js', 'deep\n');
  write('docs/readme.md', 'docs\n');
  write('.env', 'SECRET=leak');
  write('node_modules/pkg/index.js', 'leak\n');
  resolver = createScopeResolver({ root, grants: [read('src'), read('docs')] });
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readWorkspaceFile', () => {
  test('returns the file content for a granted path', async () => {
    const result = await readWorkspaceFile({ resolver, relPath: 'src/small.js' });
    assert.equal(result.ok, true);
    assert.equal(result.content, 'export const a = 1;\n');
    assert.equal(result.truncated, false);
    assert.equal(result.relPath, 'src/small.js');
  });

  test('allows an empty file', async () => {
    const result = await readWorkspaceFile({ resolver, relPath: 'src/empty.js' });
    assert.equal(result.ok, true);
    assert.equal(result.content, '');
  });

  test('caps the read at maxBytes and reports the real size', async () => {
    const result = await readWorkspaceFile({ resolver, relPath: 'src/big.js', maxBytes: 1024 });
    assert.equal(result.ok, true);
    assert.equal(result.truncated, true);
    assert.ok(result.bytes <= 1024, `bytes ${result.bytes}`);
    assert.ok(result.totalBytes > 1024);
    assert.ok(!result.content.includes('line 3999'), 'stops well before the end');
    assert.ok(result.content.endsWith('\n'), 'cuts on a line boundary');
  });

  test('never reads more than the cap from disk', async () => {
    const huge = 'y'.repeat(5 * 1024 * 1024);
    write('src/huge.js', huge);
    const result = await readWorkspaceFile({ resolver, relPath: 'src/huge.js', maxBytes: 256 });
    assert.equal(result.ok, true);
    assert.equal(result.bytes <= 256, true);
    assert.equal(result.content.length < huge.length, true);
    fs.rmSync(path.join(root, 'src', 'huge.js'), { force: true });
  });

  test('refuses binary content', async () => {
    const result = await readWorkspaceFile({ resolver, relPath: 'src/binary.bin' });
    assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: 'binary_content' });
  });

  test('propagates every resolver denial', async () => {
    assert.equal((await readWorkspaceFile({ resolver, relPath: 'docs/../src/small.js' })).reason, 'escapes_workspace_root');
    assert.equal((await readWorkspaceFile({ resolver, relPath: 'src/nope.js' })).reason, 'not_found');
    assert.equal((await readWorkspaceFile({ resolver, relPath: 'src/nested' })).reason, 'not_a_file');
    assert.equal((await readWorkspaceFile({ resolver, relPath: '.env' })).reason, 'denied_by_secret_policy');
    assert.equal((await readWorkspaceFile({ resolver, relPath: 'node_modules/pkg/index.js' })).reason, 'denied_by_secret_policy');
  });
});

describe('listWorkspaceDir', () => {
  test('lists granted directories without the denied entries', async () => {
    const result = await listWorkspaceDir({ resolver, relPath: 'src' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.entries, ['big.js', 'binary.bin', 'empty.js', 'nested/', 'small.js']);
  });

  test('hides denied entries even when the whole root is granted', async () => {
    const wide = createScopeResolver({ root, grants: [read('.')] });
    const result = await listWorkspaceDir({ resolver: wide, relPath: '.' });
    assert.equal(result.ok, true);
    assert.ok(result.entries.includes('src/'));
    assert.ok(result.entries.includes('docs/'));
    assert.ok(!result.entries.includes('.env'));
    assert.ok(!result.entries.includes('node_modules/'));
  });

  test('caps the number of entries and says so', async () => {
    const result = await listWorkspaceDir({ resolver, relPath: 'src', maxEntries: 2 });
    assert.equal(result.entries.length, 2);
    assert.equal(result.truncated, true);
    assert.ok(result.total > 2);
  });

  test('refuses a file and an ungranted directory', async () => {
    assert.equal((await listWorkspaceDir({ resolver, relPath: 'src/small.js' })).reason, 'not_a_directory');
    assert.equal((await listWorkspaceDir({ resolver, relPath: 'node_modules' })).reason, 'denied_by_secret_policy');
    assert.equal((await listWorkspaceDir({ resolver, relPath: 'nope' })).reason, 'not_found');
  });
});

describe('parseRequestedPaths', () => {
  test('collects path-like tokens from prose and lists', () => {
    const plan = [
      'I will read `src/task-run.js` first.',
      '- docs/mvp-contract.md',
      '* src/orchestrator.js, src/contracts.js',
      '1. README.md',
      'no paths on this line',
      'https://example.com/foo/bar',
    ].join('\n');
    assert.deepEqual(parseRequestedPaths(plan), [
      'src/task-run.js',
      'docs/mvp-contract.md',
      'src/orchestrator.js',
      'src/contracts.js',
      'README.md',
    ]);
  });

  test('dedupes, caps, and tolerates junk', () => {
    const many = Array.from({ length: 40 }, (_, i) => `src/f${i}.js`).join(', ');
    assert.equal(parseRequestedPaths(many).length, 12);
    assert.deepEqual(parseRequestedPaths('src/a.js; src/a.js'), ['src/a.js']);
    assert.deepEqual(parseRequestedPaths(''), []);
    assert.deepEqual(parseRequestedPaths(null), []);
    assert.deepEqual(parseRequestedPaths('src/a.js'.repeat(200)), []);
  });

  test('keeps hostile paths so the resolver can audit the denial', () => {
    assert.deepEqual(parseRequestedPaths('../outside.txt'), ['../outside.txt']);
    assert.deepEqual(parseRequestedPaths('C:/Windows/win.ini'), ['C:/Windows/win.ini']);
  });
});
