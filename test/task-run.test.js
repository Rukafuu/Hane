import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskRun } from '../src/task-run.js';
import { TASK_STATUS } from '../src/contracts.js';

function driveTo(task, status) {
  const path = [TASK_STATUS.PLANNED, TASK_STATUS.EXECUTING, TASK_STATUS.REVIEWING];
  for (const next of path) {
    task.transition(next);
    if (next === status) return;
  }
}

test('fromSnapshot restores status, calls, outputs and audit without re-recording task_created', () => {
  const task = new TaskRun({ id: 't-1', objective: 'Do the thing.', maxProviderCalls: 2, now: () => '2026-10-09T00:00:00.000Z' });
  task.transition(TASK_STATUS.PLANNED);
  task.reserveProviderCall('planner');
  task.saveOutput('planner', 'plan');
  task.transition(TASK_STATUS.EXECUTING);
  const snapshot = task.snapshot();

  const restored = TaskRun.fromSnapshot(snapshot);

  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.audit.filter((entry) => entry.type === 'task_created').length, 1);
  assert.equal(restored.providerCalls, 1);
  assert.equal(restored.outputs.planner, 'plan');
});

test('a mission remembers the provider label it ran on', () => {
  const task = new TaskRun({ id: 't-labelled', objective: 'Do the thing.', providerLabel: 'openrouter' });
  assert.equal(task.snapshot().providerLabel, 'openrouter');
  assert.deepEqual(task.audit[0].detail.providerLabel, 'openrouter');

  assert.equal(TaskRun.fromSnapshot(task.snapshot()).providerLabel, 'openrouter');
  assert.equal(TaskRun.fromSnapshot({ ...task.snapshot(), providerLabel: undefined }).providerLabel, null);
  assert.throws(() => new TaskRun({ id: 't-bad', objective: 'x', providerLabel: '  ' }), /providerLabel/);
});

test('fromSnapshot rejects unknown statuses and negative call counts', () => {
  const snapshot = new TaskRun({ id: 't-2', objective: 'Do the thing.' }).snapshot();
  assert.throws(() => TaskRun.fromSnapshot({ ...snapshot, status: 'bogus' }), /not a known task status/);
  assert.throws(() => TaskRun.fromSnapshot({ ...snapshot, providerCalls: -1 }), /non-negative integer/);
});

test('extendBudget only grows the budget and records the change in the audit', () => {
  const task = new TaskRun({ id: 't-3', objective: 'Do the thing.', maxProviderCalls: 2 });
  task.extendBudget(5);

  assert.equal(task.maxProviderCalls, 5);
  assert.deepEqual(task.audit.at(-1).type, 'budget_extended');
  assert.deepEqual(task.audit.at(-1).detail, { previousMax: 2, maxProviderCalls: 5 });
  assert.throws(() => task.extendBudget(5), /must be greater/);
  assert.throws(() => task.extendBudget(1), /must be greater/);
  assert.throws(() => task.extendBudget(0), /positive integer/);
});

test('a revise verdict parks the task in awaiting_approval, which resumes into executing', () => {
  const task = new TaskRun({ id: 't-4', objective: 'Do the thing.' });
  driveTo(task, TASK_STATUS.REVIEWING);
  task.transition(TASK_STATUS.AWAITING_APPROVAL);
  assert.equal(task.status, TASK_STATUS.AWAITING_APPROVAL);

  task.transition(TASK_STATUS.EXECUTING);
  assert.equal(task.status, TASK_STATUS.EXECUTING);
});

test('parked and interrupted tasks expose resume transitions, completed stays terminal', () => {
  const parked = new TaskRun({ id: 't-5a', objective: 'Do the thing.' });
  driveTo(parked, TASK_STATUS.REVIEWING);
  parked.transition(TASK_STATUS.AWAITING_APPROVAL);
  assert.throws(() => parked.transition(TASK_STATUS.COMPLETED), /Cannot transition/);
  assert.throws(() => parked.transition(TASK_STATUS.PLANNED), /Cannot transition/);

  const interrupted = new TaskRun({ id: 't-5b', objective: 'Do the thing.' });
  interrupted.transition(TASK_STATUS.PLANNED);
  interrupted.transition(TASK_STATUS.NEEDS_ATTENTION);
  interrupted.transition(TASK_STATUS.REVIEWING);
  assert.equal(interrupted.status, TASK_STATUS.REVIEWING);

  const failed = new TaskRun({ id: 't-5c', objective: 'Do the thing.' });
  failed.transition(TASK_STATUS.PLANNED);
  failed.transition(TASK_STATUS.FAILED);
  failed.transition(TASK_STATUS.EXECUTING);
  assert.equal(failed.status, TASK_STATUS.EXECUTING);

  const done = new TaskRun({ id: 't-5d', objective: 'Do the thing.' });
  driveTo(done, TASK_STATUS.REVIEWING);
  done.transition(TASK_STATUS.COMPLETED);
  assert.throws(() => done.transition(TASK_STATUS.EXECUTING), /Cannot transition/);
});

test('cancelling an active task is persisted in its audit and is terminal', () => {
  const task = new TaskRun({ id: 't-cancel', objective: 'Stop the network request.' });
  task.transition(TASK_STATUS.PLANNED);
  task.cancel('user_requested');

  assert.equal(task.status, TASK_STATUS.CANCELLED);
  assert.deepEqual(task.audit.at(-1).detail, { reason: 'user_requested' });
  assert.throws(() => task.transition(TASK_STATUS.EXECUTING), /Cannot transition/);
});
