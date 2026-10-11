import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarStateFromMission, avatarStateFromActorEvent } from '../work/mission-ui-prototype/src/avatar-runtime.js';

test('avatar state follows persisted mission evidence', () => {
  assert.equal(avatarStateFromMission({ mission: null, role: 'planner' }), 'idle');
  assert.equal(avatarStateFromMission({ mission: { status: 'executing', outputs: {} }, role: 'executor', currentRole: 'executor' }), 'working');
  assert.equal(avatarStateFromMission({ mission: { status: 'completed', outputs: { planner: 'ok' } }, role: 'planner' }), 'done');
  assert.equal(avatarStateFromMission({ mission: { status: 'needs_attention', outputs: {} }, role: 'reviewer' }), 'blocked');
  assert.equal(avatarStateFromMission({ mission: { status: 'failed', outputs: {}, audit: [{ type: 'provider_call_failed', detail: { role: 'planner' } }] }, role: 'planner' }), 'error');
});

test("runtime events are the server's own names, and an unknown one invents nothing", () => {
  // The adapter once held a reserved `agent.*` vocabulary that no producer ever
  // published. It is gone: an avatar moves on an event the actor runtime writes
  // (`src/actors/bus.js`), and a name the server does not emit maps to null.
  assert.equal(avatarStateFromActorEvent({ type: 'actor_started', actorId: 'agent-1' }), 'working');
  assert.equal(avatarStateFromActorEvent({ type: 'actor_message', actorId: 'agent-1' }), 'thinking');
  assert.equal(avatarStateFromActorEvent({ type: 'unrecognized', actorId: 'agent-1' }), null);
  assert.equal(avatarStateFromActorEvent({ type: 'actor_thinking' }), null);
});
