import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarStateFromMission, avatarStateFromRuntimeEvent } from '../work/mission-ui-prototype/src/avatar-runtime.js';

test('avatar state follows persisted mission evidence', () => {
  assert.equal(avatarStateFromMission({ mission: null, role: 'planner' }), 'idle');
  assert.equal(avatarStateFromMission({ mission: { status: 'executing', outputs: {} }, role: 'executor', currentRole: 'executor' }), 'working');
  assert.equal(avatarStateFromMission({ mission: { status: 'completed', outputs: { planner: 'ok' } }, role: 'planner' }), 'done');
  assert.equal(avatarStateFromMission({ mission: { status: 'needs_attention', outputs: {} }, role: 'reviewer' }), 'blocked');
  assert.equal(avatarStateFromMission({ mission: { status: 'failed', outputs: {}, audit: [{ type: 'provider_call_failed', detail: { role: 'planner' } }] }, role: 'planner' }), 'error');
});

test('future runtime event mapping is explicit and non-invented', () => {
  assert.equal(avatarStateFromRuntimeEvent({ type: 'agent.thinking' }), 'thinking');
  assert.equal(avatarStateFromRuntimeEvent({ type: 'unrecognized' }), null);
});
