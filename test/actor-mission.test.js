import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { SqliteActorTaskStore } from '../src/storage/sqlite-actor-task-store.js';
import { SqliteMailboxStore } from '../src/storage/sqlite-mailbox-store.js';
import { SqliteStateStore } from '../src/storage/sqlite-state-store.js';
import { CAPABILITY } from '../src/capabilities.js';
import { TaskRun } from '../src/task-run.js';
import { ActorOrchestrator } from '../src/actors/orchestrator.js';
import { createSharedState } from '../src/actors/state.js';
import { createActorMailbox } from '../src/actors/mailbox.js';
import { reconcileOnResume } from '../src/actors/reconcile.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const MISSION = 'mission-actor-run';
const REF = { kind: 'mission', id: MISSION };

const agent = (agentId, name, capabilities = []) => Object.freeze({
  agentId, name, instructions: `Conduza-se como ${name}.`, capabilities, instructionFiles: [],
});
const ROSTER = Object.freeze([agent(A, 'Ana', ['workspace.read', 'team.communicate']), agent(B, 'Beto', ['team.communicate']), agent(C, 'Celia')]);
const COMM = Object.freeze([{ name: CAPABILITY.TEAM_COMMUNICATE, scope: 'all' }]);
const plan = (...tasks) => tasks.map(([id, title, assignee, dependsOn = []]) => ({ id, title, assigneeAgentId: assignee, dependsOn }));

/**
 * The provider an actor mission is tested against: a scripted answer per turn, no
 * network, and a record of every prompt it was shown — which is how these tests
 * read what the runtime actually put in front of the model.
 */
class ScriptedProvider {
  constructor(script = [], verdict = 'Revisão concluída. approved') {
    this.script = [...script];
    this.turns = [];
    this.reviews = [];
    this.verdict = verdict;
  }
  async completeTurn({ messages }) {
    this.turns.push(structuredClone(messages));
    const next = this.script.shift();
    if (next === undefined) throw new Error('o ator pediu mais turnos do que o roteiro tem');
    if (next.throw) throw new Error(next.throw);
    return { content: next.content ?? null, toolCalls: next.toolCalls ?? [], protocol: next.protocol ?? 'native' };
  }
  async complete(request) {
    // Only the data the reviewer was shown is kept: the request also carries the
    // retry callback, and a clone of a function is a TypeError, not a test.
    this.reviews.push({ objective: request.objective, instruction: request.instruction, priorOutputs: request.priorOutputs });
    return this.verdict;
  }
  get prompts() { return this.turns.map((messages) => JSON.stringify(messages)); }
}

function harness({ script = {}, verdict = undefined } = {}) {
  const repository = new SqliteTaskRepository(':memory:');
  const providers = new Map();
  for (const entry of ROSTER) {
    providers.set(entry.agentId, new ScriptedProvider(script[entry.agentId] ?? [], ...(verdict === undefined ? [] : [verdict])));
  }
  const orchestrator = new ActorOrchestrator({ providers, database: repository.database, repository, idFactory: () => MISSION });
  return {
    repository, providers, orchestrator,
    tasks: new SqliteActorTaskStore({ database: repository.database }),
    mailbox: new SqliteMailboxStore({ database: repository.database }),
    state: new SqliteStateStore({ database: repository.database }),
    events: [],
    get onEvent() { return (event) => this.events.push(event); },
  };
}

const start = (world, tasks, extra = {}) => world.orchestrator.start({
  objective: 'Três agentes, um objetivo, ao mesmo tempo.',
  tasks,
  roster: ROSTER,
  reviewerAgentId: C,
  maxProviderCalls: 24,
  capabilityGrants: [],
  onEvent: world.onEvent,
  ...extra,
});

const actorCalls = (task) => [...task.actorCalls()].sort((left, right) => left.agentId.localeCompare(right.agentId));

test('a mission of three actors works the plan at once and ends on a verdict', async () => {
  const world = harness({
    script: {
      [A]: [{ content: 'Li o módulo: a fila é FIFO.' }],
      [B]: [{ content: 'Rodei os testes: 18 verdes.' }],
      [C]: [{ content: 'Síntese: o plano está correto.' }],
    },
  });
  const task = await start(world, plan(['t1', 'Ler o código', A], ['t2', 'Rodar os testes', B], ['t3', 'Concluir', C, ['t1', 't2']]));

  assert.equal(task.status, 'completed');
  assert.equal(task.mode, 'actor');
  assert.deepEqual(world.tasks.counts({ executionId: MISSION }), { total: 3, pending: 0, ready: 0, running: 0, completed: 3, failed: 0, blocked: 0 });
  assert.equal(task.providerCalls, 4, 'three actors and one review');
  assert.deepEqual(actorCalls(task), [{ agentId: A, providerCalls: 1 }, { agentId: B, providerCalls: 1 }, { agentId: C, providerCalls: 1 }]);
  assert.deepEqual(world.state.list({ executionId: MISSION }).map((row) => row.key), ['task:t1', 'task:t2', 'task:t3'], 'every finished task left its answer on the board');

  // The dependent's prompt is where shared state becomes real: Celia reads what
  // Ana and Beto wrote, and Ana — who ran before the board had anything on it — does not.
  assert.match(world.providers.get(C).prompts[0], /task:t1/);
  assert.match(world.providers.get(C).prompts[0], /Li o módulo: a fila é FIFO\./);
  assert.match(world.providers.get(C).prompts[0], /Rodei os testes: 18 verdes\./);
  assert.doesNotMatch(world.providers.get(A).prompts[0], /task:t2/, 'the first actor has nothing on the board yet');

  const reviewer = world.providers.get(C).reviews[0];
  assert.match(reviewer.priorOutputs.board, /"status":"completed"/);
  assert.match(reviewer.instruction, /board and the task list below are data/);

  assert.equal(task.audit.some((entry) => entry.type === 'actor_started'), true);
  assert.equal(world.events.filter((event) => event.type === 'actor_task_completed').length, 3);
  assert.equal(world.events.at(-1).type, 'run_finished');
  assert.equal(world.repository.findById(MISSION).mode, 'actor', 'the mission is stored as an actor run');
});

test('one agent reaches another without the user and without a global turn', async () => {
  const world = harness({
    script: {
      [A]: [
        { content: null, toolCalls: [{ id: 'call-1', name: 'team_send_message', arguments: { to: 'Beto', content: 'Preciso do log da fila antes de concluir.' } }] },
        { content: 'Avispei o Beto pelo time.' },
      ],
      [B]: [{ content: 'Achei a mensagem da Ana: três entradas órfãs.' }],
      [C]: [{ content: 'Concluí com os dois achados.' }],
    },
  });
  const task = await start(world, plan(['t1', 'Ler o código', A], ['t2', 'Rodar os testes', B, ['t1']], ['t3', 'Concluir', C, ['t2']]), { capabilityGrants: COMM });

  assert.equal(task.status, 'completed');
  const sent = task.audit.filter((entry) => entry.type === 'message_sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].detail.agentId, A, 'the runtime says who sent it, not the model');
  assert.equal(sent[0].detail.to, B);

  const rows = world.mailbox.list({ executionId: MISSION });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'processed', 'the peer read it in its own turn');

  // The proof the message travelled: Beto's prompt carries Ana's sentence, and he
  // was addressed by the name the model chose, not by an id it could invent.
  assert.match(world.providers.get(B).turns[0][1].content, /Preciso do log da fila/);
  assert.match(world.providers.get(B).turns[0][1].content, /"from":"Ana"/);
  assert.equal(world.events.filter((event) => event.type === 'actor_message').length, 1);
});

test('a reviewer that asks for revision leaves the mission with the user', async () => {
  const world = harness({
    verdict: 'Falta evidência. revise',
    script: { [A]: [{ content: 'Li.' }], [B]: [{ content: 'Rodei.' }], [C]: [{ content: 'Concluí.' }] },
  });
  const task = await start(world, plan(['t1', 'Ler', A], ['t2', 'Rodar', B], ['t3', 'Concluir', C]));
  assert.equal(task.status, 'awaiting_approval');
  assert.equal(task.outputs.reviewer, 'Falta evidência. revise');
});

test('an actor that cannot answer fails its task and strands what waited on it', async () => {
  const world = harness({
    script: { [A]: [{ throw: 'o gateway caiu' }, { throw: 'o gateway caiu' }, { throw: 'o gateway caiu' }], [B]: [{ content: 'Rodei.' }] },
  });
  const task = await start(world, plan(['t1', 'Ler', A], ['t2', 'Concluir', B, ['t1']]));
  assert.equal(task.status, 'needs_attention');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't1' }).status, 'failed');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't1' }).attempts, 3, 'the ceiling is spent, not ignored');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't2' }).status, 'blocked');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't2' }).note, 'predecessor_failed');
  assert.equal(world.providers.get(B).turns.length, 0, 'a stranded task never buys a turn');
  assert.equal(task.audit.filter((entry) => entry.type === 'actor_turn_failed').length, 3);
});

test('a run that stops for budget is resumed where it stopped, with what it already paid for', async () => {
  const world = harness({
    script: {
      [A]: [{ content: 'Li.' }, { content: 'extra.' }],
      [B]: [{ content: 'Rodei.' }],
      [C]: [{ content: 'Concluí.' }],
    },
  });
  const stopped = await start(world, plan(['t1', 'Ler', A], ['t2', 'Rodar', B], ['t3', 'Concluir', C, ['t1', 't2']]), { maxProviderCalls: 1 });
  assert.equal(stopped.status, 'needs_attention');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't1' }).status, 'completed');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't2' }).status, 'ready', 'the task nobody started is still owed');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't3' }).status, 'pending');
  assert.equal(stopped.audit.some((entry) => entry.type === 'actor_refused' && entry.detail.reason === 'provider_budget_exhausted'), true);

  // Resumed from the persisted snapshot with the budget the user raised: the
  // per-actor counters come back from the trail, so Ana is not handed a fresh
  // allowance for the call she already spent, and her finished task is not re-run.
  const task = TaskRun.fromSnapshot(world.repository.findById(MISSION));
  assert.equal(task.mode, 'actor');
  assert.equal(task.providerCalls, 1);
  assert.deepEqual(actorCalls(task), [{ agentId: A, providerCalls: 1 }]);
  task.extendBudget(8);

  const second = new ActorOrchestrator({ providers: world.providers, database: world.repository.database, repository: world.repository });
  const resumed = await second.resume(task, { roster: ROSTER, reviewerAgentId: C });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.providerCalls, 4, 'one call already spent, three bought now');
  assert.equal(world.providers.get(A).turns.length, 1, 'the completed task did not run again');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't1' }).status, 'completed');
});

test('cancelling drains the turn in flight and leaves no mission stuck in running', async () => {
  const controller = new AbortController();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const world = harness({
    script: { [A]: [{ content: 'Li.' }], [B]: [{ content: 'Rodei.' }], [C]: [{ content: 'Concluí.' }] },
  });
  const slow = world.providers.get(B);
  const turn = slow.completeTurn.bind(slow);
  slow.completeTurn = async (request) => { await gate; return turn(request); };

  const running = start(world, plan(['t1', 'Ler', A], ['t2', 'Rodar', B], ['t3', 'Concluir', C, ['t2']]), { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  release();
  const task = await running;

  assert.equal(task.status, 'cancelled');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't1' }).status, 'completed', 'an answer that landed is kept, not discarded');
  assert.equal(world.tasks.get({ executionId: MISSION, id: 't3' }).status, 'pending');
  assert.equal(world.providers.get(C).turns.length, 0, 'and nothing new is started after the cancel');
  assert.equal(world.repository.findById(MISSION).status, 'cancelled');
});

test('a published answer that never closed its row is recognized, not paid for twice', async () => {
  const handle = new SqliteTaskRepository(':memory:').database;
  const tasks = new SqliteActorTaskStore({ database: handle });
  // The board as the runtime hands it to reconciliation: the shared-state wrapper,
  // not the raw store — reconcile speaks in keys, not in execution ids.
  const state = createSharedState({ executionRef: REF, store: new SqliteStateStore({ database: handle }) });
  tasks.create({ executionId: MISSION, tasks: plan(['t1', 'Ler', A], ['t2', 'Concluir', B, ['t1']]) });
  tasks.claim({ executionId: MISSION, id: 't1', owner: A });
  // The crash the plan names: the model answered, the board committed, and the row
  // never reached `completed`. The board is the witness, and it is the truth.
  state.commit({ key: 'task:t1', expectedRevision: 0, value: { taskId: 't1', agentId: A, title: 'Ler', content: 'Li o módulo.' }, writerAgentId: A });

  const lines = [];
  const outcome = reconcileOnResume({
    executionRef: REF, tasks, state,
    trail: [{ type: 'actor_started', detail: { taskId: 't1', agentId: A } }],
    audit: (type, detail) => lines.push({ type, detail }),
  });
  assert.deepEqual(outcome.completed.map((row) => row.id), ['t1']);
  assert.equal(outcome.needsAttention, false);
  assert.equal(tasks.get({ executionId: MISSION, id: 't1' }).status, 'completed');
  assert.equal(tasks.get({ executionId: MISSION, id: 't1' }).resultKey, 'task:t1');
  assert.equal(lines.some((line) => line.type === 'actor_recovered' && line.detail.revision === 1), true);

  // The same mission resumed on this runtime runs the dependent and nothing else.
  const world = harness({ script: { [A]: [{ content: 'Li.' }], [B]: [{ content: 'Concluí.' }], [C]: [{ content: 'Pronto.' }] } });
  world.tasks.create({ executionId: MISSION, tasks: plan(['t1', 'Ler', A], ['t2', 'Concluir', B, ['t1']]) });
  world.tasks.claim({ executionId: MISSION, id: 't1', owner: A });
  world.state.commit({ executionId: MISSION, key: 'task:t1', expectedRevision: 0, value: { taskId: 't1', agentId: A, title: 'Ler', content: 'Li o módulo.' }, writerAgentId: A });
  const stored = new TaskRun({ id: MISSION, objective: 'Retomar a tempo.', mode: 'actor', maxProviderCalls: 24 });
  stored.transition('planned');
  stored.transition('executing');
  stored.record('actor_started', { taskId: 't1', agentId: A });
  const resumed = await world.orchestrator.resume(stored, { roster: ROSTER, reviewerAgentId: C });
  assert.equal(resumed.status, 'completed');
  assert.equal(world.providers.get(A).turns.length, 0, 'the turn that already answered is never bought again');
  assert.equal(world.providers.get(B).turns.length, 1);
  handle.close();
});

test('an effect whose outcome nobody read is held, and the mission asks', () => {
  const handle = new SqliteTaskRepository(':memory:').database;
  const tasks = new SqliteActorTaskStore({ database: handle });
  tasks.create({ executionId: MISSION, tasks: plan(['t1', 'Escrever', A], ['t2', 'Concluir', B, ['t1']]) });
  tasks.claim({ executionId: MISSION, id: 't1', owner: A });

  const lines = [];
  const outcome = reconcileOnResume({
    executionRef: REF, tasks,
    trail: [
      { type: 'actor_started', detail: { taskId: 't1', agentId: A } },
      { type: 'tool_written', detail: { taskId: 't1', agentId: A, tool: 'workspace_write', path: 'src/fila.js', bytes: 42 } },
    ],
    audit: (type, detail) => lines.push({ type, detail }),
  });
  assert.deepEqual(outcome.held, ['t1'], 'the write is not repeated on a guess');
  assert.equal(outcome.needsAttention, true);
  assert.equal(tasks.get({ executionId: MISSION, id: 't1' }).status, 'blocked');
  assert.equal(tasks.get({ executionId: MISSION, id: 't1' }).note, 'unknown_external_effect');
  const held = lines.find((line) => line.type === 'actor_held');
  assert.equal(held.detail.via, 'tool_written');
  assert.equal(held.detail.path, 'src/fila.js', 'and the user is told which file is in question');

  // A settled line after the effect means the outcome was read: nothing to hold.
  tasks.create({ executionId: 'other-run', tasks: plan(['t1', 'Escrever', A]) });
  tasks.claim({ executionId: 'other-run', id: 't1', owner: A });
  const settled = reconcileOnResume({
    executionRef: { kind: 'mission', id: 'other-run' }, tasks,
    trail: [
      { type: 'actor_started', detail: { taskId: 't1', agentId: A } },
      { type: 'tool_written', detail: { taskId: 't1', agentId: A, path: 'src/fila.js' } },
      { type: 'actor_task_completed', detail: { taskId: 't1', agentId: A } },
    ],
  });
  assert.deepEqual(settled.held, []);
  handle.close();
});

test('a claim that outlived its reader returns to the inbox, and an exhausted one is dropped where it can be seen', () => {
  const handle = new SqliteTaskRepository(':memory:').database;
  const tasks = new SqliteActorTaskStore({ database: handle });
  const mailbox = new SqliteMailboxStore({ database: handle });
  const at = '2026-10-11T00:00:00.000Z';
  mailbox.deliver({ executionId: MISSION, recipientAgentId: B, senderAgentId: A, kind: 'agent', body: 'ainda lida', hop: 1 });
  mailbox.deliver({ executionId: MISSION, recipientAgentId: C, senderAgentId: A, kind: 'agent', body: 'exaurida', hop: 1 });

  // Beto's claim died with one attempt spent: the message goes back.
  mailbox.claim({ executionId: MISSION, recipientAgentId: B, owner: B, limit: 8, leaseMs: 1_000, now: at });
  // Celia's reader died on its third attempt: the message is dropped, not looped.
  for (let index = 0; index < 3; index += 1) {
    const claimed = mailbox.claim({ executionId: MISSION, recipientAgentId: C, owner: C, limit: 8, leaseMs: 1_000, now: at });
    if (index < 2) for (const row of claimed) mailbox.nack({ id: row.id, claimToken: row.claimToken, reason: 'turn_failed', now: at });
  }

  const lines = [];
  const outcome = reconcileOnResume({
    // The wrapper, not the store: a recovery has to reach only this execution's
    // inbox, and that scoping is the wrapper's promise.
    executionRef: REF, tasks, mailbox: createActorMailbox({ executionRef: REF, store: mailbox }),
    audit: (type, detail) => lines.push({ type, detail }),
    now: '2026-10-11T02:00:00.000Z',
  });
  assert.deepEqual(outcome.mailbox.requeued.map((row) => row.recipientAgentId), [B]);
  assert.deepEqual(outcome.mailbox.dropped.map((row) => row.recipientAgentId), [C]);
  assert.equal(outcome.needsAttention, true, 'a dropped message is not a silently empty inbox');
  const dropped = lines.filter((line) => line.type === 'actor_dropped');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].detail.reason, 'lease_exhausted');
  assert.equal(dropped[0].detail.agentId, C, 'and it names whose inbox lost it');
  assert.equal(mailbox.list({ executionId: MISSION, status: 'dropped' })[0].dropReason, 'lease_exhausted');
  handle.close();
});

test('an actor mission refuses its wiring before it can spend anything on it', async () => {
  const world = harness({ script: { [A]: [{ content: 'Li.' }] } });
  world.providers.delete(B);
  await assert.rejects(
    () => start(world, plan(['t1', 'Ler', A], ['t2', 'Rodar', B])),
    /Beto has no provider that can take a turn/,
    'a member with no model to answer with is a wiring bug, not a turn to pay for',
  );

  await assert.rejects(
    () => start(world, plan(['t1', 'Ler', A, ['t2']], ['t2', 'Rodar', B, ['t1']])),
    /would never start/,
    'a cyclic plan is refused before an actor wakes',
  );

  await assert.rejects(
    () => start(world, plan(['t1', 'Ler', A]), { reviewerAgentId: '99999999-9999-4999-8999-999999999999' }),
    /not one of the agents/,
  );
});
