import assert from 'node:assert/strict';
import test from 'node:test';
import { Orchestrator } from '../src/orchestrator.js';
import { TaskRun } from '../src/task-run.js';

const APPROVING_REVIEWER = 'Plan and result verified.\nverdict: approved';

class FakeProvider {
  constructor({ reviewerOutput } = {}) {
    this.requests = [];
    this.reviewerOutput = reviewerOutput ?? APPROVING_REVIEWER;
  }
  async complete(request) {
    this.requests.push(request);
    if (request.role === 'reviewer') return this.reviewerOutput;
    return `${request.role} output`;
  }
}

class RoleFailingProvider {
  constructor({ failRole }) {
    this.failRole = failRole;
    this.requests = [];
  }
  async complete(request) {
    this.requests.push(request);
    if (request.role === this.failRole) throw new Error(`${request.role} blew up`);
    if (request.role === 'reviewer') return APPROVING_REVIEWER;
    return `${request.role} output`;
  }
}

test('completes a bounded planner-executor-reviewer run with an audit trail', async () => {
  const provider = new FakeProvider();
  const orchestrator = new Orchestrator({ provider, idFactory: () => 'run-1' });
  const task = await orchestrator.start({ objective: 'Draft a migration plan.' });

  assert.equal(task.status, 'completed');
  assert.equal(task.providerCalls, 3);
  assert.deepEqual(Object.keys(task.outputs), ['planner', 'executor', 'reviewer']);
  assert.deepEqual(provider.requests.map((request) => request.role), ['planner', 'executor', 'reviewer']);
  assert.equal(task.audit.filter((entry) => entry.type === 'provider_call_reserved').length, 3);
  assert.ok(task.audit.some((entry) => entry.type === 'verdict_parsed' && entry.detail.verdict === 'approved'));
});

test('stops before an unbudgeted provider request and asks for attention', async () => {
  const provider = new FakeProvider();
  const orchestrator = new Orchestrator({ provider, idFactory: () => 'run-2' });
  const task = await orchestrator.start({ objective: 'Inspect this task.', maxProviderCalls: 2 });

  assert.equal(task.status, 'needs_attention');
  assert.equal(task.providerCalls, 2);
  assert.deepEqual(provider.requests.map((request) => request.role), ['planner', 'executor']);
  assert.ok(task.audit.some((entry) => entry.type === 'budget_exhausted'));
});

test('a revise verdict parks the task in awaiting_approval', async () => {
  const provider = new FakeProvider({ reviewerOutput: 'The result contradicts the plan.\nverdict: revise' });
  const orchestrator = new Orchestrator({ provider, idFactory: () => 'run-revise' });
  const task = await orchestrator.start({ objective: 'Review this work.' });

  assert.equal(task.status, 'awaiting_approval');
  assert.equal(task.providerCalls, 3);
  assert.ok(task.audit.some((entry) => entry.type === 'verdict_parsed' && entry.detail.verdict === 'revise'));
});

test('an unparseable reviewer verdict asks for attention instead of completing', async () => {
  const provider = new FakeProvider({ reviewerOutput: 'Looks fine overall.' });
  const orchestrator = new Orchestrator({ provider, idFactory: () => 'run-unparsed' });
  const task = await orchestrator.start({ objective: 'Review this work.' });

  assert.equal(task.status, 'needs_attention');
  assert.ok(task.audit.some((entry) => entry.type === 'verdict_unparsed'));
});

test('a budget-stopped task resumes after extending the budget, skipping saved roles', async () => {
  const orchestrator = new Orchestrator({ provider: new FakeProvider(), idFactory: () => 'run-budget-resume' });
  const stopped = await orchestrator.start({ objective: 'Finish the review.', maxProviderCalls: 2 });
  assert.equal(stopped.status, 'needs_attention');
  assert.deepEqual(Object.keys(stopped.outputs), ['planner', 'executor']);

  const restored = TaskRun.fromSnapshot(stopped.snapshot());
  restored.extendBudget(3);

  const secondProvider = new FakeProvider();
  const resumed = await new Orchestrator({ provider: secondProvider }).resume(restored);

  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.providerCalls, 3);
  assert.deepEqual(secondProvider.requests.map((request) => request.role), ['reviewer']);
  assert.ok(resumed.audit.some((entry) => entry.type === 'budget_extended'));
});

test('a failed task resumes re-running only the failed role onward', async () => {
  const orchestrator = new Orchestrator({ provider: new RoleFailingProvider({ failRole: 'executor' }), idFactory: () => 'run-failed-resume' });
  const failed = await orchestrator.start({ objective: 'Retry the middle step.', maxProviderCalls: 4 });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(Object.keys(failed.outputs), ['planner']);
  assert.ok(failed.audit.some((entry) => entry.type === 'provider_call_failed' && entry.detail.role === 'executor'));

  const secondProvider = new FakeProvider();
  const resumed = await new Orchestrator({ provider: secondProvider }).resume(TaskRun.fromSnapshot(failed.snapshot()));

  assert.equal(resumed.status, 'completed');
  assert.deepEqual(secondProvider.requests.map((request) => request.role), ['executor', 'reviewer']);
  assert.equal(resumed.providerCalls, 4);
  assert.equal(resumed.audit.filter((entry) => entry.type === 'provider_call_reserved').length, 4);
});

test('approving a parked task re-runs executor and reviewer and settles the new verdict', async () => {
  const orchestrator = new Orchestrator({ provider: new FakeProvider({ reviewerOutput: 'Still weak.\nverdict: revise' }), idFactory: () => 'run-approve' });
  const parked = await orchestrator.start({ objective: 'Improve the result.', maxProviderCalls: 3 });
  assert.equal(parked.status, 'awaiting_approval');

  delete parked.outputs.executor;
  delete parked.outputs.reviewer;
  parked.extendBudget(parked.providerCalls + 2);

  const secondProvider = new FakeProvider({ reviewerOutput: 'Much better now.\nverdict: approved' });
  const resumed = await new Orchestrator({ provider: secondProvider }).resume(parked);

  assert.equal(resumed.status, 'completed');
  assert.deepEqual(secondProvider.requests.map((request) => request.role), ['executor', 'reviewer']);
  assert.equal(resumed.outputs.reviewer, 'Much better now.\nverdict: approved');
  assert.equal(resumed.providerCalls, 5);
});

test('emits lifecycle events after every role and at the end of the run', async () => {
  const provider = new FakeProvider();
  const events = [];
  const orchestrator = new Orchestrator({ provider, idFactory: () => 'run-events' });
  const task = await orchestrator.start({ objective: 'Emit lifecycle events.', onEvent: (event) => events.push(event) });

  assert.deepEqual(events.map((event) => event.type), ['role_saved', 'role_saved', 'role_saved', 'run_finished']);
  assert.deepEqual(events.slice(0, 3).map((event) => event.role), ['planner', 'executor', 'reviewer']);
  assert.equal(events[0].task.status, 'planned');
  assert.equal(events[0].task.providerCalls, 1);
  assert.equal(events.at(-1).task.status, task.status);
  assert.ok(Object.isFrozen(events[0].task));
});

test('emits a budget event and stops when the budget runs out mid-run', async () => {
  const provider = new FakeProvider();
  const events = [];
  const orchestrator = new Orchestrator({ provider, idFactory: () => 'run-budget-events' });
  await orchestrator.start({ objective: 'Exhaust the budget.', maxProviderCalls: 2, onEvent: (event) => events.push(event) });

  assert.deepEqual(events.map((event) => event.type), ['role_saved', 'role_saved', 'role_skipped_budget', 'run_finished']);
  assert.equal(events[2].role, 'reviewer');
  assert.equal(events[2].task.status, 'needs_attention');
});

test('audits transport retries without spending mission budget', async () => {
  class RetryingProvider extends FakeProvider {
    async complete(request) {
      if (request.role === 'planner') request.onRetry({ attempt: 1, maxAttempts: 3, delayMs: 500, reason: 'http_429' });
      return super.complete(request);
    }
  }
  const orchestrator = new Orchestrator({ provider: new RetryingProvider(), idFactory: () => 'run-retry-audit' });
  const task = await orchestrator.start({ objective: 'Survive a flaky gateway.' });

  assert.equal(task.status, 'completed');
  assert.equal(task.providerCalls, 3);
  const retries = task.audit.filter((entry) => entry.type === 'provider_retry');
  assert.deepEqual(retries.map((entry) => entry.detail), [{ role: 'planner', attempt: 1, maxAttempts: 3, delayMs: 500, reason: 'http_429' }]);
});
