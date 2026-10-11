import assert from 'node:assert/strict';
import test from 'node:test';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteActorTaskStore } from '../src/storage/sqlite-actor-task-store.js';
import { SqliteStateStore } from '../src/storage/sqlite-state-store.js';
import { SqliteMissionEventStore } from '../src/storage/sqlite-mission-events.js';
import { TaskRun } from '../src/task-run.js';
import { assertActorDag, blockedTasks, isSettled, normalizeActorTask, readyTasks, MAX_ACTOR_TASKS } from '../src/actors/dag.js';
import { createActorScheduler } from '../src/actors/scheduler.js';
import { createEventBus } from '../src/actors/bus.js';
import { createSharedState } from '../src/actors/state.js';

const MISSION = 'mission-scheduler';
const REF = { kind: 'mission', id: MISSION };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ROSTER = Object.freeze([{ agentId: A, name: 'Ana' }, { agentId: B, name: 'Beto' }, { agentId: C, name: 'Celia' }]);

const plan = (...tasks) => tasks.map(([id, title, assignee, dependsOn = []]) => ({ id, title, assigneeAgentId: assignee, dependsOn }));

function storeFixture() {
  const database = openHaneDatabase(':memory:');
  return { database, tasks: new SqliteActorTaskStore({ database }) };
}

function schedulerFixture({ tasks: seed = [], roster = ROSTER, runTurn, maxConcurrentActors, signal = null, state = true } = {}) {
  const database = openHaneDatabase(':memory:');
  const events = new SqliteMissionEventStore({ database });
  const store = new SqliteActorTaskStore({ database });
  const bus = createEventBus({ events, executionRef: REF });
  const trail = [];
  bus.subscribe((event) => trail.push(event));
  const task = new TaskRun({ id: MISSION, objective: 'Três agentes, um objetivo.', mode: 'actor', maxProviderCalls: 24, capabilityGrants: [] });
  const shared = state ? createSharedState({ executionRef: REF, store: new SqliteStateStore({ database }), bus, audit: (type, detail) => task.record(type, detail) }) : null;
  if (seed.length > 0) store.create({ executionId: MISSION, tasks: assertActorDag({ tasks: seed, agentIds: roster.map((agent) => agent.agentId) }) });
  const scheduler = createActorScheduler({
    executionRef: REF, ledger: task, bus, tasks: store, roster, state: shared,
    runTurn, ...(maxConcurrentActors === undefined ? {} : { maxConcurrentActors }), ...(signal === null ? {} : { signal }),
  });
  return { database, store, bus, trail, task, scheduler, state: shared };
}

const ok = (content) => async () => ({ ok: true, content });

async function until(predicate, tries = 60) {
  for (let index = 0; index < tries; index += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return false;
}

/** A turn that does not finish until the test says so: the only way to prove overlap. */
function gatedRunner(watch) {
  const gates = new Map();
  const runTurn = ({ task }) => {
    watch.started.push(task.id);
    watch.inFlight += 1;
    watch.peak = Math.max(watch.peak, watch.inFlight);
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    gates.set(task.id, resolve);
    return promise.then(() => {
      watch.inFlight -= 1;
      watch.finished.push(task.id);
      return { ok: true, content: `concluído ${task.id}` };
    });
  };
  runTurn.release = (id) => gates.get(id)?.();
  runTurn.pending = () => [...gates.keys()];
  return runTurn;
}

test('the DAG accepts what a scheduler can actually run', () => {
  const tasks = plan(['t1', 'Ler o código', A], ['t2', 'Rodar os testes', B], ['t3', 'Escrever o veredito', C, ['t1', 't2']]);
  const validated = assertActorDag({ tasks, agentIds: [A, B, C] });
  assert.equal(validated.length, 3);
  assert.deepEqual(validated[2].dependsOn, ['t1', 't2']);
  assert.equal(Object.isFrozen(validated), true);

  const repeated = assertActorDag({ tasks: plan(['t1', 'a', A], ['t2', 'b', B, ['t1', 't1']]), agentIds: [A, B] });
  assert.deepEqual(repeated[1].dependsOn, ['t1'], 'the same dependency twice is one dependency');
  assert.deepEqual(normalizeActorTask({ id: ' t1 ', title: ' LER ', assigneeAgentId: ' A ', dependsOn: undefined }).dependsOn, []);
});

test('every refusal a scheduler would otherwise meet mid-run is refused on the way in', () => {
  const roster = [A, B];
  assert.throws(() => assertActorDag({ tasks: [], agentIds: roster }), /at least one task/);
  assert.throws(() => assertActorDag({ tasks: plan(['t1', 'a', A], ['t1', 'b', B]), agentIds: roster }), /appears twice/);
  assert.throws(() => assertActorDag({ tasks: plan(['t1', 'a', '99999999-9999-4999-8999-999999999999']), agentIds: roster }), /not in this execution/);
  assert.throws(() => assertActorDag({ tasks: plan(['t1', 'a', A, ['ghost']]), agentIds: roster }), /which this plan does not have/);
  assert.throws(() => assertActorDag({ tasks: plan(['t1', 'a', A, ['t1']]), agentIds: roster }), /depends on itself/);
  assert.throws(() => assertActorDag({ tasks: plan(['t1', 'a', A, ['t2']], ['t2', 'b', B, ['t1']]), agentIds: roster }), /depend on each other and would never start: t1, t2/);
  assert.throws(() => assertActorDag({ tasks: plan(['t1', '', A]), agentIds: roster }), /single-line title/);
  assert.throws(() => assertActorDag({ tasks: plan(['t1', 'a\nb', A]), agentIds: roster }), /single-line title/);
  assert.throws(() => assertActorDag({ tasks: Array.from({ length: MAX_ACTOR_TASKS + 1 }, (_, index) => ({ id: `t${index}`, title: 'x', assigneeAgentId: A })), agentIds: roster }), /at most 12 tasks/);
  assert.throws(() => assertActorDag({ tasks: plan(['t1', 'a', A]), agentIds: [] }), /at least one agent/);
});

test('eligibility is what the predecessors say, not what the queue order says', () => {
  const rows = [
    { id: 't1', assigneeAgentId: A, dependsOn: [], status: 'completed' },
    { id: 't2', assigneeAgentId: B, dependsOn: ['t1'], status: 'pending' },
    { id: 't3', assigneeAgentId: C, dependsOn: ['t1'], status: 'pending' },
    { id: 't4', assigneeAgentId: C, dependsOn: ['t2'], status: 'pending' },
  ];
  assert.deepEqual(readyTasks(rows).map((task) => task.id), ['t2', 't3']);
  assert.deepEqual(readyTasks(rows, { runningAgentIds: new Set([C]) }).map((task) => task.id), ['t2'], 'one agent runs one task at a time');
  assert.deepEqual(readyTasks(rows.map((task) => ({ ...task, status: 'running' }))), [], 'a task in the air is not eligible again');
  assert.equal(isSettled(rows), false);
  assert.equal(isSettled([{ status: 'completed' }, { status: 'failed' }, { status: 'blocked' }]), true);
});

test('a failed step strands what waited on it, and never silently completes it', () => {
  const rows = [
    { id: 't1', dependsOn: [], status: 'failed' },
    { id: 't2', dependsOn: ['t1'], status: 'pending' },
    { id: 't3', dependsOn: ['t2'], status: 'ready' },
    { id: 't4', dependsOn: [], status: 'completed' },
    { id: 't5', dependsOn: ['t4'], status: 'completed' },
  ];
  assert.deepEqual(blockedTasks(rows).map((task) => task.id), ['t2', 't3'], 'the strand is transitive');
  assert.deepEqual(blockedTasks([{ id: 't1', dependsOn: [], status: 'completed' }]), []);
});

test('the plan is booked once and a retry does not rewind what already ran', () => {
  const { database, tasks } = storeFixture();
  const seeded = plan(['t1', 'Ler', A], ['t2', 'Rodar', B, ['t1']]);
  const first = tasks.create({ executionId: MISSION, tasks: seeded, now: '2026-10-11T00:00:00.000Z' });
  assert.equal(first.inserted, 2);
  assert.deepEqual(first.tasks.map((task) => task.status), ['pending', 'pending']);

  const claimed = tasks.claim({ executionId: MISSION, id: 't1', owner: A });
  assert.equal(claimed.status, 'running');
  tasks.complete({ executionId: MISSION, id: 't1', owner: A, resultKey: 'task:t1' });

  const retried = tasks.create({ executionId: MISSION, tasks: seeded });
  assert.equal(retried.inserted, 0, 'a resumed mission re-sends the plan it already has');
  assert.equal(retried.tasks[0].status, 'completed', 'and that does not send completed work back to the queue');
  assert.equal(retried.tasks[0].resultKey, 'task:t1');
  database.close();
});

test('only the hand holding the lease closes a task', () => {
  const { database, tasks } = storeFixture();
  tasks.create({ executionId: MISSION, tasks: plan(['t1', 'Ler', A], ['t2', 'Ler outra', A]) });
  assert.notEqual(tasks.claim({ executionId: MISSION, id: 't1', owner: A }), null);
  assert.equal(tasks.claim({ executionId: MISSION, id: 't1', owner: A }), null, 'a task in the air is not claimed twice');
  assert.equal(tasks.complete({ executionId: MISSION, id: 't1', owner: B }), null, 'another owner cannot close it');
  assert.equal(tasks.fail({ executionId: MISSION, id: 't1', owner: B, reason: 'invenção' }), null);
  assert.equal(tasks.release({ executionId: MISSION, id: 't1', owner: B, reason: 'invenção' }), null);
  const closed = tasks.complete({ executionId: MISSION, id: 't1', owner: A, resultKey: 'task:t1' });
  assert.equal(closed.status, 'completed');
  assert.equal(closed.claimOwner, null, 'a closed task holds no lease');
  assert.equal(tasks.counts({ executionId: MISSION }).completed, 1);
  database.close();
});

test('a task is handed back below the ceiling and fails at it', () => {
  const { database, tasks } = storeFixture();
  tasks.create({ executionId: MISSION, tasks: plan(['t1', 'Ler', A]) });
  const released = tasks.claim({ executionId: MISSION, id: 't1', owner: A }) && tasks.release({ executionId: MISSION, id: 't1', owner: A, reason: 'turn_failed' });
  assert.equal(released.status, 'ready');
  assert.equal(released.attempts, 1);
  tasks.claim({ executionId: MISSION, id: 't1', owner: A });
  tasks.release({ executionId: MISSION, id: 't1', owner: A, reason: 'turn_failed' });
  tasks.claim({ executionId: MISSION, id: 't1', owner: A });
  tasks.release({ executionId: MISSION, id: 't1', owner: A, reason: 'turn_failed' });
  assert.equal(tasks.get({ executionId: MISSION, id: 't1' }).attempts, 3);
  assert.equal(tasks.claim({ executionId: MISSION, id: 't1', owner: A }), null, 'a fourth attempt is not handed out');
  assert.equal(tasks.release({ executionId: MISSION, id: 't1', owner: 'ninguém', reason: 'invenção' }), null, 'and a hand without the lease cannot rewrite that verdict');
  database.close();
});

test('a lease that outlived its holder is reconciled, not trusted', () => {
  const { database, tasks } = storeFixture();
  tasks.create({ executionId: MISSION, tasks: plan(['t1', 'Ler', A], ['t2', 'Rodar', B]) });
  tasks.claim({ executionId: MISSION, id: 't1', owner: A, leaseMs: 1_000, now: '2026-10-11T00:00:00.000Z' });
  tasks.claim({ executionId: MISSION, id: 't2', owner: B, leaseMs: 1_000, now: '2026-10-11T00:00:00.000Z' });
  tasks.claim({ executionId: MISSION, id: 't2', owner: B, leaseMs: 1_000, now: '2026-10-11T00:00:00.000Z' });
  // Two more rounds for t2 and it is at the ceiling — done through the store so the
  // test does not hand out a claim the lease rules would refuse.
  for (let index = 0; index < 2; index += 1) {
    tasks.release({ executionId: MISSION, id: 't2', owner: B, reason: 'turn_failed', now: '2026-10-11T00:00:00.000Z' });
    tasks.database.prepare("UPDATE actor_tasks SET status = 'ready', lease_expires_at = NULL WHERE execution_id = ? AND id = ?").run(MISSION, 't2');
    tasks.claim({ executionId: MISSION, id: 't2', owner: B, leaseMs: 1_000, now: '2026-10-11T00:00:00.000Z' });
  }
  const recovered = tasks.recoverExpiredLeases({ executionId: MISSION, now: '2026-10-11T01:00:00.000Z' });
  assert.deepEqual(recovered.released, ['t1'], 'one turn lost is one task requeued');
  assert.deepEqual(recovered.failed, ['t2'], 'and the task that keeps dying is declared, not retried forever');
  assert.equal(tasks.get({ executionId: MISSION, id: 't2' }).note, 'lease_exhausted');
  database.close();
});

test('marking ready and blocking never touch a task in the air', () => {
  const { database, tasks } = storeFixture();
  tasks.create({ executionId: MISSION, tasks: plan(['t1', 'Ler', A], ['t2', 'Rodar', B], ['t3', 'Fechar', C]) });
  assert.equal(tasks.markReady({ executionId: MISSION, ids: ['t1', 't2'] }), 2);
  tasks.claim({ executionId: MISSION, id: 't1', owner: A });
  assert.equal(tasks.markReady({ executionId: MISSION, ids: ['t1'] }), 0);
  assert.equal(tasks.block({ executionId: MISSION, ids: ['t1', 't2', 't3'], reason: 'predecessor_failed' }), 2, 'the running task is not blocked under its own owner');
  assert.equal(tasks.get({ executionId: MISSION, id: 't1' }).status, 'running');
  assert.equal(tasks.get({ executionId: MISSION, id: 't3' }).note, 'predecessor_failed');
  database.close();
});

test('two independent tasks are in the provider at the same time', async () => {
  const watch = { started: [], finished: [], inFlight: 0, peak: 0 };
  const runTurn = gatedRunner(watch);
  const { scheduler, store, trail, task } = schedulerFixture({
    tasks: plan(['t1', 'Ler o código', A], ['t2', 'Rodar os testes', B]),
    runTurn,
  });
  const done = scheduler.run();
  assert.equal(await until(() => watch.started.length >= 2), true, `both turns must start before either finishes: ${JSON.stringify(watch.started)}`);
  assert.ok(watch.peak >= 2, `peak simultaneous turns was ${watch.peak}: two actor_started lines alone are not concurrency`);
  assert.equal(store.get({ executionId: MISSION, id: 't1' }).status, 'running');
  assert.equal(store.get({ executionId: MISSION, id: 't2' }).status, 'running');

  runTurn.release('t1');
  assert.equal(await until(() => watch.finished.includes('t1')), true);
  runTurn.release('t2');
  const summary = await done;
  assert.deepEqual({ completed: summary.completed, failed: summary.failed, blocked: summary.blocked }, { completed: 2, failed: 0, blocked: 0 });
  assert.equal(watch.started.length, 2, 'nothing ran twice');
  assert.deepEqual([...new Set(watch.started)].sort(), ['t1', 't2']);
  assert.deepEqual([...new Set(watch.finished)].sort(), ['t1', 't2']);
  assert.equal(trail.filter((event) => event.type === 'actor_task_completed').length, 2);
  assert.equal(task.audit.filter((entry) => entry.type === 'actor_started').length, 2);
});

test('one agent may not be in two places, and a dependent waits for its predecessor', async () => {
  const watch = { started: [], finished: [], inFlight: 0, peak: 0 };
  const runTurn = gatedRunner(watch);
  const { scheduler, store } = schedulerFixture({
    // t3 belongs to the same agent as t1: the sequential half of the model.
    tasks: plan(['t1', 'Ler', A], ['t2', 'Rodar', B], ['t3', 'Concluir', A, ['t2']]),
    runTurn,
    maxConcurrentActors: 3,
  });
  const done = scheduler.run();
  assert.equal(await until(() => watch.started.length >= 2), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(watch.started.includes('t3'), false, 't3 waits for t2 and for Ana, who is already reading');
  assert.equal(watch.peak, 2, 'three slots cannot put one agent in two tasks');

  runTurn.release('t2');
  assert.equal(await until(() => watch.finished.includes('t2')), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(watch.started.includes('t3'), false, 'a free slot does not make an agent free: the predecessor is done but Ana is not');

  runTurn.release('t1');
  assert.equal(await until(() => watch.started.includes('t3')), true, 'with its predecessor completed and its agent free, t3 may start');
  assert.equal(store.get({ executionId: MISSION, id: 't3' }).status, 'running');
  runTurn.release('t3');
  const summary = await done;
  assert.equal(summary.completed, 3);
  assert.equal(watch.finished.indexOf('t2') < watch.finished.indexOf('t3'), true, 'the predecessor finished first');
  assert.equal(watch.started.indexOf('t1') < watch.started.indexOf('t3'), true, 'and the same agent never ran them over');
});

test('the ceiling on simultaneous actors is real', async () => {
  const watch = { started: [], finished: [], inFlight: 0, peak: 0 };
  const runTurn = gatedRunner(watch);
  const { scheduler } = schedulerFixture({
    tasks: plan(['t1', 'a', A], ['t2', 'b', B], ['t3', 'c', C], ['t4', 'd', A], ['t5', 'e', B]),
    runTurn,
    maxConcurrentActors: 8,
  });
  const done = scheduler.run();
  assert.equal(await until(() => watch.started.length >= 3), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduler.slots, 3, 'a request above the ceiling is refused, and the roster caps it too');
  assert.equal(watch.peak, 3, 'no more than three turns are ever in the air');
  for (const id of ['t1', 't2', 't3']) runTurn.release(id);
  assert.equal(await until(() => watch.started.length >= 5), true);
  for (const id of ['t4', 't5']) runTurn.release(id);
  assert.equal((await done).completed, 5);
});

test('a turn that produced nothing is a failure, and its dependents are stranded visibly', async () => {
  const { scheduler, store, trail, task } = schedulerFixture({
    tasks: plan(['t1', 'Ler', A], ['t2', 'Concluir', B, ['t1']]),
    runTurn: async ({ task: current }) => (current.id === 't1' ? { ok: true, content: '   ' } : { ok: true, content: 'não deveria rodar' }),
  });
  const summary = await scheduler.run();
  assert.equal(summary.failed, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(store.get({ executionId: MISSION, id: 't1' }).note, 'no_answer');
  assert.equal(store.get({ executionId: MISSION, id: 't2' }).status, 'blocked');
  assert.equal(store.get({ executionId: MISSION, id: 't2' }).note, 'predecessor_failed');
  assert.equal(trail.filter((event) => event.type === 'actor_refused').length, 1);
  assert.equal(task.audit.some((entry) => entry.type === 'actor_stopped' && entry.detail.status === 'failed'), true);
});

test('a turn that could not buy its call leaves the queue intact and stops the run', async () => {
  const calls = [];
  const { scheduler, store, trail } = schedulerFixture({
    tasks: plan(['t1', 'Ler', A], ['t2', 'Rodar', B], ['t3', 'Concluir', C, ['t2']]),
    runTurn: async ({ task: current }) => {
      calls.push(current.id);
      if (current.id === 't2') return { ok: false, content: null, spentTurn: false, reason: 'provider_budget_exhausted' };
      return { ok: true, content: `feito ${current.id}` };
    },
  });
  const summary = await scheduler.run();
  assert.equal(summary.exhausted, true);
  // The budget ran out, not the work: the task nobody started goes back to the
  // queue rather than being rewritten as failed or stranded, so the run a user
  // starts after raising the ceiling picks up exactly where this one stopped.
  assert.equal(store.get({ executionId: MISSION, id: 't2' }).status, 'ready');
  assert.equal(store.get({ executionId: MISSION, id: 't3' }).status, 'pending');
  assert.equal(calls.includes('t3'), false, 'the run stops rather than asking for more calls');
  assert.equal(summary.completed, 1);
  const refusal = trail.filter((event) => event.type === 'actor_refused');
  assert.deepEqual(refusal.map((event) => event.reason), ['provider_budget_exhausted'], 'and the stop is said out loud, once');
  assert.deepEqual(refusal[0].tasks, ['t2', 't3']);
});

test('a provider that throws is retried and then declared, without hanging the mission', async () => {
  const attempts = [];
  const { scheduler, store } = schedulerFixture({
    tasks: plan(['t1', 'Ler', A], ['t2', 'Rodar', B, ['t1']]),
    runTurn: async ({ task: current }) => {
      attempts.push(current.attempts);
      throw new Error(`o gateway caiu ${current.attempts}`);
    },
  });
  const summary = await scheduler.run();
  assert.deepEqual(attempts, [1, 2, 3], 'the same task is handed out once per attempt, and never a fourth time');
  assert.equal(summary.failed, 1);
  assert.equal(store.get({ executionId: MISSION, id: 't1' }).status, 'failed');
  assert.equal(store.get({ executionId: MISSION, id: 't2' }).status, 'blocked');
});

test('a crash that left a task in the air is picked up by the first tick', async () => {
  const started = [];
  const { database, store, bus, task } = (() => {
    const handle = openHaneDatabase(':memory:');
    const events = new SqliteMissionEventStore({ database: handle });
    const actorStore = new SqliteActorTaskStore({ database: handle });
    actorStore.create({ executionId: MISSION, tasks: plan(['t1', 'Ler', A], ['t2', 'Rodar', B, ['t1']]) });
    const claimed = actorStore.claim({ executionId: MISSION, id: 't1', owner: A, leaseMs: 1_000, now: '2026-10-11T00:00:00.000Z' });
    assert.equal(claimed.status, 'running');
    return { database: handle, store: actorStore, bus: createEventBus({ events, executionRef: REF }), task: new TaskRun({ id: MISSION, objective: 'Retomar.', mode: 'actor', maxProviderCalls: 24 }) };
  })();
  const scheduler = createActorScheduler({
    executionRef: REF, ledger: task, bus, tasks: store, roster: ROSTER, state: null,
    // The reconciled run reads a lease that has already expired on this clock.
    runTurn: async ({ task: current }) => { started.push(current.id); return { ok: true, content: `feito ${current.id}` }; },
  });
  const summary = await scheduler.run();
  assert.deepEqual(started, ['t1', 't2'], 'the interrupted task runs again and its dependent follows');
  assert.equal(summary.completed, 2);
  assert.equal(store.get({ executionId: MISSION, id: 't1' }).attempts, 2);
  database.close();
});

test('cancellation drains the turn in flight and starts nothing new', async () => {
  const watch = { started: [], finished: [], inFlight: 0, peak: 0 };
  const runTurn = gatedRunner(watch);
  const controller = new AbortController();
  const { scheduler, store } = schedulerFixture({
    tasks: plan(['t1', 'Ler', A], ['t2', 'Rodar', B], ['t3', 'Concluir', C]),
    runTurn,
    signal: controller.signal,
    maxConcurrentActors: 2,
  });
  const done = scheduler.run();
  assert.equal(await until(() => watch.started.length === 2), true);
  controller.abort();
  // The abort only takes effect where the runtime lets it: the turns still in the
  // air are answered, and the third task is never handed out.
  runTurn.release('t1');
  assert.equal(await until(() => watch.finished.includes('t1')), true);
  runTurn.release('t2');
  const summary = await done;
  assert.equal(summary.cancelled, true);
  assert.equal(watch.started.includes('t3'), false);
  // Draining is not discarding: an answer that landed after the cancel is real work,
  // already on the board, and putting the task back in the queue would run its
  // external effects a second time on resume.
  assert.equal(store.get({ executionId: MISSION, id: 't1' }).status, 'completed');
  assert.equal(store.get({ executionId: MISSION, id: 't3' }).status, 'ready', 'it was made startable before the cancel landed, and then never handed out');
  assert.equal(summary.running, 0, 'the mission never leaves a task in the air behind');
  assert.equal(summary.ready, 1, 'what never started is still owed, and visible as such');
});

test('the scheduler is the hand that writes the board', async () => {
  const { scheduler, store, state, trail, task } = schedulerFixture({
    tasks: plan(['t1', 'Ler o código', A]),
    runTurn: ok('a linha 12 compara o rev wrong'),
  });
  await scheduler.run();
  const board = state.read('task:t1');
  assert.equal(board.revision, 1);
  assert.deepEqual(board.value, { taskId: 't1', agentId: A, title: 'Ler o código', content: 'a linha 12 compara o rev wrong' });
  assert.equal(board.writerAgentId, A);
  assert.equal(store.get({ executionId: MISSION, id: 't1' }).resultKey, 'task:t1');
  assert.deepEqual(trail.filter((event) => event.type === 'actor_state_committed').map((event) => event.key), ['task:t1']);
  assert.equal(task.audit.some((entry) => entry.type === 'actor_task_completed' && entry.detail.resultKey === 'task:t1'), true);
});
