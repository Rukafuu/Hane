import assert from 'node:assert/strict';
import test from 'node:test';
import { createMissionServer } from '../src/server/mission-server.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { SqliteProviderConfigStore } from '../src/storage/sqlite-provider-config-store.js';
import { SqliteOnboardingStore } from '../src/storage/sqlite-onboarding-store.js';
import { SqliteSkillStore } from '../src/storage/sqlite-skill-store.js';
import { SqliteAgentStore } from '../src/storage/sqlite-agent-store.js';
import { SqliteTeamStore } from '../src/storage/sqlite-team-store.js';
import { createProviderFromConfig } from '../src/providers/provider-factory.js';

const ANA = '11111111-1111-4111-8111-111111111111';
const BETO = '22222222-2222-4222-8222-222222222222';
const CELIA = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const CREDENTIAL = 'local-agent-orchestrator/actor-test';
const SECRET = 'sk-test-valor';
const APPROVED = 'Revisão lida no quadro. approved';

const plan = (...tasks) => tasks.map(([id, title, assignee, dependsOn = []]) => ({ id, title, assigneeAgentId: assignee, dependsOn }));
const fence = (tasks) => '```hane-plan\n' + JSON.stringify(tasks) + '\n```';
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

/**
 * What each teammate answers, by model name. The queue is read again every time a
 * provider is built, which is how a test lets the first attempt fail and the retry
 * after it answer: the mission is resumed from what was persisted, and the script
 * is the only thing that changed.
 */
function createHarness({ scripts = {}, verdict = APPROVED, objective = 'Três agentes trabalharam o mesmo objetivo.' } = {}) {
  const database = openHaneDatabase(':memory:');
  const repository = new SqliteTaskRepository({ database });
  const providerConfigStore = new SqliteProviderConfigStore({ database });
  const agentStore = new SqliteAgentStore({ database });
  const teamStore = new SqliteTeamStore({ database });
  const credentialManager = {
    secrets: new Map([[CREDENTIAL, SECRET]]),
    async get(reference) { return this.secrets.get(reference) ?? null; },
    async set(reference, secret) { this.secrets.set(reference, secret); },
  };
  const log = [];

  class ScriptedProvider {
    constructor({ model }) {
      this.model = model;
      this.entry = scripts[model] ?? { turns: [] };
      this.queue = [...(this.entry.turns ?? [])];
    }
    async completeTurn({ messages }) {
      log.push({ kind: 'turn', model: this.model, messages });
      const next = this.queue.shift();
      if (next === undefined) throw new Error(`o roteiro de ${this.model} não tem turno`);
      const spec = typeof next === 'string' ? { content: next } : next;
      if (spec.wait !== undefined) await spec.wait;
      if (spec.throw !== undefined) throw new Error(spec.throw);
      return { content: spec.content ?? null, toolCalls: [], protocol: 'native' };
    }
    async complete(request) {
      log.push({ kind: 'review', model: this.model, ...request });
      return this.entry.verdict ?? verdict;
    }
  }

  for (const [label, model] of [['ana-p', 'model-ana'], ['beto-p', 'model-beto'], ['celia-p', 'model-celia']]) {
    providerConfigStore.upsert({ label, baseUrl: 'https://example.test/v1', model, credentialReference: CREDENTIAL });
  }
  for (const [id, name, providerLabel] of [[ANA, 'Ana', 'ana-p'], [BETO, 'Beto', 'beto-p'], [CELIA, 'Celia', 'celia-p']]) {
    agentStore.upsert({ id, name, providerLabel, instructions: `Conduza-se como ${name}.`, capabilities: [] });
  }
  teamStore.save({ id: TEAM, name: 'Equipe Alfa', description: 'Três agentes.', members: [ANA, BETO, CELIA], leaderAgentId: CELIA });

  const server = createMissionServer({
    repository,
    providerConfigStore,
    onboardingStore: new SqliteOnboardingStore({ database }),
    skillStore: new SqliteSkillStore({ database }),
    credentialManager,
    createProvider: (options) => createProviderFromConfig({ ...options, providerConstructor: ScriptedProvider }),
    defaultProvider: 'ana-p',
    agentStore,
    teamStore,
  });
  const baseUrlPromise = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });

  const baseUrl = () => baseUrlPromise;
  return {
    database, repository, scripts, log, agentStore, teamStore, baseUrl,
    mission: async (body) => {
      const response = await fetch(`${await baseUrl()}/api/missions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objective, ...body }),
      });
      return { status: response.status, body: await response.json() };
    },
    get: async (route) => {
      const response = await fetch(`${await baseUrl()}${route}`);
      return { status: response.status, body: await response.json() };
    },
    post: async (route, body) => {
      const response = await fetch(`${await baseUrl()}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      return { status: response.status, body: await response.json() };
    },
    until: async (route, status, { timeoutMs = 4000 } = {}) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await (await fetch(`${await baseUrl()}${route}`)).json();
        if (last.status === status) return last;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return last;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const actorBody = (tasks) => ({ teamId: TEAM, executionMode: 'actor', ...(tasks === undefined ? {} : { tasks }) });

test('POST with executionMode actor runs the booked plan and the windows read it back', async (t) => {
  const world = createHarness({
    scripts: {
      'model-ana': { turns: ['Li o módulo: a fila é FIFO.'] },
      'model-beto': { turns: ['Rodei os testes: 18 verdes.'] },
      'model-celia': { turns: ['Concluí: as duas leituras batem.'] },
    },
  });
  t.after(() => world.close());

  const queued = await world.mission(actorBody(plan(['t1', 'Ler o código', ANA], ['t2', 'Rodar os testes', BETO], ['t3', 'Concluir', CELIA, ['t1', 't2']])));
  assert.equal(queued.status, 202);
  assert.equal(queued.body.executionMode, 'actor');
  assert.equal(queued.body.teamId, TEAM);
  assert.equal(queued.body.maxProviderCallsPerActor, 6, 'the per-actor share is part of the answer');
  assert.deepEqual(queued.body.actors.map((actor) => actor.name), ['Ana', 'Beto', 'Celia']);
  assert.equal(JSON.stringify(queued.body).includes(SECRET), false);
  assert.equal(JSON.stringify(queued.body).includes('apiKey'), false);

  const mission = await world.until(`/api/missions/${queued.body.id}`, 'completed');
  assert.equal(mission.status, 'completed', 'the actor run reached a verdict');
  assert.equal(mission.mode, 'actor');
  assert.equal(mission.providerCalls, 4, 'three actors and one review');
  assert.equal(mission.outputs.reviewer, APPROVED);

  const actors = await world.get(`/api/missions/${queued.body.id}/actors`);
  assert.equal(actors.status, 200);
  assert.deepEqual(actors.body.counts, { total: 3, pending: 0, ready: 0, running: 0, completed: 3, failed: 0, blocked: 0 });
  assert.deepEqual(actors.body.actors.map((entry) => [entry.name, entry.tasks.length]), [['Ana', 1], ['Beto', 1], ['Celia', 1]]);

  const state = await world.get(`/api/missions/${queued.body.id}/state`);
  assert.deepEqual(state.body.revisionOf.map((entry) => [entry.key, entry.revision]), [['task:t1', 1], ['task:t2', 1], ['task:t3', 1]]);
  assert.equal(state.body.tasks.length, 3);

  const trail = await world.get(`/api/mission-events?missionId=${queued.body.id}&after=0`);
  assert.equal(trail.status, 200);
  const types = trail.body.events.map((event) => event.type);
  for (const expected of ['actor_started', 'actor_task_completed', 'actor_state_committed']) {
    assert.ok(types.includes(expected), `the persisted trail carries ${expected}`);
  }
  assert.deepEqual(trail.body.events.map((event) => event.ordinal), [...trail.body.events.keys()].map((index) => index + 1), 'the trail is one unbroken sequence');
  assert.equal(trail.body.latest, trail.body.events.at(-1).ordinal);

  const caught = await world.get(`/api/mission-events?missionId=${queued.body.id}&after=${trail.body.events[1].ordinal}`);
  assert.equal(caught.body.events[0].ordinal, trail.body.events[2].ordinal, 'after= picks up where the client stopped reading');
});

test('a message the user posts reaches the teammate on its next task', async (t) => {
  const gate = deferred();
  const world = createHarness({
    scripts: {
      'model-ana': { turns: [{ content: 'Primeira leitura sem o recado.', wait: gate.promise }, 'Segunda leitura: a fila é FIFO mesmo.'] },
      'model-beto': { turns: ['Nada bloqueia a fila.'] },
      'model-celia': { turns: ['Conferei as duas leituras.'] },
    },
  });
  t.after(() => { gate.resolve(); return world.close(); });

  const queued = await world.mission(actorBody(plan(
    ['t1', 'Ler', ANA],
    ['t2', 'Concluir a leitura', ANA],
    ['t3', 'Rodar', BETO, ['t2']],
  )));
  assert.equal(queued.status, 202);

  // Ana is inside her first turn; the post lands while she is working, so she
  // reads it in the next one — which is the drain policy, not a preemption.
  const posted = await world.post(`/api/missions/${queued.body.id}/mailbox`, { to: 'Ana', content: 'Confira a ordem da fila antes de responder.', priority: 'high' });
  assert.equal(posted.status, 202);
  assert.equal(posted.body.status, 'pending');
  gate.resolve();

  const mission = await world.until(`/api/missions/${queued.body.id}`, 'completed');
  assert.equal(mission.status, 'completed');

  const inbox = await world.get(`/api/missions/${queued.body.id}/mailbox?agentId=${ANA}`);
  assert.equal(inbox.body.messages.length, 1);
  assert.equal(inbox.body.messages[0].senderAgentId, 'user', 'the runtime knows this did not come from a teammate');
  assert.equal(inbox.body.messages[0].status, 'processed');

  const secondTurn = world.log.filter((entry) => entry.kind === 'turn' && entry.model === 'model-ana')[1];
  const prompt = JSON.stringify(secondTurn.messages);
  assert.match(prompt, /Confira a ordem da fila antes de responder\./);
  assert.match(prompt, /the user/, 'the message is labelled as the user’s, not as a peer’s');

  const trail = await world.get(`/api/mission-events?missionId=${queued.body.id}&after=0`);
  const postedRow = trail.body.events.find((event) => event.type === 'actor_message');
  assert.ok(postedRow, 'a message the user posted is in the catch-up trail, not only on the wire');
  assert.equal(postedRow.payload.fromAgentId, 'user');
  assert.equal(postedRow.actorId, 'user');
});

test('an authored plan that cannot run is refused before anybody is paid', async (t) => {
  const world = createHarness({ scripts: {} });
  t.after(() => world.close());

  const cyclic = await world.mission(actorBody(plan(['a', 'Um', ANA, ['b']], ['b', 'Dois', BETO, ['a']])));
  assert.equal(cyclic.status, 400);
  assert.match(cyclic.body.error, /depend on each other/);

  const phantom = await world.mission(actorBody(plan(['a', 'Um', ANA, ['z']])));
  assert.equal(phantom.status, 400);
  assert.match(phantom.body.error, /which this plan does not have/);

  const outsider = await world.mission({ teamId: TEAM, executionMode: 'actor', tasks: [{ id: 'a', title: 'Um', assigneeAgentId: '99999999-9999-4999-8999-999999999999', dependsOn: [] }] });
  assert.equal(outsider.status, 400);
  assert.match(outsider.body.error, /not in this execution/);

  assert.deepEqual(world.log, [], 'no provider call was spent on a plan that cannot run');
  assert.equal((await world.get('/api/missions')).body.missions.length, 0, 'a refused plan leaves no mission behind');
});

test('an actor mission says what it needs: a Team, a reviewer, and a share that fits', async (t) => {
  const world = createHarness({ scripts: {} });
  t.after(() => world.close());

  const noTeam = await world.mission({ executionMode: 'actor' });
  assert.equal(noTeam.status, 400);
  assert.match(noTeam.body.error, /teamId is required/);

  const stranger = await world.mission({ ...actorBody(plan(['a', 'Um', ANA])), reviewerAgentId: BETO, planAgentId: '00000000-0000-4000-8000-000000000000' });
  assert.equal(stranger.status, 400);
  assert.match(stranger.body.error, /planAgentId must be a member/);

  const oversized = await world.mission({ ...actorBody(plan(['a', 'Um', ANA])), maxProviderCalls: 4, maxProviderCallsPerActor: 6 });
  assert.equal(oversized.status, 400);
  assert.match(oversized.body.error, /cannot exceed/);

  const roles = await world.mission({ teamId: TEAM, executionMode: 'actor', roleAssignments: { planner: ANA, executor: BETO, reviewer: CELIA } });
  assert.equal(roles.status, 400);
  assert.match(roles.body.error, /roleAssignments belong to the sequential preset/);

  const unknownProvider = await world.mission({ ...actorBody(plan(['a', 'Um', ANA])), provider: 'sem-cadastro' });
  assert.equal(unknownProvider.status, 404);

  assert.deepEqual(world.log, []);
});

test('a leader writes the plan when nobody authored one, and a bad plan asks the user', async (t) => {
  const generated = [
    { id: 'g1', title: 'Ler o código', assignee: 'Ana', dependsOn: [] },
    { id: 'g2', title: 'Rodar os testes', assignee: 'Beto', dependsOn: [] },
  ];
  const world = createHarness({
    scripts: {
      'model-ana': { turns: ['Li.'] },
      'model-beto': { turns: ['Rodei.'] },
      'model-celia': { turns: [fence(generated)] },
    },
  });
  t.after(() => world.close());

  const queued = await world.mission(actorBody());
  assert.equal(queued.status, 202);
  const mission = await world.until(`/api/missions/${queued.body.id}`, 'completed');
  assert.equal(mission.status, 'completed', 'the generated plan runs like an authored one');
  assert.ok(mission.audit.some((entry) => entry.type === 'actor_planned' && entry.detail.agentId === CELIA), 'the leader is named as the author');
  const state = await world.get(`/api/missions/${queued.body.id}/state`);
  assert.deepEqual(state.body.tasks.map((task) => task.id), ['g1', 'g2']);
  assert.match(JSON.stringify(world.log.filter((entry) => entry.kind === 'turn')[0].messages), /assign to one of|Never invent a teammate/, 'the prompt shows the roster it may use');

  const stuck = createHarness({
    scripts: {
      'model-ana': { turns: [] },
      'model-beto': { turns: [] },
      'model-celia': { turns: [fence([{ id: 'g1', title: 'Ler', assignee: 'Zed', dependsOn: [] }]) , fence([{ id: 'g1', title: 'Ler', assignee: 'Zed', dependsOn: [] }])] },
    },
  });
  t.after(() => stuck.close());
  const second = await stuck.mission(actorBody());
  assert.equal(second.status, 202);
  const attention = await stuck.until(`/api/missions/${second.body.id}`, 'needs_attention');
  assert.equal(attention.status, 'needs_attention', 'a plan nobody can run asks the user instead of looping');
  const refusal = attention.audit.find((entry) => entry.type === 'actor_plan_unusable');
  assert.equal(refusal.detail.reason, 'invalid_plan');
  assert.match(refusal.detail.detail, /is not a teammate/);
  assert.equal(attention.audit.filter((entry) => entry.type === 'actor_plan_repair_requested').length, 1, 'one repair, then the user');
});

test('retry resumes an actor mission with the reviewer it was booked with', async (t) => {
  const world = createHarness({
    scripts: {
      'model-ana': { turns: ['Li o módulo: a fila é FIFO.', 'Reli: continua FIFO.'] },
      'model-beto': { turns: ['Rodei os testes.', 'Rodei de novo: verdes.'] },
      'model-celia': { turns: ['Concluí a síntese.'] },
    },
  });
  t.after(() => world.close());

  const queued = await world.mission({ ...actorBody(plan(['t1', 'Ler', ANA], ['t2', 'Rodar', BETO], ['t3', 'Concluir', CELIA, ['t1', 't2']])), maxProviderCalls: 2, maxProviderCallsPerActor: 2 });
  assert.equal(queued.status, 202);
  const stalled = await world.until(`/api/missions/${queued.body.id}`, 'needs_attention');
  assert.equal(stalled.status, 'needs_attention');
  assert.equal(stalled.mode, 'actor');
  assert.equal(stalled.providerCalls, 2, 'the stopped mission keeps what it spent');
  const booked = stalled.audit.filter((entry) => entry.type === 'actor_reviewer_bound');
  assert.deepEqual(booked.map((entry) => entry.detail.reviewerAgentId), [CELIA]);

  const resumed = await world.post(`/api/missions/${queued.body.id}/retry`, { maxProviderCalls: 12 });
  assert.equal(resumed.status, 202);
  assert.equal(resumed.body.executionMode, 'actor');
  assert.equal(resumed.body.maxProviderCalls, 12);

  const done = await world.until(`/api/missions/${queued.body.id}`, 'completed');
  assert.equal(done.status, 'completed');
  assert.equal(done.providerCalls, 4, 'two before the stop, two after it — nothing was re-paid');
  const rebound = done.audit.filter((entry) => entry.type === 'actor_reviewer_bound');
  assert.equal(rebound.length, 2);
  assert.equal(rebound[1].detail.reviewerAgentId, CELIA, 'the resume reviews with the same teammate, not whoever leads now');
  assert.deepEqual(done.audit.filter((entry) => entry.type === 'actor_reconciled').length, 1);

  // The reconciliation is written where it happened: the ledger's audit trail. The
  // event bus carries what ran under somebody's hands, so a client must not be
  // taught to read a resume as if it were live work.
  const types = (await world.get(`/api/mission-events?missionId=${queued.body.id}&after=0`)).body.events.map((event) => event.type);
  assert.ok(types.includes('actor_started'), 'the run itself is on the trail');
  assert.equal(types.includes('actor_reconciled'), false);
});

test('the actor windows refuse what is not an actor mission, and the sequential flow is untouched', async (t) => {
  const world = createHarness({ scripts: { 'model-ana': { turns: [] } } });
  t.after(() => world.close());

  const sequential = await world.mission({ objective: 'Missão sequencial padrão.' });
  assert.equal(sequential.status, 202);
  assert.equal(sequential.body.executionMode, 'sequential');
  const finished = await world.until(`/api/missions/${sequential.body.id}`, 'completed');
  assert.equal(finished.status, 'completed');
  assert.equal(finished.mode, 'sequential', 'a mission that names no mode still runs the preset flow');

  for (const route of ['mailbox', 'state', 'actors']) {
    const refusal = await world.get(`/api/missions/${sequential.body.id}/${route}`);
    assert.equal(refusal.status, 409, `${route} says a sequential run has no actor windows`);
  }
  const postbox = await world.post(`/api/missions/${sequential.body.id}/mailbox`, { to: 'Ana', content: 'Oi.' });
  assert.equal(postbox.status, 409);

  const missing = await world.get(`/api/missions/${sequential.body.id}/mailbox?agentId=${ANA}`);
  assert.equal(missing.status, 409);

  const unknown = await world.get(`/api/missions/55555555-5555-4555-8555-555555555555/actors`);
  assert.equal(unknown.status, 404);
  const badOrdinal = await world.get(`/api/mission-events?missionId=${sequential.body.id}&after=-2`);
  assert.equal(badOrdinal.status, 400);
  const noMission = await world.get('/api/mission-events');
  assert.equal(noMission.status, 400);
});

test('a finished mission refuses a new message instead of storing one nobody reads', async (t) => {
  const world = createHarness({
    scripts: { 'model-ana': { turns: ['Li.'] }, 'model-beto': { turns: [] }, 'model-celia': { turns: [] } },
  });
  t.after(() => world.close());

  const queued = await world.mission(actorBody(plan(['t1', 'Ler', ANA])));
  const done = await world.until(`/api/missions/${queued.body.id}`, 'completed');
  assert.equal(done.status, 'completed');

  const tooLate = await world.post(`/api/missions/${queued.body.id}/mailbox`, { to: 'Ana', content: 'Muda o rumo.' });
  assert.equal(tooLate.status, 409);
  assert.match(tooLate.body.error, /no one left to read/);
  assert.equal((await world.get(`/api/missions/${queued.body.id}/mailbox`)).body.messages.length, 0);
});

test('the mailbox route validates what the user sends', async (t) => {
  const gate = deferred();
  const world = createHarness({
    scripts: { 'model-ana': { turns: [{ content: 'Trabalhando.', wait: gate.promise }] }, 'model-beto': { turns: [] }, 'model-celia': { turns: [] } },
  });
  t.after(() => { gate.resolve(); return world.close(); });

  const queued = await world.mission(actorBody(plan(['t1', 'Ler', ANA])));
  const id = queued.body.id;

  const stranger = await world.post(`/api/missions/${id}/mailbox`, { to: 'Beto', content: 'Você não está nesta missão.' });
  assert.equal(stranger.status, 400);
  assert.match(stranger.body.error, /does not work this mission/);

  const empty = await world.post(`/api/missions/${id}/mailbox`, { to: 'Ana', content: '   ' });
  assert.equal(empty.status, 400);

  const loud = await world.post(`/api/missions/${id}/mailbox`, { to: 'Ana', content: 'x'.repeat(16_001) });
  assert.equal(loud.status, 400);

  const priority = await world.post(`/api/missions/${id}/mailbox`, { to: 'Ana', content: 'Urgente.', priority: 'urgente' });
  assert.equal(priority.status, 400);

  const secrets = await world.post(`/api/missions/${id}/mailbox`, { to: 'Ana', content: 'Oi.', apiKey: 'não' });
  assert.equal(secrets.status, 400, 'a body carrying a credential key is refused, as everywhere else');

  const badJson = await fetch(`${await world.baseUrl()}/api/missions/${id}/mailbox`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(badJson.status, 400);

  const ok = await world.post(`/api/missions/${id}/mailbox`, { to: 'ana', content: 'Chegou.' });
  assert.equal(ok.status, 202, 'a recipient named by its lowercase name resolves to the one assignee that owns it');
  gate.resolve();
  assert.equal((await world.until(`/api/missions/${id}`, 'completed')).status, 'completed');
});

test('SSE carries the actor events alongside the shapes clients already read', async (t) => {
  const world = createHarness({
    scripts: {
      'model-ana': { turns: ['Li.'] },
      'model-beto': { turns: ['Rodei.'] },
      'model-celia': { turns: ['Concluí.'] },
    },
  });
  let reader = null;
  let pumping = null;
  t.after(async () => {
    reader?.cancel().catch(() => {});
    await pumping;
    await world.close();
  });
  const baseUrl = await world.baseUrl();

  const stream = await fetch(`${baseUrl}/api/events`);
  reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  pumping = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
      }
    } catch { /* cancelled */ }
  })();

  const queued = await world.mission(actorBody(plan(['t1', 'Ler', ANA], ['t2', 'Rodar', BETO], ['t3', 'Concluir', CELIA, ['t1', 't2']])));
  const deadline = Date.now() + 4000;
  while (!buffer.includes('"type":"run_finished"') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const seen = buffer.split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)));
  for (const type of ['actor_started', 'actor_task_completed', 'actor_state_committed', 'run_finished']) {
    assert.ok(seen.some((event) => event.type === type), `the live stream carried ${type}`);
  }
  const started = seen.find((event) => event.type === 'actor_started');
  assert.equal(started.missionId, queued.body.id);
  assert.equal(typeof started.ordinal, 'number', 'a live event carries the trail position it was written at');
  const finished = seen.at(-1);
  assert.equal(finished.task.mode, 'actor');
});
