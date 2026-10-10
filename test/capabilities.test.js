import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY, assertCapabilityGrants, hasCapability } from '../src/capabilities.js';
import { TaskRun } from '../src/task-run.js';

test('capability grants are explicit, frozen, and carry into the task audit', () => {
  const grants = assertCapabilityGrants([{ name: CAPABILITY.WORKSPACE_READ, scope: 'A:/Hane/work/project' }]);
  assert.equal(Object.isFrozen(grants), true);
  assert.equal(hasCapability(grants, CAPABILITY.WORKSPACE_READ, 'A:/Hane/work/project'), true);
  const task = new TaskRun({ id: 'capability-run', objective: 'Inspect a local project.', capabilityGrants: grants });
  assert.deepEqual(task.snapshot().capabilityGrants, grants);
  assert.deepEqual(task.audit[0].detail.capabilityGrants, grants);
});

test('capability grants reject unknown, duplicate, and unsafe scopes', () => {
  assert.throws(() => assertCapabilityGrants([{ name: 'filesystem.delete', scope: '*' }]), /Unknown capability/);
  assert.throws(() => assertCapabilityGrants([{ name: CAPABILITY.WORKSPACE_READ, scope: 'A:/Hane' }, { name: CAPABILITY.WORKSPACE_READ, scope: 'A:/Hane' }]), /Duplicate/);
  assert.throws(() => assertCapabilityGrants([{ name: CAPABILITY.PROCESS_RUN, scope: 'node\r\nwhoami' }]), /single-line scope/);
});
