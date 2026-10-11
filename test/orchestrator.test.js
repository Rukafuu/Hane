import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('cancels an in-flight role without fabricating an output', async () => {
  class BlockingProvider {
    async complete({ signal }) {
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      return 'unreachable';
    }
  }
  const controller = new AbortController();
  const orchestrator = new Orchestrator({ provider: new BlockingProvider(), idFactory: () => 'run-cancelled' });
  const pending = orchestrator.start({ objective: 'Cancel this safely.', signal: controller.signal });
  controller.abort(new Error('user_requested'));
  const task = await pending;

  assert.equal(task.status, 'cancelled');
  assert.deepEqual(task.outputs, {});
  assert.ok(task.audit.some((entry) => entry.type === 'mission_cancelled'));
});

function makeWorkspace(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hane-orch-')));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

const readGrant = (scope) => ({ name: 'workspace.read', scope });

/**
 * The gateway the loop was built for: it answers with native tool calls until its
 * script runs out, and it keeps every message list it was handed — because the
 * only way to check what the model was shown is to look at what came back.
 */
class ToolGateway {
  constructor(turns = []) {
    this.turns = [...turns];
    this.requests = [];
    this.turnsAsked = [];
  }

  async complete(request) {
    this.requests.push(request);
    if (request.role === 'reviewer') return APPROVING_REVIEWER;
    return `${request.role} output`;
  }

  async completeTurn({ messages, tools }) {
    this.turnsAsked.push({ messages: structuredClone(messages), tools });
    const spec = this.turns.length > 0 ? this.turns.shift() : { content: 'executor output' };
    const calls = (spec.calls ?? []).map((call, index) => ({
      id: call.id ?? `call-${index}`,
      source: call.source ?? 'native',
      ...call,
    }));
    return {
      content: spec.content ?? null,
      protocol: spec.protocol ?? (calls.length > 0 ? 'native' : 'none'),
      toolCalls: calls,
    };
  }
}

const readCall = (path) => ({ name: 'read_file', arguments: { path } });
const listCall = (path) => ({ name: 'list_dir', arguments: { path } });

/**
 * The message the loop handed back for the calls made on turn `turn` (0-based):
 * it is the last thing in the *next* request, because the model only sees the
 * answer when it is asked again.
 */
function answerOn(gateway, turn = 0) {
  return gateway.turnsAsked[turn + 1].messages.at(-1);
}

test('the executor asks for a file, reads it, and answers from the bytes', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A content\n', 'docs/note.md': 'note\n' });
  const gateway = new ToolGateway([
    { calls: [readCall('src/a.js')] },
    { content: 'src/a.js holds A content.' },
  ]);
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-loop' }).start({
      objective: 'Summarize a.js.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
    });

    assert.equal(task.status, 'completed');
    assert.deepEqual(gateway.turnsAsked[0].tools.map((schema) => schema.function.name), ['read_file', 'list_dir']);
    assert.deepEqual(JSON.parse(answerOn(gateway).content), {
      ok: true, tool: 'read_file', path: 'src/a.js', bytes: 10, totalBytes: 10, truncated: false, content: 'A content\n',
    });
    assert.equal(answerOn(gateway).role, 'tool', 'a native call is answered on the channel the API defines');

    const audit = task.audit.filter((entry) => entry.type === 'tool_read');
    assert.deepEqual(audit.map((entry) => entry.detail), [{ path: 'src/a.js', bytes: 10, truncated: false, totalBytes: 10 }]);
    assert.equal(task.toolCalls, 1);
    assert.equal(task.providerCalls, 4, 'planner, two executor turns, reviewer');
    assert.equal(task.outputs.executor, 'src/a.js holds A content.');
    assert.deepEqual(gateway.requests.map((request) => request.role), ['planner', 'reviewer'], 'only the executor is offered tools');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a listing comes back as entries, not as file bytes', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A\n', 'src/nested/b.js': 'B\n' });
  const gateway = new ToolGateway([
    { calls: [listCall('src')] },
    { content: 'two entries' },
  ]);
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-listing' }).start({
      objective: 'Map the source tree.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
    });

    assert.deepEqual(JSON.parse(answerOn(gateway).content), {
      ok: true, tool: 'list_dir', path: 'src', entries: ['a.js', 'nested/'], truncated: false,
    });
    assert.ok(task.audit.some((entry) => entry.type === 'tool_listing'
      && entry.detail.path === 'src' && entry.detail.entries === 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a path the grants do not cover is refused by the sandbox and audited, and the run goes on', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A content\n', '.env': 'SECRET=leak' });
  const gateway = new ToolGateway([
    { calls: [readCall('../outside.txt'), readCall('.env'), readCall('src/a.js')] },
    { content: 'only the granted file came back' },
  ]);
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-denied' }).start({
      objective: 'Try to read everything.',
      capabilityGrants: [readGrant('.')],
      workspaceRoot: root,
    });

    assert.equal(task.status, 'completed');
    assert.deepEqual(
      task.audit.filter((entry) => entry.type === 'tool_denied').map((entry) => entry.detail),
      [
        { path: '../outside.txt', reason: 'escapes_workspace_root' },
        { path: '.env', reason: 'denied_by_secret_policy' },
      ],
    );
    assert.equal(JSON.parse(answerOn(gateway).content).ok, true);
    assert.equal(task.toolCalls, 3, 'a refusal is still an action the mission spent');
    assert.equal(JSON.stringify(task.audit).includes('SECRET'), false, 'a denied file never reaches the audit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a call the mission has no tool for never reaches the sandbox', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A\n' });
  const gateway = new ToolGateway([
    { calls: [{ name: 'delete_file', arguments: { path: 'src/a.js' } }] },
    { content: 'refused, so I described the file' },
  ]);
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-unknown' }).start({
      objective: 'Try to remove a file.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
    });

    assert.deepEqual(
      task.audit.filter((entry) => entry.type === 'tool_call_refused').map((entry) => entry.detail),
      [{ role: 'executor', tool: 'delete_file', reason: 'unknown_tool', protocol: 'native' }],
    );
    assert.equal(JSON.parse(answerOn(gateway).content).reason, 'unknown_tool');
    assert.equal(task.toolCalls, 1, 'a call the model made is a call the mission pays for, even one it was refused');
    assert.equal(fs.existsSync(path.join(root, 'src', 'a.js')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the tool budget bounds how much of the workspace one role can pull in', async () => {
  const root = makeWorkspace(Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`src/f${n}.js`, `${n}\n`])));
  const gateway = new ToolGateway([
    { calls: [1, 2, 3, 4, 5].map((n) => readCall(`src/f${n}.js`)) },
    { content: 'I read two of them' },
  ]);
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-tool-budget' }).start({
      objective: 'Read all of it.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
      maxToolCalls: 2,
    });

    assert.equal(task.toolCalls, 2);
    assert.equal(task.audit.filter((entry) => entry.type === 'tool_read').length, 2);
    assert.ok(task.audit.some((entry) => entry.type === 'tool_budget_exhausted'));
    const finalTurn = gateway.turnsAsked[1];
    assert.equal(finalTurn.tools, null, 'the answer is asked without tools, so it cannot spend its way back into the same wall');
    const refused = finalTurn.messages.filter((message) => message.role === 'tool');
    assert.deepEqual(refused.map((message) => JSON.parse(message.content)), [
      { ok: true, tool: 'read_file', path: 'src/f1.js', bytes: 2, totalBytes: 2, truncated: false, content: '1\n' },
      { ok: true, tool: 'read_file', path: 'src/f2.js', bytes: 2, totalBytes: 2, truncated: false, content: '2\n' },
      { ok: false, tool: 'read_file', path: 'src/f3.js', reason: 'tool_budget_exhausted' },
      { ok: false, tool: 'read_file', path: 'src/f4.js', reason: 'tool_budget_exhausted' },
      { ok: false, tool: 'read_file', path: 'src/f5.js', reason: 'tool_budget_exhausted' },
    ], 'every call is answered, so the model knows which of its five asks went unread');
    assert.match(finalTurn.messages.at(-1).content, /^No more tool calls are available/);
    assert.equal(task.status, 'completed');
    assert.equal(task.outputs.executor, 'I read two of them');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('grants without a root, without grants, and a vanished root all run without tools', async () => {
  const withoutRoot = new ToolGateway([{ content: 'should never be asked' }]);
  const plainTask = await new Orchestrator({ provider: withoutRoot, idFactory: () => 'run-no-root' }).start({
    objective: 'Ask for files that have no root.',
    capabilityGrants: [readGrant('src')],
  });
  assert.equal(withoutRoot.turnsAsked.length, 0);
  assert.equal(plainTask.status, 'completed');
  assert.equal(plainTask.toolCalls, 0);

  const noGrants = new ToolGateway();
  await new Orchestrator({ provider: noGrants, idFactory: () => 'run-no-grants' }).start({ objective: 'No grants at all.' });
  assert.equal(noGrants.turnsAsked.length, 0);

  const missingRoot = new ToolGateway([{ content: 'should never be asked' }]);
  const goneTask = await new Orchestrator({ provider: missingRoot, idFactory: () => 'run-gone-root' }).start({
    objective: 'Point at a directory that does not exist.',
    capabilityGrants: [readGrant('src')],
    workspaceRoot: path.join(os.tmpdir(), 'hane-does-not-exist'),
  });
  assert.equal(missingRoot.turnsAsked.length, 0);
  assert.equal(goneTask.status, 'completed');
  assert.ok(goneTask.audit.some((entry) => entry.type === 'workspace_unavailable'));
});

test('a provider that cannot take a turn loses its tools loudly, not silently', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A\n' });
  const provider = new FakeProvider();
  try {
    const task = await new Orchestrator({ provider, idFactory: () => 'run-no-turn' }).start({
      objective: 'Read a file with a model that has no loop.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
    });

    assert.equal(task.status, 'completed');
    assert.equal(task.providerCalls, 3);
    assert.ok(task.audit.some((entry) => entry.type === 'tool_loop_unavailable'
      && entry.detail.reason === 'provider_cannot_take_a_turn'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the last provider call answers without tools instead of dying mid-read', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A\n', 'src/b.js': 'B\n' });
  const gateway = new ToolGateway([
    { calls: [readCall('src/a.js')] },
    { content: 'I read a.js but not b.js. Resume the mission (send "continue") to finish.' },
  ]);
  const events = [];
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-loop-last-call' }).start({
      objective: 'Read until the budget says stop.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
      maxProviderCalls: 3,
      onEvent: (event) => events.push(event),
    });

    assert.equal(task.status, 'needs_attention', 'the reviewer has no call left, so the run parks for the user');
    assert.equal(task.providerCalls, 3);
    assert.equal(task.toolCalls, 1, 'the last call was not spent on a second read');
    assert.equal(task.outputs.executor, 'I read a.js but not b.js. Resume the mission (send "continue") to finish.');
    assert.ok(task.audit.some((entry) => entry.type === 'tool_loop_last_call' && entry.detail.role === 'executor'));
    assert.equal(gateway.turnsAsked.length, 2);
    assert.equal(gateway.turnsAsked[1].tools, null, 'the final turn offers no tools');
    assert.match(gateway.turnsAsked[1].messages.at(-1).content, /final provider call/);
    assert.deepEqual(events.map((event) => event.type), ['role_saved', 'tool_audited', 'role_saved', 'role_skipped_budget', 'run_finished']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a role that starts on its last call answers, and a tool call it makes anyway is not executed', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A\n' });
  const gateway = new ToolGateway([
    { calls: [readCall('src/a.js')], content: 'Budget ran out before I could read anything. Send "continue" to resume.' },
  ]);
  const events = [];
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-first-call-last' }).start({
      objective: 'Read a file with one call to spare.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
      maxProviderCalls: 2,
      onEvent: (event) => events.push(event),
    });

    assert.equal(task.toolCalls, 0, 'the call it made anyway was not executed on the final turn');
    assert.equal(gateway.turnsAsked.length, 1);
    assert.equal(gateway.turnsAsked[0].tools, null);
    assert.equal(task.outputs.executor, 'Budget ran out before I could read anything. Send "continue" to resume.');
    assert.ok(task.audit.some((entry) => entry.type === 'tool_loop_last_call' && entry.detail.role === 'executor'));
    assert.ok(!task.audit.some((entry) => entry.type === 'tool_read'));
    assert.equal(task.status, 'needs_attention', 'the reviewer has no call left');
    assert.deepEqual(events.map((event) => event.type), ['role_saved', 'role_saved', 'role_skipped_budget', 'run_finished']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the turn guard stops a model that keeps asking and never answers', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A\n' });
  const gateway = new ToolGateway([
    ...Array.from({ length: 8 }, () => ({ calls: [readCall('src/a.js')] })),
    { content: 'asked once too often, then answered' },
  ]);
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-turn-guard' }).start({
      objective: 'Read the same file nine times.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
      maxProviderCalls: 12,
    });

    assert.equal(task.status, 'completed');
    assert.equal(task.toolCalls, 8);
    assert.ok(task.audit.some((entry) => entry.type === 'tool_loop_stopped' && entry.detail.reason === 'turn_guard'));
    assert.equal(task.providerCalls, 12, 'eight turns, the turn the guard spent, the closing answer, and one call per other role');
    assert.equal(task.outputs.executor, 'asked once too often, then answered');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the turn guard landing on the last call still answers instead of dying silent', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A\n' });
  const gateway = new ToolGateway([
    ...Array.from({ length: 8 }, () => ({ calls: [readCall('src/a.js')] })),
    { content: 'Eight reads and my budget is gone. Resume the mission (send "continue") to go on.' },
  ]);
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-guard-last-call' }).start({
      objective: 'Read the same file until both guards fire.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
      maxProviderCalls: 10,
    });

    assert.equal(task.toolCalls, 8);
    assert.equal(task.providerCalls, 10, 'the call reserved for the turn that never ran paid for the answer');
    assert.equal(task.outputs.executor, 'Eight reads and my budget is gone. Resume the mission (send "continue") to go on.');
    assert.ok(task.audit.some((entry) => entry.type === 'tool_loop_stopped' && entry.detail.reason === 'turn_guard'));
    assert.ok(task.audit.some((entry) => entry.type === 'tool_loop_last_call' && entry.detail.role === 'executor'));
    assert.equal(gateway.turnsAsked.length, 9);
    assert.equal(gateway.turnsAsked[8].tools, null, 'the answer after the guard offers no tools');
    assert.equal(task.status, 'needs_attention', 'the reviewer has no call left');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an inline call is audited as a fallback and answered as text, not on the tool channel', async () => {
  const root = makeWorkspace({ 'src/a.js': 'A content\n' });
  const gateway = new ToolGateway([
    { protocol: 'inline', content: '```hane-tool\n{"tool":"read_file","args":{"path":"src/a.js"}}\n```', calls: [{ source: 'inline', id: null, name: 'read_file', arguments: { path: 'src/a.js' } }] },
    { content: 'the gateway dropped my tools but the read happened' },
  ]);
  try {
    const task = await new Orchestrator({ provider: gateway, idFactory: () => 'run-inline' }).start({
      objective: 'Read a.js through a gateway that ignores tools.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
    });

    assert.ok(task.audit.some((entry) => entry.type === 'tool_protocol_fallback'
      && entry.detail.turn === 1 && entry.detail.calls === 1));
    const answered = answerOn(gateway);
    assert.equal(answered.role, 'user', 'a gateway with no tool role needs the result in the text');
    assert.match(answered.content, /^tool_result read_file: /);
    assert.equal(task.toolCalls, 1);
    assert.equal(task.status, 'completed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a resumed mission re-reads the workspace instead of replaying stored contents', async () => {
  const root = makeWorkspace({ 'src/a.js': 'first\n' });
  try {
    const gateway = new ToolGateway([
      { calls: [readCall('src/a.js')] },
      { content: 'read the first version' },
      { calls: [readCall('src/a.js')] },
      { content: 'read the second version' },
    ]);
    const orchestrator = new Orchestrator({ provider: gateway, repository: { save: () => {} }, idFactory: () => 'run-resume' });
    const task = await orchestrator.start({
      objective: 'Read once.',
      capabilityGrants: [readGrant('src')],
      workspaceRoot: root,
    });

    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'second\n');
    const rebuilt = TaskRun.fromSnapshot({
      ...task.snapshot(),
      status: 'needs_attention',
      providerCalls: 1,
      toolCalls: 0,
      outputs: { planner: task.outputs.planner },
    });
    await orchestrator.resume(rebuilt);

    const lastRead = answerOn(gateway, gateway.turnsAsked.length - 2);
    assert.equal(JSON.parse(lastRead.content).content, 'second\n');
    assert.equal(rebuilt.toolCalls, 1, 'the tool budget was reset with the mission, then spent once');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
