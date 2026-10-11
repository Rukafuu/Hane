import assert from 'node:assert/strict';
import test from 'node:test';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteMailboxStore } from '../src/storage/sqlite-mailbox-store.js';
import { SqliteStateStore } from '../src/storage/sqlite-state-store.js';
import { SqliteMissionEventStore } from '../src/storage/sqlite-mission-events.js';
import { CAPABILITY, assertCapabilityGrants, assertEnforceableScopes, parseGrantScope, peerAllowedBy } from '../src/capabilities.js';
import { availableToolNames, toolFor, toolSchemas } from '../src/tools/registry.js';
import { createToolRouter } from '../src/tools/router.js';
import { createWorkspaceDirSandbox } from '../src/sandbox/workspace-dir.js';
import { assertAgent } from '../src/teams/agent.js';
import { TaskRun } from '../src/task-run.js';
import { createEventBus } from '../src/actors/bus.js';
import { createActorMailbox } from '../src/actors/mailbox.js';
import { createSharedState } from '../src/actors/state.js';
import { createMessagingGateway } from '../src/actors/gateway.js';
import { runActorTurn } from '../src/actors/agent-loop.js';
import { ACTOR_LIMITS } from '../src/actors/limits.js';
import { auditToolOutcome } from '../src/orchestrator/tool-loop.js';

const MISSION = 'mission-actors';
const REF = { kind: 'mission', id: MISSION };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const OUTSIDER = '44444444-4444-4444-8444-444444444444';
const D = '55555555-5555-4555-8555-555555555555';
const E = '66666666-6666-4666-8666-666666666666';
const ROSTER = Object.freeze([{ agentId: A, name: 'Ana' }, { agentId: B, name: 'Beto' }, { agentId: C, name: 'Celia' }]);
const WIDE = Object.freeze([...ROSTER, { agentId: D, name: 'Dara' }, { agentId: E, name: 'Elio' }]);
const COMM = Object.freeze([{ name: CAPABILITY.TEAM_COMMUNICATE, scope: 'all' }]);

function fixture({ grants = COMM, roster = ROSTER, limits, perActor = ACTOR_LIMITS.providerCallsPerActor, maxProviderCalls = 24 } = {}) {
  const database = openHaneDatabase(':memory:');
  const events = new SqliteMissionEventStore({ database });
  const store = new SqliteMailboxStore({ database });
  const trail = [];
  const bus = createEventBus({ events, executionRef: REF });
  bus.subscribe((event) => trail.push(event));
  const mailbox = createActorMailbox({ executionRef: REF, store, bus, ...(limits === undefined ? {} : { limits }) });
  const task = new TaskRun({ id: MISSION, objective: 'Levar o time adiante.', mode: 'actor', maxProviderCalls, maxProviderCallsPerActor: perActor, capabilityGrants: grants });
  const auditLog = [];
  const audit = (type, detail) => { auditLog.push({ type, detail }); task.record(type, detail); };
  const state = createSharedState({ executionRef: REF, store: new SqliteStateStore({ database }), bus, audit });
  const gatewayFor = (agentId, peerGrants = grants, peerRoster = roster) => createMessagingGateway({
    executionRef: REF, mailbox, roster: peerRoster, senderAgentId: agentId, grants: peerGrants, ...(limits === undefined ? {} : { limits }),
  });
  const routerFor = (agentId, peerGrants = grants, peerRoster = roster) => createToolRouter({ sandbox: gatewayFor(agentId, peerGrants, peerRoster).sandbox, grants: peerGrants });
  // A router and the turn it serves must share one gateway: that gateway holds
  // the hop and the turn token, so two instances would test a wiring nobody builds.
  const pairedFor = (agentId, peerGrants = grants, peerRoster = roster) => {
    const gateway = gatewayFor(agentId, peerGrants, peerRoster);
    return { gateway, router: createToolRouter({ sandbox: gateway.sandbox, grants: peerGrants }) };
  };
  return { database, events, bus, store, mailbox, state, task, audit, auditLog, trail, gatewayFor, routerFor, pairedFor };
}

class TurnProvider {
  constructor(turns = []) { this.script = [...turns]; this.seen = []; }
  async completeTurn({ messages, tools }) {
    this.seen.push({ messages: structuredClone(messages), tools });
    const next = this.script.shift();
    if (!next) return { content: null, toolCalls: [], protocol: 'native' };
    return { content: next.content ?? null, toolCalls: next.toolCalls ?? [], protocol: next.protocol ?? 'native' };
  }
}

const call = (name, args, id = 'call-1') => ({ id, name, arguments: args, source: 'native', raw: JSON.stringify(args) });

test('a team grant means exactly the peers the grammar says it means', () => {
  assert.deepEqual(parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, 'all').parsed, [{ all: true, agentIds: [] }]);
  assert.equal(parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, B).parsed[0].all, false);
  assert.deepEqual(parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, `${A},${B}`).parsed[0].agentIds, [A, B]);

  for (const bad of ['quem quiser', 'ana', '*', `${A}, all`, 'not-a-uuid']) {
    assert.equal(parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, bad).ok, false, `"${bad}" authorizes nothing the gateway can check`);
  }
  const ninePeers = Array.from({ length: 9 }, (_, index) => `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`);
  const tooMany = parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, ninePeers.join(','));
  assert.equal(tooMany.ok, false, 'a list longer than the biggest team is a typo, not a reach');
  assert.match(tooMany.reason, /at most 8/);
  const repeated = parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, [A, B, C, A].join(','));
  assert.equal(repeated.ok, true, 'a repeated id is still inside the cap');
  assert.equal(peerAllowedBy(repeated.parsed, OUTSIDER).ok, false, 'and it still reaches only the ids named');
  assert.throws(() => assertEnforceableScopes(assertCapabilityGrants([{ name: CAPABILITY.TEAM_COMMUNICATE, scope: 'todo o time' }])), /teammate id/);

  const some = parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, A).parsed;
  assert.equal(peerAllowedBy(some, A).ok, true);
  assert.equal(peerAllowedBy(some, B).reason, 'peer_not_granted');
  assert.equal(peerAllowedBy(parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, 'all').parsed, C).ok, true);
  assert.equal(peerAllowedBy([], A).reason, 'peer_not_granted', 'no grant reaches nobody');
});

test('the messaging tool is invisible to a backend that cannot carry the verb', () => {
  const tool = toolFor('team_send_message');
  assert.equal(tool.capability, CAPABILITY.TEAM_COMMUNICATE);
  assert.equal(tool.verb, 'message');
  assert.deepEqual(availableToolNames(COMM), ['team_send_message']);
  assert.equal(toolSchemas(['team_send_message'])[0].function.parameters.required.join(','), 'to,content');

  // A directory sandbox has no `message` verb, so a sequential mission is never
  // offered a channel it would only be refused at.
  const directory = createWorkspaceDirSandbox({ root: process.cwd(), grants: COMM });
  assert.equal(directory.executable.includes('message'), false);
  assert.deepEqual(createToolRouter({ sandbox: directory, grants: COMM }).names, []);
});

test('a profile may hold five capabilities and no more', () => {
  const base = { id: A, name: 'Ana', capabilities: [CAPABILITY.WORKSPACE_READ, CAPABILITY.WORKSPACE_WRITE, CAPABILITY.PROCESS_RUN, CAPABILITY.NETWORK_REQUEST, CAPABILITY.TEAM_COMMUNICATE] };
  assert.equal(assertAgent(base).capabilities.length, 5);
  assert.throws(() => assertAgent({ ...base, capabilities: [...base.capabilities, 'made.up'] }), /Invalid agent capabilities/);
});

test('an event is in the trail before anyone is told about it', () => {
  const { database, events, bus } = fixture();
  const seen = [];
  bus.subscribe(() => seen.push(events.since({ executionId: MISSION, after: 0 }).map((event) => event.type)));
  const stored = bus.emit({ type: 'actor_started', actorId: A, data: { taskId: 't1' } });
  assert.deepEqual(seen, [['actor_started']], 'a subscriber must never lead the store');
  assert.equal(stored.ordinal, 1);
  assert.equal(stored.payload.taskId, 't1');

  // A snapshot is a live shape the trail cannot hold, so the caller says so.
  bus.emit({ type: 'tool_audited', actorId: A, data: { path: 'src/a.js' }, uiEvent: { type: 'tool_audited', task: { id: MISSION } } });
  assert.deepEqual(events.since({ executionId: MISSION, after: 0 }).map((event) => event.type), ['actor_started', 'tool_audited']);
  assert.equal(events.since({ executionId: MISSION, after: 0 })[1].payload.path, 'src/a.js');
  assert.equal(events.latest({ executionId: MISSION }), 2);
  database.close();
});

test('a delivered message publishes once and a duplicate publishes nothing', () => {
  const { store, mailbox, trail } = fixture();
  const first = mailbox.send({ fromAgentId: A, toAgentId: B, body: 'achei o bug' });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  const again = mailbox.send({ fromAgentId: A, toAgentId: B, body: 'outro texto', dedupeKey: 'k-1' });
  const retried = mailbox.send({ fromAgentId: A, toAgentId: B, body: 'outro texto', dedupeKey: 'k-1' });
  assert.equal(retried.duplicate, true);
  assert.equal(retried.message.id, again.message.id);
  assert.equal(trail.filter((event) => event.type === 'actor_message').length, 2, 'the duplicate announced nothing new');
  assert.equal(store.list({ executionId: MISSION }).length, 2, 'and it landed once');
});

test('a reply chain stops at the hop limit before it is stored', () => {
  const { store, mailbox, trail } = fixture();
  const refused = mailbox.send({ fromAgentId: A, toAgentId: B, body: 'e depois?', hop: ACTOR_LIMITS.maxHop + 1 });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'hop_limit_exceeded');
  assert.deepEqual(store.list({ executionId: MISSION }), []);
  assert.deepEqual(trail, [], 'a refusal is not an event about a message');
});

test('one teammate may not wear another down', () => {
  const { mailbox } = fixture();
  for (let index = 0; index < ACTOR_LIMITS.messagesPerPair; index += 1) {
    assert.equal(mailbox.send({ fromAgentId: A, toAgentId: B, body: `mensagem ${index}` }).ok, true);
  }
  const fifth = mailbox.send({ fromAgentId: A, toAgentId: B, body: 'mais uma' });
  assert.equal(fifth.ok, false);
  assert.equal(fifth.reason, 'pair_limit_exceeded');
});

test('an agent that has taken in twelve messages stops receiving', () => {
  const { mailbox } = fixture({ roster: WIDE });
  // Four senders, three each: the per-pair cap would stop the drain at four, so
  // this is the one shape that actually reaches the inbound cap.
  const senders = [A, C, D, E];
  for (let index = 0; index < ACTOR_LIMITS.messagesProcessedPerActor; index += 1) {
    const delivered = mailbox.send({ fromAgentId: senders[index % 4], toAgentId: B, body: `parte ${index}` });
    assert.equal(delivered.ok, true);
    const claimed = mailbox.claim({ agentId: B, owner: B });
    assert.equal(claimed.length, 1);
    assert.equal(mailbox.ack({ id: claimed[0].id, claimToken: claimed[0].claimToken }), true);
  }
  const refused = mailbox.send({ fromAgentId: C, toAgentId: B, body: 'e agora?' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'actor_inbound_limit_exceeded');
  // The limit bounds one agent, not the group.
  assert.equal(mailbox.send({ fromAgentId: B, toAgentId: A, body: 'oi' }).ok, true);
});

test('the sender is the actor, never whatever the model typed', async () => {
  const { store, mailbox, pairedFor } = fixture();
  const { gateway, router } = pairedFor(A);
  gateway.beginTurn({ hop: 0, token: 'turn-1' });
  const outcome = await router.execute(call('team_send_message', {
    to: B, content: 'preciso do log', fromAgentId: C, senderAgentId: C, executionId: 'outra-missao',
  }));
  assert.equal(outcome.ok, true);
  const row = store.list({ executionId: MISSION })[0];
  assert.equal(row.senderAgentId, A, 'the bound actor spoke, not the id the model invented');
  assert.equal(row.recipientAgentId, B);
  assert.equal(row.hop, 1);
  assert.equal(mailbox.peek(B).pending, 1);
});

test('a peer the execution does not have is refused, stored nowhere and audited once', async () => {
  const { store, mailbox, audit, auditLog } = fixture();
  const gateway = createMessagingGateway({ executionRef: REF, mailbox, roster: ROSTER, senderAgentId: A, grants: COMM });
  const router = createToolRouter({ sandbox: gateway.sandbox, grants: COMM });
  const outcome = await router.execute(call('team_send_message', { to: OUTSIDER, content: 'oi' }));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'recipient_not_in_execution');
  assert.deepEqual(store.list({ executionId: MISSION }), [], 'a refusal never becomes a row');
  assert.deepEqual(auditLog, [], 'the router and the gateway stay silent; the turn loop records');

  const lines = [];
  auditToolOutcome({ audit: (type, detail) => lines.push({ type, detail }), role: 'actor', roleTag: {}, agentId: A, call: {}, outcome });
  assert.equal(lines[0].type, 'message_refused');
  assert.equal(lines[0].detail.reason, 'recipient_not_in_execution');
  assert.equal(lines[0].detail.agentId, A);
  assert.equal(mailbox.peek(OUTSIDER).pending, 0);
});

test('a name two teammates share is refused rather than guessed', async () => {
  const twins = [{ agentId: A, name: 'Ana' }, { agentId: B, name: 'Ana' }, { agentId: C, name: 'Celia' }];
  const { store, pairedFor } = fixture({ roster: twins });
  const { router } = pairedFor(C, COMM, twins);
  const outcome = await router.execute(call('team_send_message', { to: 'ana', content: 'oi' }));
  assert.equal(outcome.reason, 'recipient_ambiguous');
  assert.deepEqual(store.list({ executionId: MISSION }), []);
});

test('a grant that names ids authorizes only those ids', async () => {
  const only = [{ name: CAPABILITY.TEAM_COMMUNICATE, scope: B }];
  const { store, routerFor } = fixture({ grants: only });
  assert.equal((await routerFor(A, only).execute(call('team_send_message', { to: B, content: 'ok' }))).ok, true);
  const refused = await routerFor(A, only).execute(call('team_send_message', { to: C, content: 'oi' }));
  assert.equal(refused.reason, 'peer_not_granted');
  assert.equal(store.list({ executionId: MISSION, agentId: C }).length, 0);
});

test('a membership revoked mid-inference cannot still send', async () => {
  const { store, mailbox, events } = fixture();
  const roster = [...ROSTER];
  const gateway = createMessagingGateway({ executionRef: REF, mailbox, roster: () => roster, senderAgentId: A, grants: COMM });
  const router = createToolRouter({ sandbox: gateway.sandbox, grants: COMM });
  assert.equal((await router.execute(call('team_send_message', { to: B, content: 'antes' }))).ok, true);
  roster.shift();
  const outcome = await router.execute(call('team_send_message', { to: B, content: 'depois' }));
  assert.equal(outcome.reason, 'sender_not_in_execution');
  assert.equal(store.list({ executionId: MISSION }).length, 1);
  assert.equal(events.since({ executionId: MISSION, after: 0 }).length, 1);
});

test('a turn re-run over the same inbox does not deliver the same sentence twice', async () => {
  const { store, mailbox, events } = fixture();
  const gateway = createMessagingGateway({ executionRef: REF, mailbox, roster: ROSTER, senderAgentId: A, grants: COMM });
  const router = createToolRouter({ sandbox: gateway.sandbox, grants: COMM });
  gateway.beginTurn({ hop: 0, token: 'turn-stable' });
  const first = await router.execute(call('team_send_message', { to: B, content: 'mesma frase' }));
  const replay = await router.execute(call('team_send_message', { to: B, content: 'mesma frase' }));
  const different = await router.execute(call('team_send_message', { to: B, content: 'outra frase' }));
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true, 'the same turn saying it twice is one delivery');
  assert.equal(replay.messageId, first.messageId);
  assert.equal(different.duplicate, false);
  assert.equal(store.list({ executionId: MISSION }).length, 2);
  assert.equal(events.since({ executionId: MISSION, after: 0 }).length, 2);
});

test('a losing writer sees what it would have overwritten, and an artifact is booked once', () => {
  const { state, auditLog, trail, database } = fixture();
  assert.deepEqual(state.read('plano'), { revision: 0, value: null });
  const won = state.commit({ key: 'plano', expectedRevision: 0, value: { passo: 1 }, writerAgentId: A });
  assert.equal(won.ok, true);
  const lost = state.commit({ key: 'plano', expectedRevision: 0, value: { passo: 99 }, writerAgentId: B });
  assert.equal(lost.conflict, true);
  assert.deepEqual(lost.current.value, { passo: 1 });
  assert.equal(auditLog.at(-1).type, 'state_conflict');
  assert.equal(auditLog.at(-1).detail.agentId, B);
  assert.deepEqual(trail.filter((event) => event.type === 'actor_state_committed').map((event) => event.revision), [1]);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM task_state_revisions').get().count, 1);

  const artifact = state.putArtifact({ agentId: A, kind: 'file', path: 'notes.md', bytes: 12, sha256: 'a'.repeat(64), effectKey: 'e-1' });
  const replay = state.putArtifact({ agentId: A, kind: 'file', path: 'notes.md', bytes: 12, sha256: 'a'.repeat(64), effectKey: 'e-1' });
  assert.equal(artifact.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(trail.filter((event) => event.type === 'actor_artifact_created').length, 1);
});

test('an actor turn reads its inbox and confirms it', async () => {
  const { store, mailbox, task } = fixture();
  mailbox.send({ fromAgentId: B, toAgentId: A, body: 'o teste falha na linha 12' });
  const provider = new TurnProvider([{ content: 'visto: linha 12' }]);
  const result = await runActorTurn({
    agent: { agentId: A, name: 'Ana' }, provider, mailbox, ledger: task,
    instruction: 'Você é Ana.', objective: 'Consertar o teste.',
  });
  assert.equal(result.content, 'visto: linha 12');
  assert.equal(store.list({ executionId: MISSION, status: 'processed' }).length, 1);
  assert.equal(mailbox.peek(A).pending, 0);
  assert.match(JSON.stringify(provider.seen[0].messages), /linha 12/, 'the peer message reached the model');
  assert.equal(provider.seen[0].tools, null, 'an agent with no router is offered no tools');
  assert.equal(task.providerCalls, 1);
});

test('a provider that throws hands the messages back under the same id', async () => {
  const { store, mailbox, task, audit, auditLog } = fixture();
  const sent = mailbox.send({ fromAgentId: B, toAgentId: A, body: 'descobri isto' });
  const provider = { async completeTurn() { throw new Error('o gateway caiu'); } };
  await assert.rejects(() => runActorTurn({
    agent: { agentId: A }, provider, mailbox, ledger: task, audit, instruction: 'x', objective: 'y',
  }), /gateway caiu/);
  const waiting = store.byId(sent.message.id);
  assert.equal(waiting.status, 'pending', 'a message that never reached a finished turn is not consumed');
  assert.equal(waiting.attempts, 1, 'the attempt is counted, but the row keeps its identity');
  assert.equal(auditLog.at(-1).type, 'actor_turn_failed');

  const again = mailbox.claim({ agentId: A, owner: A });
  assert.deepEqual(again.map((message) => message.id), [sent.message.id], 'the same message, not a copy');
  assert.equal(again[0].attempts, 2);
  assert.equal(mailbox.ack({ id: again[0].id, claimToken: 'token-de-um-turno-morto' }), false, 'a late ack from the crashed turn confirms nothing');
  assert.equal(mailbox.ack({ id: again[0].id, claimToken: again[0].claimToken }), true);
  assert.equal(store.byId(sent.message.id).status, 'processed');
});

test('an actor out of its own calls leaves the inbox untouched', async () => {
  const { mailbox, store, task } = fixture({ perActor: 1 });
  mailbox.send({ fromAgentId: B, toAgentId: A, body: 'urgente' });
  task.reserveProviderCall('actor', A);
  const provider = new TurnProvider([{ content: 'não deveria rodar' }]);
  const result = await runActorTurn({ agent: { agentId: A }, provider, mailbox, ledger: task, instruction: 'x', objective: 'y' });
  assert.equal(result.ok, false);
  assert.equal(result.spentTurn, false);
  assert.deepEqual(provider.seen, [], 'the refusal came before any request');
  assert.equal(mailbox.peek(A).pending, 1);
  assert.equal(store.list({ executionId: MISSION, status: 'pending' })[0].body, 'urgente');
  assert.equal(task.audit.at(-1).type, 'actor_budget_exhausted');
});

test('a message sent from a tool call lands in the peer inbox, on the bus and in the audit', async () => {
  const { mailbox, store, trail, task, pairedFor } = fixture();
  const { gateway, router } = pairedFor(A);
  const provider = new TurnProvider([
    { content: '', toolCalls: [call('team_send_message', { to: 'Beto', content: 'preciso do log' })] },
    { content: 'perguntei ao Beto' },
  ]);
  const result = await runActorTurn({
    agent: { agentId: A, name: 'Ana' },
    provider,
    router,
    gateway,
    mailbox,
    ledger: task,
    audit: (type, detail) => task.record(type, detail),
    instruction: 'Você é Ana.',
    objective: 'Dividir o trabalho.',
    peers: [{ id: B, name: 'Beto' }],
  });
  assert.equal(result.content, 'perguntei ao Beto');
  const row = store.list({ executionId: MISSION })[0];
  assert.equal(row.senderAgentId, A);
  assert.equal(row.recipientAgentId, B);
  const message = trail.find((event) => event.type === 'actor_message');
  assert.equal(message.body, 'preciso do log');
  assert.equal(task.audit.some((entry) => entry.type === 'message_sent'), true);
  assert.equal(mailbox.peek(B).pending, 1, 'the peer sees it on its own next turn');
  // The model reads the receipt back, not a bare "ok".
  const receipt = JSON.parse(provider.seen[1].messages.find((entry) => entry.role === 'tool').content);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.messageId, row.id, 'the sender is told which message arrived');
  assert.equal(receipt.to, B);
  assert.equal(receipt.toName, 'Beto');
  assert.equal(receipt.hop, 1);
  assert.equal(receipt.duplicate, false);
});

test('six calls is one actor share while the mission ceiling still rules', () => {
  const task = new TaskRun({ id: 'budget', objective: 'Três agentes.', mode: 'actor', maxProviderCalls: 24, maxProviderCallsPerActor: 6 });
  for (let index = 0; index < 6; index += 1) assert.equal(task.reserveProviderCall('actor', A), true);
  assert.equal(task.reserveProviderCall('actor', A), false, 'one actor cannot take a seventh');
  assert.equal(task.reserveProviderCall('actor', B), true, 'the others still have their own share');
  assert.equal(task.providerCalls, 7);

  const shared = new TaskRun({ id: 'ceiling', objective: 'Três agentes.', mode: 'actor', maxProviderCalls: 2, maxProviderCallsPerActor: 6 });
  assert.equal(shared.reserveProviderCall('actor', A), true);
  assert.equal(shared.reserveProviderCall('actor', B), true);
  assert.equal(shared.reserveProviderCall('actor', C), false, 'the mission ceiling is the real budget');
  assert.equal(shared.audit.at(-1).type, 'budget_exhausted');
  assert.throws(() => shared.reserveProviderCall('ghost'), /Unknown role: ghost/, 'a sequential typo still fails loudly');
});

test('a resumed actor mission does not get a fresh allowance', () => {
  const task = new TaskRun({ id: 'resumed', objective: 'Continuar.', mode: 'actor', maxProviderCalls: 24, maxProviderCallsPerActor: 6 });
  task.reserveProviderCall('actor', A);
  task.reserveProviderCall('actor', A);
  task.reserveProviderCall('actor', B);
  const snapshot = task.snapshot();
  assert.equal(snapshot.mode, 'actor');
  assert.deepEqual(snapshot.actors, [{ agentId: A, providerCalls: 2 }, { agentId: B, providerCalls: 1 }]);

  const rebuilt = TaskRun.fromSnapshot(snapshot);
  assert.equal(rebuilt.mode, 'actor');
  assert.equal(rebuilt.reserveProviderCall('actor', A), true);
  for (let index = 0; index < 3; index += 1) rebuilt.reserveProviderCall('actor', A);
  assert.equal(rebuilt.reserveProviderCall('actor', A), false, 'four more spent the remaining share, not a new six');

  // A mission read back from SQLite carries the audit trail and no `actors` field.
  const { actors: dropped, ...fromRows } = snapshot;
  assert.ok(dropped);
  const fromTrail = TaskRun.fromSnapshot(fromRows);
  assert.deepEqual(fromTrail.actorCalls(), [{ agentId: A, providerCalls: 2 }, { agentId: B, providerCalls: 1 }]);

  const sequential = TaskRun.fromSnapshot({ ...snapshot, mode: 'sequential' });
  assert.equal(sequential.mode, 'sequential');
});

test('a mission that never mentioned a mode is still a sequential mission', () => {
  const task = new TaskRun({ id: 'plain', objective: 'Uma vez, três papéis.' });
  assert.equal(task.mode, 'sequential');
  assert.equal(task.snapshot().mode, 'sequential');
  assert.deepEqual(task.snapshot().actors, []);
  assert.throws(() => new TaskRun({ id: 'x', objective: 'y', mode: ' swarm' }), /mode must be one of/);
});
