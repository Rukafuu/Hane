import assert from 'node:assert/strict';
import test from 'node:test';
import { Orchestrator } from '../src/orchestrator.js';
import { TaskRun } from '../src/task-run.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { CAPABILITY } from '../src/capabilities.js';

test('persists the task result and ordered audit in SQLite without credentials', async () => {
  const repository = new SqliteTaskRepository(':memory:');
  const provider = {
    async complete({ role }) {
      return role === 'reviewer' ? 'reviewer evidence\nverdict: approved' : `${role} evidence`;
    },
  };
  const orchestrator = new Orchestrator({ provider, repository, idFactory: () => 'persisted-run' });
  await orchestrator.start({ objective: 'Persist a fully audited task.' });

  const saved = repository.findById('persisted-run');
  assert.equal(saved.status, 'completed');
  assert.equal(saved.outputs.reviewer, 'reviewer evidence\nverdict: approved');
  assert.equal(saved.audit[0].type, 'task_created');
  assert.equal(saved.audit.at(-1).detail.nextStatus, 'completed');
  assert.equal(JSON.stringify(saved).includes('apiKey'), false);
  repository.close();
});

test('persists and restores the provider label', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const task = new TaskRun({ id: 'labelled-run', objective: 'Remember the provider.', providerLabel: 'openrouter' });
  task.transition('planned');
  repository.save(task.snapshot());

  assert.equal(repository.findById('labelled-run').providerLabel, 'openrouter');

  const unlabelled = new TaskRun({ id: 'plain-run', objective: 'No provider recorded.' });
  repository.save(unlabelled.snapshot());
  assert.equal(repository.findById('plain-run').providerLabel, null);
  repository.close();
});

test('persists capability grants with the mission, not provider credentials', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const task = new TaskRun({
    id: 'capability-grant-run',
    objective: 'Read a bounded workspace.',
    capabilityGrants: [{ name: CAPABILITY.WORKSPACE_READ, scope: 'work/demo' }],
  });
  repository.save(task.snapshot());

  assert.deepEqual(repository.findById('capability-grant-run').capabilityGrants, [{ name: CAPABILITY.WORKSPACE_READ, scope: 'work/demo' }]);
  repository.close();
});

test('persists the workspace root and tool counters, and restores them for a resume', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const task = new TaskRun({
    id: 'workspace-run',
    objective: 'Read the bounded workspace.',
    capabilityGrants: [{ name: CAPABILITY.WORKSPACE_READ, scope: 'src' }],
    workspaceRoot: 'A:/Hane/work/demo',
    maxToolCalls: 5,
  });
  task.reserveToolCall('executor');
  repository.save(task.snapshot());

  const stored = repository.findById('workspace-run');
  assert.equal(stored.workspaceRoot, 'A:/Hane/work/demo');
  assert.equal(stored.maxToolCalls, 5);
  assert.equal(stored.toolCalls, 1);
  assert.deepEqual(Object.keys(stored.outputs), [], 'file contents stay out of SQLite');

  const rebuilt = TaskRun.fromSnapshot(stored);
  assert.equal(rebuilt.toolCalls, 1);
  assert.equal(rebuilt.workspaceRoot, 'A:/Hane/work/demo');
  repository.close();
});

test('persists the actor mode and the per-actor share, and restores both for a resume', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const task = new TaskRun({
    id: 'actor-run',
    objective: 'Work the DAG concurrently.',
    mode: 'actor',
    maxProviderCalls: 24,
    maxProviderCallsPerActor: 5,
  });
  task.reserveProviderCall('executor', 'agent-ana');
  repository.save(task.snapshot());

  const stored = repository.findById('actor-run');
  assert.equal(stored.mode, 'actor');
  assert.equal(stored.maxProviderCallsPerActor, 5);

  const rebuilt = TaskRun.fromSnapshot(stored);
  assert.equal(rebuilt.mode, 'actor');
  assert.equal(rebuilt.maxProviderCallsPerActor, 5);
  assert.deepEqual(rebuilt.actorCalls(), [{ agentId: 'agent-ana', providerCalls: 1 }]);

  // The share is the budget the user authorized at creation, so a later save that
  // carries no share at all must leave the stored one alone instead of defaulting
  // the mission back to 6.
  repository.save({ ...task.snapshot(), maxProviderCallsPerActor: undefined });
  assert.equal(repository.findById('actor-run').maxProviderCallsPerActor, 5);
  repository.close();
});

test('refuses to rewind the tool counter of a stored mission', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const task = new TaskRun({ id: 'tool-rewind', objective: 'Read files.', workspaceRoot: 'A:/Hane', capabilityGrants: [{ name: CAPABILITY.WORKSPACE_READ, scope: 'src' }] });
  task.reserveToolCall('executor');
  repository.save(task.snapshot());

  const rewind = { ...task.snapshot(), toolCalls: 0 };
  assert.throws(() => repository.save(rewind), /fewer tool calls/);
  repository.close();
});

test('a mission stored before the workspace columns loads with the tool defaults', () => {
  const repository = new SqliteTaskRepository(':memory:');
  repository.database.prepare('INSERT INTO task_runs (id, objective, status, max_provider_calls, provider_calls) VALUES (?, ?, ?, ?, ?)')
    .run('legacy-row', 'Stored before phase 5.', 'completed', 3, 3);

  const stored = repository.findById('legacy-row');
  assert.equal(stored.workspaceRoot, null);
  assert.equal(stored.maxToolCalls, 24);
  assert.equal(stored.toolCalls, 0);
  assert.doesNotThrow(() => TaskRun.fromSnapshot(stored));
  repository.close();
});

test('appends audit entries across incremental saves without rewriting stored history', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const task = new TaskRun({ id: 'incremental-run', objective: 'Persist incrementally.', now: () => 'fixed-timestamp' });
  task.transition('planned');
  repository.save(task.snapshot());
  const afterFirst = repository.findById('incremental-run');
  assert.equal(afterFirst.audit.length, 2);

  task.reserveProviderCall('planner');
  repository.save(task.snapshot());
  const afterSecond = repository.findById('incremental-run');

  assert.equal(afterSecond.audit.length, 3);
  assert.deepEqual(afterSecond.audit.slice(0, 2), afterFirst.audit);
  repository.close();
});

test('accepts a shared database handle', () => {
  const database = openHaneDatabase(':memory:');
  const repository = new SqliteTaskRepository({ database });
  const task = new TaskRun({ id: 'shared-run', objective: 'Share one database handle.' });
  task.transition('planned');
  repository.save(task.snapshot());

  const saved = repository.findById('shared-run');
  assert.equal(saved.status, 'planned');
  database.close();
});

test('lists missions most recently active first without loading bodies', async () => {
  const repository = new SqliteTaskRepository(':memory:');
  const provider = {
    async complete({ role }) {
      return role === 'reviewer' ? 'reviewer evidence\nverdict: approved' : `${role} evidence`;
    },
  };
  const run = async (id) => {
    const orchestrator = new Orchestrator({ provider, repository, idFactory: () => id, });
    await orchestrator.start({ objective: `Mission ${id}.`, });
  };

  await run('older-run');
  await run('newer-run');

  const missions = repository.list();
  assert.deepEqual(missions.map((mission) => mission.id), ['newer-run', 'older-run']);
  assert.deepEqual(Object.keys(missions[0]), ['id', 'objective', 'status', 'mode', 'maxProviderCalls', 'providerCalls', 'updatedAt']);
  assert.equal(missions[0].status, 'completed');
  assert.equal(missions[0].providerCalls, 3);
  assert.match(missions[0].updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(missions[0].updatedAt >= missions[1].updatedAt);
  assert.equal('outputs' in missions[0], false);
  assert.equal('audit' in missions[0], false);
  repository.close();
});

test('a tie on the activity timestamp lists the mission created later first', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const sameMillisecond = () => '2026-05-05T10:00:00.000Z';
  for (const id of ['zzz-created-first', 'aaa-created-second']) {
    const task = new TaskRun({ id, objective: `Tied ${id}.`, now: sameMillisecond });
    task.transition('planned');
    repository.save(task.snapshot());
  }

  // The ids are deliberately reverse-alphabetical to the insert order: sorting the tie
  // by id would put the older mission first.
  assert.deepEqual(repository.list().map((mission) => mission.id), ['aaa-created-second', 'zzz-created-first']);
  repository.close();
});

test('the mission list says which run works in actors', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const crew = new TaskRun({ id: 'crew-run', objective: 'Três mãos ao mesmo tempo.', mode: 'actor', maxProviderCalls: 24, maxProviderCallsPerActor: 6 });
  crew.transition('planned');
  repository.save(crew.snapshot());
  const plain = new TaskRun({ id: 'plain-run', objective: 'Uma rodada atrás da outra.' });
  plain.transition('planned');
  repository.save(plain.snapshot());

  const byId = Object.fromEntries(repository.list().map((mission) => [mission.id, mission]));
  assert.equal(byId['crew-run'].mode, 'actor');
  assert.equal(byId['plain-run'].mode, 'sequential', 'a run listed without ever saying a mode is still sequential');
  assert.equal('maxProviderCallsPerActor' in byId['crew-run'], false, 'the bodies stay out of the list, budget shares included');
  repository.close();
});

test('rejects a save that would move provider calls backwards', () => {
  const repository = new SqliteTaskRepository(':memory:');
  const task = new TaskRun({ id: 'monotonic-run', objective: 'Protect the call budget.' });
  task.reserveProviderCall('planner');
  repository.save(task.snapshot());

  const rewound = new TaskRun({ id: 'monotonic-run', objective: 'Protect the call budget.' });
  assert.throws(() => repository.save(rewound.snapshot()), /provider calls/);
  repository.close();
});
