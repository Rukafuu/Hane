import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { containsPath, createScopeResolver, grantsForWorkspaceRead, resolveWorkspaceRoot } from '../src/workspace-scope.js';
import { CAPABILITY } from '../src/capabilities.js';

const read = (scope) => ({ name: CAPABILITY.WORKSPACE_READ, scope });

let root;

function write(relative, content = 'content') {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hane-scope-')));
  write('src/task-run.js');
  write('src/nested/deep.js');
  write('docs/notes.md');
  write('.env', 'SECRET=leak');
  write('.env.local', 'SECRET=leak');
  write('node_modules/pkg/index.js');
  write('src/secrets.json');
  write('src/id_rsa');
  write('src/server.pem');
  write('src/tokens.js', 'export const tokens = [];');
  write('outputs/agent.sqlite');
  write('.git/config');
  write('outside-secret.txt', 'SECRET=leak');
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveWorkspaceRoot', () => {
  test('returns the real path of an existing directory', () => {
    assert.equal(resolveWorkspaceRoot(path.join(root, 'src')), fs.realpathSync(path.join(root, 'src')));
  });

  test('rejects a missing root, a file root, and blank input', () => {
    assert.throws(() => resolveWorkspaceRoot(path.join(root, 'nope')), /does not exist/);
    assert.throws(() => resolveWorkspaceRoot(path.join(root, 'src', 'task-run.js')), /not a directory/);
    assert.throws(() => resolveWorkspaceRoot(''), TypeError);
    assert.throws(() => resolveWorkspaceRoot('a\nb'), TypeError);
  });
});

describe('createScopeResolver', () => {
  test('grants a path inside the requested scope', () => {
    const resolver = createScopeResolver({ root, grants: [read('./src')] });
    const result = resolver.check('src/task-run.js');
    assert.equal(result.ok, true);
    assert.equal(result.relPath, 'src/task-run.js');
  });

  test('denies a path outside every granted scope', () => {
    const resolver = createScopeResolver({ root, grants: [read('src')] });
    assert.equal(resolver.check('docs/notes.md').reason, 'outside_granted_scope');
  });

  test('a scope of "." covers the whole root but not the deny-list', () => {
    const resolver = createScopeResolver({ root, grants: [read('.')] });
    assert.equal(resolver.check('docs/notes.md').ok, true);
    assert.equal(resolver.check('src/nested/deep.js').ok, true);
    assert.equal(resolver.check('.env').reason, 'denied_by_secret_policy');
  });

  test('rejects traversal before touching the filesystem', () => {
    const resolver = createScopeResolver({ root, grants: [read('.'), read('src')] });
    for (const candidate of ['../outside-secret.txt', 'src/../../outside-secret.txt', 'src/../outside-secret.txt']) {
      assert.equal(resolver.check(candidate).reason, 'escapes_workspace_root', candidate);
    }
  });

  test('rejects absolute, drive-letter, UNC and device paths', () => {
    const resolver = createScopeResolver({ root, grants: [read('.')] });
    const candidates = [
      path.join(root, 'src', 'task-run.js'),
      'C:/Windows/win.ini',
      '\\\\.\\C:\\Windows\\win.ini',
      '\\\\server\\share\\file.txt',
      '//server/share/file.txt',
    ];
    for (const candidate of candidates) {
      assert.equal(resolver.check(candidate).reason, 'absolute_path_rejected', candidate);
    }
  });

  test('the deny-list outranks an explicit grant of the same path', () => {
    const resolver = createScopeResolver({ root, grants: [read('.'), read('src'), read('.env'), read('node_modules')] });
    for (const candidate of ['.env', '.env.local', 'node_modules/pkg/index.js', 'src/secrets.json', 'src/id_rsa', 'src/server.pem', 'outputs/agent.sqlite', '.git/config']) {
      assert.equal(resolver.check(candidate).reason, 'denied_by_secret_policy', candidate);
    }
  });

  test('does not deny ordinary source files that merely mention tokens or secrets', () => {
    const resolver = createScopeResolver({ root, grants: [read('src')] });
    assert.equal(resolver.check('src/tokens.js').ok, true);
  });

  test('distinguishes a missing file from a denied path', () => {
    const resolver = createScopeResolver({ root, grants: [read('src')] });
    assert.equal(resolver.check('src/does-not-exist.js').reason, 'not_found');
    assert.equal(resolver.check('src/nested').reason, 'not_a_file');
  });

  test('accepts a scope that names a single file', () => {
    const resolver = createScopeResolver({ root, grants: [read('src/task-run.js')] });
    assert.equal(resolver.check('src/task-run.js').ok, true);
    assert.equal(resolver.check('src/nested/deep.js').reason, 'outside_granted_scope');
  });

  test('ignores non-read grants when building scopes', () => {
    const resolver = createScopeResolver({
      root,
      grants: [{ name: CAPABILITY.WORKSPACE_WRITE, scope: 'src' }, read('docs')],
    });
    assert.equal(resolver.scopes.length, 1);
    assert.equal(resolver.check('docs/notes.md').ok, true);
    assert.equal(resolver.check('src/task-run.js').reason, 'outside_granted_scope');
  });

  test('a scope pointing at a missing directory authorizes nothing', () => {
    const resolver = createScopeResolver({ root, grants: [read('nope')] });
    assert.equal(resolver.check('src/task-run.js').reason, 'outside_granted_scope');
  });

  test('normalizes backslashes, dot segments and case on Windows', () => {
    const resolver = createScopeResolver({ root, grants: [read('src')] });
    assert.equal(resolver.check('src\\nested\\deep.js').ok, true);
    assert.equal(resolver.check('./src/./task-run.js').ok, true);
    if (process.platform === 'win32') {
      assert.equal(resolver.check('SRC/TASK-RUN.JS').ok, true);
    }
  });

  test('a symlink inside the root cannot reach a file outside it', (t) => {
    const linkPath = path.join(root, 'src', 'escape-link.txt');
    const targetPath = path.join(root, 'outside-secret.txt');
    try {
      fs.symlinkSync(targetPath, linkPath, 'file');
    } catch {
      t.skip('symlink creation needs developer mode on this machine');
      return;
    }
    try {
      const resolver = createScopeResolver({ root, grants: [read('src')] });
      const outcome = resolver.check('src/escape-link.txt');
      assert.equal(outcome.reason, 'outside_granted_scope');
    } finally {
      fs.rmSync(linkPath, { force: true });
    }
  });
});

describe('containsPath', () => {
  test('matches a directory and its descendants but not a sibling prefix', () => {
    assert.equal(containsPath('/a/src', '/a/src/task-run.js'), true);
    assert.equal(containsPath('/a/src', '/a/src'), true);
    assert.equal(containsPath('/a/src', '/a/src-other/task-run.js'), false);
    assert.equal(containsPath('/a/src', '/a'), false);
  });
});

describe('grantsForWorkspaceRead', () => {
  test('keeps only workspace.read grants', () => {
    const grants = [read('src'), { name: CAPABILITY.PROCESS_RUN, scope: 'npm test' }];
    assert.deepEqual(grantsForWorkspaceRead(grants), [read('src')]);
    assert.deepEqual(grantsForWorkspaceRead(), []);
  });
});
