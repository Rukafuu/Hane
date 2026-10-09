import assert from 'node:assert/strict';
import test from 'node:test';
import { createMissionServer } from '../src/server/mission-server.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { SqliteProviderConfigStore } from '../src/storage/sqlite-provider-config-store.js';
import { createProviderFromConfig } from '../src/providers/provider-factory.js';

class FakeCredentialManager {
  constructor() { this.secrets = new Map(); }
  async set(reference, secret) { this.secrets.set(reference, secret); }
  async get(reference) { return this.secrets.get(reference) ?? null; }
}

let reviewerVerdict = "approved";

class RecordingProvider {
  constructor({ apiKey, model }) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async complete({ role }) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (role === 'reviewer') return `${role} output\nverdict: ${reviewerVerdict}`;
    return `${role} output`;
  }
}

function createHarness() {
  const database = openHaneDatabase(':memory:');
  const repository = new SqliteTaskRepository({ database });
  const providerConfigStore = new SqliteProviderConfigStore({ database });
  const credentialManager = new FakeCredentialManager();
  const server = createMissionServer({
    repository,
    providerConfigStore,
    credentialManager,
    createProvider: (options) => createProviderFromConfig({ ...options, providerConstructor: RecordingProvider }),
  });
  const baseUrlPromise = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
  return {
    server,
    database,
    repository,
    providerConfigStore,
    credentialManager,
    baseUrl: () => baseUrlPromise,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function waitFor(predicate, { timeoutMs = 2000, stepMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return await predicate();
}

async function configureProvider(harness) {
  harness.providerConfigStore.upsert({
    label: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    credentialReference: 'local-agent-orchestrator/openrouter',
  });
  await harness.credentialManager.set('local-agent-orchestrator/openrouter', 'sk-test-value');
}

test('POST /api/missions runs a mission to completion and persists it', async (t) => {
  const harness = createHarness();
  t.after(() => harness.close());
  await configureProvider(harness);
  const baseUrl = await harness.baseUrl();

  const listBefore = await (await fetch(`${baseUrl}/api/missions`)).json();
  assert.deepEqual(listBefore.missions, []);

  const postResponse = await fetch(`${baseUrl}/api/missions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'Investigate flaky checkout tests.' }),
  });
  assert.equal(postResponse.status, 202);
  const queued = await postResponse.json();
  assert.match(queued.id, /^[\w-]+$/);
  assert.equal(queued.status, 'queued');

  assert.ok(await waitFor(async () => (await (await fetch(`${baseUrl}/api/missions/${queued.id}`)).json()).status === 'completed'));
  const mission = await (await fetch(`${baseUrl}/api/missions/${queued.id}`)).json();
  assert.equal(mission.status, 'completed');
  assert.equal(mission.objective, 'Investigate flaky checkout tests.');
  assert.equal(mission.providerLabel, 'openrouter');
  assert.equal(mission.outputs.reviewer, 'reviewer output\nverdict: approved');
  assert.equal(mission.audit.at(-1).detail.nextStatus, 'completed');
  assert.equal(JSON.stringify(mission).includes('sk-test-value'), false);
  assert.equal(JSON.stringify(mission).includes('apiKey'), false);

  const list = await (await fetch(`${baseUrl}/api/missions`)).json();
  assert.equal(list.missions.length, 1);
  assert.equal(list.missions[0].status, 'completed');
  assert.equal(list.missions[0].outputs, undefined);
});

test('GET /api/events streams orchestrator events over SSE', async (t) => {
  const harness = createHarness();
  let reader = null;
  t.after(async () => {
    reader?.cancel().catch(() => {});
    await harness.close();
  });
  await configureProvider(harness);
  const baseUrl = await harness.baseUrl();

  const stream = await fetch(`${baseUrl}/api/events`);
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pumping = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
      }
    } catch { /* cancelled */ }
  })();

  const postResponse = await fetch(`${baseUrl}/api/missions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'Stream progress live.' }),
  });
  assert.equal(postResponse.status, 202);

  assert.ok(await waitFor(() => buffer.includes('"type":"run_finished"')), 'expected a run_finished event on the SSE stream');
  const finishedLine = buffer.split('\n').find((line) => line.startsWith('data: ') && line.includes('"type":"run_finished"'));
  const event = JSON.parse(finishedLine.slice('data: '.length));
  assert.equal(event.missionId, event.task.id);
  assert.equal(event.task.status, 'completed');

  await reader.cancel();
  await pumping;
});

test('POST rejects invalid bodies with 400', async (t) => {
  const harness = createHarness();
  t.after(() => harness.close());
  await configureProvider(harness);
  const baseUrl = await harness.baseUrl();

  const tooShort = await fetch(`${baseUrl}/api/missions`, { method: 'POST', body: JSON.stringify({ objective: 'ab' }) });
  assert.equal(tooShort.status, 400);
  assert.match((await tooShort.json()).error, /three characters/);

  const badBudget = await fetch(`${baseUrl}/api/missions`, { method: 'POST', body: JSON.stringify({ objective: 'Valid objective.', maxProviderCalls: 0 }) });
  assert.equal(badBudget.status, 400);

  const badJson = await fetch(`${baseUrl}/api/missions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(badJson.status, 400);
});

test('provider resolution errors map to 404 and 409 with hints', async (t) => {
  const harness = createHarness();
  t.after(() => harness.close());
  const baseUrl = await harness.baseUrl();

  const noProvider = await fetch(`${baseUrl}/api/missions`, { method: 'POST', body: JSON.stringify({ objective: 'Valid objective.' }) });
  assert.equal(noProvider.status, 409);
  assert.match((await noProvider.json()).error, /No provider is configured/);

  await configureProvider(harness);
  await harness.credentialManager.secrets.delete('local-agent-orchestrator/openrouter');

  const missingSecret = await fetch(`${baseUrl}/api/missions`, { method: 'POST', body: JSON.stringify({ objective: 'Valid objective.' }) });
  assert.equal(missingSecret.status, 409);
  assert.match((await missingSecret.json()).error, /hane provider set-secret openrouter/);

  const unknown = await fetch(`${baseUrl}/api/missions`, { method: 'POST', body: JSON.stringify({ objective: 'Valid objective.', provider: 'ghost' }) });
  assert.equal(unknown.status, 404);
  assert.match((await unknown.json()).error, /Unknown provider "ghost"/);
});

test('GET /api/providers lists configured providers without secrets', async (t) => {
  const harness = createHarness();
  t.after(() => harness.close());
  await configureProvider(harness);
  const baseUrl = await harness.baseUrl();

  const { providers } = await (await fetch(`${baseUrl}/api/providers`)).json();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].label, 'openrouter');
  assert.equal(JSON.stringify(providers).includes('sk-test-value'), false);
});

test('unknown routes answer 404 as JSON', async (t) => {
  const harness = createHarness();
  t.after(() => harness.close());
  const baseUrl = await harness.baseUrl();

  const response = await fetch(`${baseUrl}/api/nope`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /No route/);

  assert.equal((await fetch(`${baseUrl}/`)).status, 404);
});

async function startMission(baseUrl, objective, extra = {}) {
  const response = await fetch(`${baseUrl}/api/missions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objective, ...extra }),
  });
  assert.equal(response.status, 202);
  return (await response.json()).id;
}

const getMission = async (baseUrl, id) => (await (await fetch(`${baseUrl}/api/missions/${id}`)).json());

test('approve after a revise verdict re-runs executor and reviewer and settles completed', async (t) => {
  const harness = createHarness();
  t.after(async () => { reviewerVerdict = "approved"; await harness.close(); });
  await configureProvider(harness);
  const baseUrl = await harness.baseUrl();
  reviewerVerdict = "revise";

  const id = await startMission(baseUrl, "Improve the flaky test result.");
  assert.ok(await waitFor(async () => (await getMission(baseUrl, id)).status === "awaiting_approval"));

  reviewerVerdict = "approved";
  const approved = await fetch(`${baseUrl}/api/missions/${id}/approve`, { method: "POST" });
  assert.equal(approved.status, 202);
  assert.equal((await approved.json()).status, "resuming");

  assert.ok(await waitFor(async () => (await getMission(baseUrl, id)).status === "completed"));
  const mission = await getMission(baseUrl, id);
  assert.equal(mission.providerCalls, 5);
  assert.equal(mission.maxProviderCalls, 5);
  assert.ok(mission.audit.some((entry) => entry.type === "budget_extended"));
});

test('retry resumes a budget-stopped mission and keeps already saved outputs', async (t) => {
  const harness = createHarness();
  t.after(async () => { reviewerVerdict = "approved"; await harness.close(); });
  await configureProvider(harness);
  const baseUrl = await harness.baseUrl();

  const id = await startMission(baseUrl, "Inspect this risky objective.", { maxProviderCalls: 2 });
  assert.ok(await waitFor(async () => (await getMission(baseUrl, id)).status === "needs_attention"));
  const parked = await getMission(baseUrl, id);
  assert.equal(parked.outputs.reviewer, undefined);

  const retried = await fetch(`${baseUrl}/api/missions/${id}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxProviderCalls: 3 }),
  });
  assert.equal(retried.status, 202);

  assert.ok(await waitFor(async () => (await getMission(baseUrl, id)).status === "completed"));
  const mission = await getMission(baseUrl, id);
  assert.equal(mission.providerCalls, 3);
  assert.equal(mission.outputs.planner, parked.outputs.planner);
  assert.equal(mission.outputs.reviewer, "reviewer output\nverdict: approved");
});

test('approve and retry reject missions in the wrong state with 409, unknown ids with 404', async (t) => {
  const harness = createHarness();
  t.after(() => harness.close());
  await configureProvider(harness);
  const baseUrl = await harness.baseUrl();

  const id = await startMission(baseUrl, "Complete normally then reject actions.");
  assert.ok(await waitFor(async () => (await getMission(baseUrl, id)).status === "completed"));

  const wrongApprove = await fetch(`${baseUrl}/api/missions/${id}/approve`, { method: "POST" });
  assert.equal(wrongApprove.status, 409);
  assert.match((await wrongApprove.json()).error, /not awaiting_approval/);

  const wrongRetry = await fetch(`${baseUrl}/api/missions/${id}/retry`, { method: "POST" });
  assert.equal(wrongRetry.status, 409);
  assert.match((await wrongRetry.json()).error, /only needs_attention or failed/);

  const missing = await fetch(`${baseUrl}/api/missions/00000000-0000-4000-8000-000000000000/approve`, { method: "POST" });
  assert.equal(missing.status, 404);
});
