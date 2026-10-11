import assert from 'node:assert/strict';
import test from 'node:test';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteMailboxStore, MAX_DELIVERY_ATTEMPTS } from '../src/storage/sqlite-mailbox-store.js';
import { SqliteStateStore } from '../src/storage/sqlite-state-store.js';
import { SqliteMissionEventStore } from '../src/storage/sqlite-mission-events.js';

const MISSION = 'mission-1';
const EXEC = { executionId: MISSION };
const digest = 'a'.repeat(64);

const mailboxFixture = () => {
  const database = openHaneDatabase(':memory:');
  return { database, mailbox: new SqliteMailboxStore({ database }) };
};
const send = (mailbox, from, to, body = 'olá', extra = {}) => mailbox.deliver({ ...EXEC, recipientAgentId: to, senderAgentId: from, kind: 'peer', body, ...extra });

test('an execution recorded before the actor mode existed still reads as sequential', () => {
  const database = openHaneDatabase(':memory:');
  database.prepare('INSERT INTO task_runs (id, objective, status, max_provider_calls, provider_calls) VALUES (?, ?, ?, ?, ?)')
    .run('legacy-mission', 'Keep working as before.', 'completed', 3, 3);

  assert.equal(database.prepare('SELECT mode FROM task_runs WHERE id = ?').get('legacy-mission').mode, 'sequential');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name IN (?,?,?,?)').get('table', 'actor_mailbox', 'mission_events', 'actor_tasks', 'artifacts').count, 4);
  database.close();
});

test('a directed message waits in one agent inbox and nowhere else', () => {
  const { mailbox, database } = mailboxFixture();
  const delivered = send(mailbox, 'agent-a', 'agent-b');

  assert.equal(delivered.ok, true);
  assert.equal(delivered.duplicate, false);
  assert.equal(delivered.message.status, 'pending');
  assert.equal(delivered.message.hop, 0);
  assert.deepEqual(mailbox.peek({ ...EXEC, recipientAgentId: 'agent-b' }), { pending: 1, high: 0, oldestQueuedAt: delivered.message.createdAt });
  assert.equal(mailbox.peek({ ...EXEC, recipientAgentId: 'agent-a' }).pending, 0);
  assert.equal(mailbox.list({ ...EXEC }).length, 1);
  database.close();
});

test('a message to itself, an empty body and a bogus hop are refused before they are stored', () => {
  const { mailbox, database } = mailboxFixture();

  assert.throws(() => send(mailbox, 'agent-a', 'agent-a'), /cannot message itself/);
  assert.throws(() => send(mailbox, 'agent-a', 'agent-b', '   '), /body must be a non-empty string/);
  assert.throws(() => send(mailbox, 'agent-a', 'agent-b', 'oi', { hop: -1 }), /non-negative integer/);
  assert.throws(() => send(mailbox, 'agent-a', 'agent-b', 'oi', { priority: 'urgent' }), /priority must be one of/);
  assert.equal(mailbox.list({ ...EXEC }).length, 0);
  database.close();
});

test('the same dedupe key lands once, so a retried send does not double the work', () => {
  const { mailbox, database } = mailboxFixture();
  const first = send(mailbox, 'agent-a', 'agent-b', 'retry me', { dedupeKey: 'tool-call-1' });
  const second = send(mailbox, 'agent-a', 'agent-b', 'retry me', { dedupeKey: 'tool-call-1' });

  assert.equal(second.duplicate, true);
  assert.equal(second.message.id, first.message.id);
  assert.equal(mailbox.countBetween({ ...EXEC, fromAgentId: 'agent-a', toAgentId: 'agent-b' }), 1);
  database.close();
});

test('a claim reserves messages for exactly one holder, priority first', () => {
  const { mailbox, database } = mailboxFixture();
  const normal = send(mailbox, 'agent-a', 'agent-b', 'first in line');
  const later = send(mailbox, 'agent-a', 'agent-b', 'second in line');
  const urgent = send(mailbox, 'agent-a', 'agent-b', 'user said stop', { priority: 'high', senderAgentId: 'agent-c' });

  const claimed = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', limit: 2, owner: 'loop-1' });
  assert.deepEqual(claimed.map((message) => message.id), [urgent.message.id, normal.message.id]);
  assert.equal(claimed[0].status, 'processing');
  assert.equal(claimed[0].attempts, 1);
  assert.ok(claimed[0].claimToken);
  assert.ok(claimed[0].leaseExpiresAt > claimed[0].createdAt);
  // The third message is still pending, but it is not handed to a second claim
  // that would read the ones already under lease.
  assert.deepEqual(mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-2' }).map((m) => m.id), [later.message.id]);
  assert.equal(mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-3' }).length, 0);
  assert.equal(mailbox.peek({ ...EXEC, recipientAgentId: 'agent-b' }).pending, 0);
  database.close();
});

test('ack only accepts the token that owns the reservation', () => {
  const { mailbox, database } = mailboxFixture();
  const { message } = send(mailbox, 'agent-a', 'agent-b');
  const claim = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-1' })[0];

  assert.equal(mailbox.ack({ id: message.id, claimToken: claim.claimToken.replace(/./g, '0') }), false);
  assert.equal(mailbox.byId(message.id).status, 'processing');
  assert.equal(mailbox.ack({ id: message.id, claimToken: claim.claimToken }), true);
  assert.equal(mailbox.byId(message.id).status, 'processed');
  assert.ok(mailbox.byId(message.id).processedAt);
  // A processed message is never claimed or acked a second time.
  assert.equal(mailbox.ack({ id: message.id, claimToken: claim.claimToken }), false);
  assert.equal(mailbox.countProcessed({ ...EXEC, recipientAgentId: 'agent-b' }), 1);
  database.close();
});

test('a released claim keeps the message id and invalidates the dead token', () => {
  const { mailbox, database } = mailboxFixture();
  const { message } = send(mailbox, 'agent-a', 'agent-b');
  const first = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-1' })[0];

  assert.deepEqual(mailbox.nack({ id: message.id, claimToken: first.claimToken, reason: 'provider_failed' }), { ok: true, status: 'pending' });
  assert.equal(mailbox.ack({ id: message.id, claimToken: first.claimToken }), false);
  const second = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-2' })[0];
  assert.equal(second.id, message.id);
  assert.equal(second.attempts, 2);
  assert.notEqual(second.claimToken, first.claimToken);
  database.close();
});

test('attempts run out and the message stays visible as dropped', () => {
  const { mailbox, database } = mailboxFixture();
  const { message } = send(mailbox, 'agent-a', 'agent-b');
  let claim = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-1' })[0];
  for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    mailbox.nack({ id: message.id, claimToken: claim.claimToken, reason: 'crashed' });
    claim = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: `loop-${attempt + 1}` })[0];
  }

  assert.equal(claim.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.deepEqual(mailbox.nack({ id: message.id, claimToken: claim.claimToken, reason: 'gave_up' }), { ok: true, status: 'dropped' });
  const dropped = mailbox.list({ ...EXEC, status: 'dropped' });
  assert.deepEqual(dropped.map((row) => row.dropReason), ['gave_up']);
  assert.equal(mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-9' }).length, 0);
  database.close();
});

test('an expired lease is requeued, and a dead claim cannot confirm afterwards', () => {
  const { mailbox, database } = mailboxFixture();
  const { message } = send(mailbox, 'agent-a', 'agent-b');
  const claim = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-1', leaseMs: 1_000 })[0];

  const recovered = mailbox.recoverExpiredLeases({ now: new Date(Date.parse(claim.leaseExpiresAt) + 1).toISOString() });
  assert.deepEqual(recovered.requeued.map((row) => row.id), [message.id]);
  assert.equal(recovered.requeued[0].recipientAgentId, 'agent-b');
  assert.deepEqual(recovered.dropped, []);
  assert.equal(mailbox.byId(message.id).status, 'pending');
  assert.equal(mailbox.ack({ id: message.id, claimToken: claim.claimToken }), false);

  // Same shape at the attempt ceiling: it drops instead of cycling forever.
  const doomed = send(mailbox, 'agent-c', 'agent-d');
  let token = null;
  for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    token = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-d', owner: 'loop-1', leaseMs: 1_000 })[0].claimToken;
    mailbox.nack({ id: doomed.message.id, claimToken: token, reason: 'crashed' });
  }
  token = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-d', owner: 'loop-final', leaseMs: 1_000 })[0].claimToken;
  assert.equal(mailbox.byId(doomed.message.id).attempts, MAX_DELIVERY_ATTEMPTS);
  const expired = new Date(Date.parse(mailbox.byId(doomed.message.id).leaseExpiresAt) + 1).toISOString();
  assert.equal(mailbox.recoverExpiredLeases({ now: expired }).dropped.length, 1);
  assert.equal(mailbox.byId(doomed.message.id).status, 'dropped');
  assert.equal(mailbox.byId(doomed.message.id).dropReason, 'lease_exhausted');
  assert.equal(mailbox.ack({ id: doomed.message.id, claimToken: token }), false);
  database.close();
});

test('a live lease and another execution are left alone by recovery', () => {
  const { mailbox, database } = mailboxFixture();
  send(mailbox, 'agent-a', 'agent-b');
  const claim = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-1', leaseMs: 60_000 })[0];
  const elsewhere = send(mailbox, 'agent-a', 'agent-c', 'other execution', { executionId: 'mission-2' });
  const otherAgent = send(mailbox, 'agent-a', 'agent-d', 'not mine yet');

  const outcome = mailbox.recoverExpiredLeases({ executionId: MISSION, now: new Date(Date.parse(claim.createdAt) + 1_000).toISOString() });
  assert.deepEqual(outcome, { requeued: [], dropped: [] });
  assert.equal(mailbox.byId(claim.id).status, 'processing');
  assert.equal(mailbox.byId(elsewhere.message.id).status, 'pending');
  assert.equal(mailbox.byId(otherAgent.message.id).status, 'pending');
  database.close();
});

test('the pair and inbound counters count what was delivered', () => {
  const { mailbox, database } = mailboxFixture();
  send(mailbox, 'agent-a', 'agent-b', 'one');
  send(mailbox, 'agent-a', 'agent-b', 'two');
  send(mailbox, 'agent-b', 'agent-a', 'back at you');
  const claim = mailbox.claim({ ...EXEC, recipientAgentId: 'agent-b', owner: 'loop-1' });
  claim.forEach((message) => mailbox.ack({ id: message.id, claimToken: message.claimToken }));

  assert.equal(mailbox.countBetween({ ...EXEC, fromAgentId: 'agent-a', toAgentId: 'agent-b' }), 2);
  assert.equal(mailbox.countBetween({ ...EXEC, fromAgentId: 'agent-b', toAgentId: 'agent-a' }), 1);
  assert.equal(mailbox.countProcessed({ ...EXEC, recipientAgentId: 'agent-b' }), 2);
  assert.equal(mailbox.countProcessed({ ...EXEC, recipientAgentId: 'agent-a' }), 0);
  database.close();
});

test('an unseen key reads as revision zero, which is what a first writer expects', () => {
  const database = openHaneDatabase(':memory:');
  const state = new SqliteStateStore({ database });

  assert.deepEqual(state.read({ ...EXEC, key: 'plan' }), { revision: 0, value: null });
  assert.deepEqual(state.commit({ ...EXEC, key: 'plan', expectedRevision: 0, value: { steps: 3 }, writerAgentId: 'agent-a' }), { ok: true, revision: 1 });
  const written = state.read({ ...EXEC, key: 'plan' });
  assert.deepEqual({ revision: written.revision, value: written.value, writerAgentId: written.writerAgentId }, { revision: 1, value: { steps: 3 }, writerAgentId: 'agent-a' });
  assert.ok(written.createdAt);
  database.close();
});

test('a stale write conflicts and stores nothing', () => {
  const database = openHaneDatabase(':memory:');
  const state = new SqliteStateStore({ database });
  state.commit({ ...EXEC, key: 'finding', expectedRevision: 0, value: 'first', writerAgentId: 'agent-a' });

  const conflict = state.commit({ ...EXEC, key: 'finding', expectedRevision: 0, value: 'second', writerAgentId: 'agent-b' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.deepEqual(conflict.current, { revision: 1, value: 'first' });
  assert.equal(state.read({ ...EXEC, key: 'finding' }).revision, 1);
  assert.equal(state.history({ ...EXEC, key: 'finding' }).length, 1);

  const retry = state.commit({ ...EXEC, key: 'finding', expectedRevision: 1, value: 'second, with the first read', writerAgentId: 'agent-b' });
  assert.deepEqual(retry, { ok: true, revision: 2 });
  assert.deepEqual(state.history({ ...EXEC, key: 'finding' }).map((entry) => [entry.revision, entry.writerAgentId]), [[2, 'agent-b'], [1, 'agent-a']]);
  assert.equal(state.readRevision({ ...EXEC, key: 'finding', revision: 1 }).value, 'first');
  assert.deepEqual(state.list({ ...EXEC }).map((entry) => [entry.key, entry.revision]), [['finding', 2]]);
  database.close();
});

test('a bad key, value or revision is refused rather than half-stored', () => {
  const database = openHaneDatabase(':memory:');
  const state = new SqliteStateStore({ database });

  assert.throws(() => state.commit({ ...EXEC, key: 'two\nlines', expectedRevision: 0, value: 1 }), /single-line string/);
  assert.throws(() => state.commit({ ...EXEC, key: 'ok', expectedRevision: 0, value: undefined }), /must not be undefined/);
  assert.throws(() => state.commit({ ...EXEC, key: 'ok', expectedRevision: -1, value: 1 }), /non-negative integer/);
  const circular = {};
  circular.self = circular;
  assert.throws(() => state.commit({ ...EXEC, key: 'ok', expectedRevision: 0, value: circular }), /JSON-serializable/);
  assert.deepEqual(state.list({ ...EXEC }), []);
  database.close();
});

test('an artifact is booked once per effect, so a retried claim does not double it', () => {
  const database = openHaneDatabase(':memory:');
  const state = new SqliteStateStore({ database });
  const first = state.putArtifact({ ...EXEC, agentId: 'agent-a', kind: 'file', path: 'src/app.js', bytes: 12, sha256: digest, taskId: 'task-1', effectKey: 'tool-write-1' });

  assert.equal(first.duplicate, false);
  assert.equal(first.artifact.path, 'src/app.js');
  const again = state.putArtifact({ ...EXEC, agentId: 'agent-a', kind: 'file', path: 'src/app.js', bytes: 12, sha256: digest, taskId: 'task-1', effectKey: 'tool-write-1' });
  assert.equal(again.duplicate, true);
  assert.equal(again.artifact.id, first.artifact.id);
  assert.equal(state.listArtifacts({ ...EXEC }).length, 1);
  assert.equal(state.listArtifacts({ ...EXEC, agentId: 'agent-a' }).length, 1);
  assert.equal(state.listArtifacts({ ...EXEC, agentId: 'agent-b' }).length, 0);

  assert.throws(() => state.putArtifact({ ...EXEC, agentId: 'agent-a', kind: 'file', path: 'x', bytes: 1, sha256: 'nope', effectKey: null }), /64 hexadecimal/);
  assert.throws(() => state.putArtifact({ ...EXEC, agentId: 'agent-a', kind: 'file', path: 'x', bytes: -1, sha256: digest, effectKey: null }), /non-negative integer/);
  database.close();
});

test('the event trail is one ordered sequence an agent can catch up on', () => {
  const database = openHaneDatabase(':memory:');
  const events = new SqliteMissionEventStore({ database });
  const started = events.append({ ...EXEC, type: 'task.started', teamId: 'team-1', actorId: 'agent-a', payload: { objective: 'ship it' } });
  const messaged = events.append({ ...EXEC, type: 'actor.message', actorId: 'agent-b', payload: { to: 'agent-c' } });

  assert.ok(messaged.ordinal > started.ordinal);
  assert.equal(started.executionKind, 'mission');
  assert.equal(started.executionId, MISSION);
  assert.equal(started.teamId, 'team-1');
  assert.equal(started.actorId, 'agent-a');
  assert.deepEqual(started.payload, { objective: 'ship it' });
  assert.deepEqual(events.since({ ...EXEC, after: started.ordinal }).map((event) => event.type), ['actor.message']);
  assert.equal(events.latest({ ...EXEC }), messaged.ordinal);
  assert.equal(events.since({ ...EXEC, after: 0, limit: 1 }).length, 1);

  // A conversation may one day publish here; nothing in the trail assumes task_runs.
  const conversed = events.append({ executionId: 'conversation-1', executionKind: 'conversation', type: 'agent.message', payload: null });
  assert.ok(conversed.ordinal > messaged.ordinal);
  assert.equal(conversed.payload, null);
  assert.equal(events.latest({ ...EXEC }), messaged.ordinal);
  database.close();
});

test('an event with no subject, a prose type or a circular payload is refused', () => {
  const database = openHaneDatabase(':memory:');
  const events = new SqliteMissionEventStore({ database });

  assert.throws(() => events.append({ executionId: '', type: 'task.started' }), /executionId must be a non-empty string/);
  assert.throws(() => events.append({ ...EXEC, type: 'task.started\ninjected' }), /single-line string/);
  assert.throws(() => events.append({ ...EXEC, type: 'x'.repeat(65) }), /single-line string/);
  assert.throws(() => events.append({ ...EXEC, type: 'task.started', executionKind: 'job' }), /executionKind must be one of/);
  assert.throws(() => events.append({ ...EXEC, type: 'task.started', actorId: 'has\nnewline' }), /actorId must be a single-line string/);
  const circular = {};
  circular.self = circular;
  assert.throws(() => events.append({ ...EXEC, type: 'task.started', payload: circular }), /JSON-serializable/);
  assert.equal(events.latest({ ...EXEC }), 0);
  database.close();
});
