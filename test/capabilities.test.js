import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY, assertCapabilityGrants, grantsNeedWorkspaceRoot } from '../src/capabilities.js';
import { TaskRun } from '../src/task-run.js';

test('capability grants are explicit, frozen, and carry into the task audit', () => {
  const grants = assertCapabilityGrants([{ name: CAPABILITY.WORKSPACE_READ, scope: 'work/project' }]);
  assert.equal(Object.isFrozen(grants), true);
  assert.deepEqual(grants, [{ name: CAPABILITY.WORKSPACE_READ, scope: 'work/project' }]);
  assert.equal(Object.isFrozen(grants[0]), true);
  const task = new TaskRun({ id: 'capability-run', objective: 'Inspect a local project.', capabilityGrants: grants });
  assert.deepEqual(task.snapshot().capabilityGrants, grants);
  assert.deepEqual(task.audit[0].detail.capabilityGrants, grants);
});

test('capability grants reject unknown, duplicate, and unsafe scopes', () => {
  assert.throws(() => assertCapabilityGrants([{ name: 'filesystem.delete', scope: '*' }]), /Unknown capability/);
  assert.throws(() => assertCapabilityGrants([{ name: CAPABILITY.WORKSPACE_READ, scope: 'src' }, { name: CAPABILITY.WORKSPACE_READ, scope: 'src' }]), /Duplicate/);
  assert.throws(() => assertCapabilityGrants([{ name: CAPABILITY.PROCESS_RUN, scope: 'node\r\nwhoami' }]), /single-line scope/);
});

test('a path scope that leaves the workspace root is refused at ingress', () => {
  for (const scope of ['../secrets', 'src/../..', 'A:/Hane', 'C:\\Users\\amari', '/etc/passwd', '//server/share']) {
    for (const name of [CAPABILITY.WORKSPACE_READ, CAPABILITY.WORKSPACE_WRITE]) {
      assert.throws(
        () => assertCapabilityGrants([{ name, scope }]),
        /relative path inside the workspace root/,
        `${name}(${scope})`,
      );
    }
  }
});

test('non-path capabilities keep free-form scopes', () => {
  const grants = assertCapabilityGrants([
    { name: CAPABILITY.PROCESS_RUN, scope: 'npm test' },
    { name: CAPABILITY.NETWORK_REQUEST, scope: 'https://example.com' },
  ]);
  assert.deepEqual(grants.map((grant) => grant.scope), ['npm test', 'https://example.com']);
});

test('workspace.write is declarative but still demands a root; process/network grants do not', () => {
  const writeGrants = assertCapabilityGrants([{ name: CAPABILITY.WORKSPACE_WRITE, scope: 'src' }]);
  assert.equal(grantsNeedWorkspaceRoot(writeGrants), true);
  const otherGrants = assertCapabilityGrants([
    { name: CAPABILITY.PROCESS_RUN, scope: 'npm test' },
    { name: CAPABILITY.NETWORK_REQUEST, scope: 'https://example.com' },
  ]);
  assert.equal(grantsNeedWorkspaceRoot(otherGrants), false);
});
