import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import { runCli } from '../src/cli/main.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { SqliteProviderConfigStore } from '../src/storage/sqlite-provider-config-store.js';
import { createProviderFromConfig } from '../src/providers/provider-factory.js';

class FakeCredentialManager {
  constructor() { this.secrets = new Map(); }
  async set(reference, secret) { this.secrets.set(reference, secret); }
  async get(reference) { return this.secrets.get(reference) ?? null; }
}

class RecordingProvider {
  constructor({ baseUrl, apiKey, model }) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.apiKey = apiKey;
    this.requests = [];
  }
  async complete(request) {
    this.requests.push(request);
    if (request.role === 'reviewer') return `${request.role} output\nverdict: approved`;
    return `${request.role} output`;
  }
}

function createHarness({ reviewerOutput = 'reviewer output\nverdict: approved' } = {}) {
  const database = openHaneDatabase(':memory:');
  const credentialManager = new FakeCredentialManager();
  const createdProviders = [];
  const stdoutLines = [];
  const stderrLines = [];
  let reviewerCalls = 0;
  const LifecycleProvider = class extends RecordingProvider {
    async complete(request) {
      await super.complete(request);
      if (request.role !== 'reviewer') return `${request.role} output`;
      reviewerCalls += 1;
      return typeof reviewerOutput === 'function' ? reviewerOutput(reviewerCalls) : reviewerOutput;
    }
  };
  const collector = (lines) => ({ write: (text) => { lines.push(text); return true; } });
  const run = async (argv, { stdin = Readable.from([]) } = {}) => {
    stdoutLines.length = 0;
    stderrLines.length = 0;
    return runCli({
    argv,
    stdout: collector(stdoutLines),
    stderr: collector(stderrLines),
    stdin,
    dependencies: {
      openDatabase: () => database,
      createTaskRepository: (db) => new SqliteTaskRepository({ database: db }),
      createProviderConfigStore: (db) => new SqliteProviderConfigStore({ database: db }),
      credentialManager,
      createProvider: async (options) => {
        const provider = await createProviderFromConfig({ ...options, providerConstructor: LifecycleProvider });
        createdProviders.push(provider);
        return provider;
      },
    },
    });
  };
  return {
    database,
    credentialManager,
    createdProviders,
    reviewerCallCount: () => reviewerCalls,
    latestMissionId: () => database.prepare('SELECT id FROM task_runs ORDER BY rowid DESC LIMIT 1').get().id,
    output: () => stdoutLines.join(''),
    errors: () => stderrLines.join(''),
    run,
  };
}

async function configureProvider(harness, { stdin } = {}) {
  assert.equal(await harness.run(['provider', 'add', '--label', 'openrouter', '--base-url', 'https://openrouter.ai/api/v1/', '--model', 'meta-llama/llama-3.1-8b-instruct:free']), 0);
  assert.equal(await harness.run(['provider', 'set-secret', 'openrouter'], { stdin: stdin ?? Readable.from(['sk-test-value\n']) }), 0);
}

test('runs the full provider flow and reports progress role by role', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['run', 'Draft a migration plan.']), 0);

  assert.match(harness.output(), /\[1\/3\] planner {2}saved \(call 1\/3\)/);
  assert.match(harness.output(), /\[3\/3\] reviewer saved \(call 3\/3\)/);
  assert.match(harness.output(), /status: completed · audit: \d+ entries/);
  assert.match(harness.output(), /--- reviewer ---/);
  assert.equal(harness.createdProviders.length, 1);
  assert.equal(harness.createdProviders[0].apiKey, 'sk-test-value');
  assert.equal(harness.createdProviders[0].model, 'meta-llama/llama-3.1-8b-instruct:free');

  const stored = harness.database.prepare('SELECT status, provider_calls AS providerCalls FROM task_runs').get();
  assert.equal(stored.status, 'completed');
  assert.equal(stored.providerCalls, 3);
});

test('exhausted budget exits 2 and reports the skipped reviewer', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  const code = await harness.run(['run', 'Inspect this objective.', '--max-calls', '2']);

  assert.equal(code, 2);
  assert.match(harness.output(), /\[2\/2\] reviewer skipped \(budget exhausted\)/);
  assert.match(harness.output(), /status: needs_attention/);
});

test('an unknown --provider label exits 1 with a hint', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  const code = await harness.run(['run', 'Objective here.', '--provider', 'nope']);

  assert.equal(code, 1);
  assert.match(harness.errors(), /error: Unknown provider "nope"\. hint: hane provider list/);
});

test('a provider without a stored secret exits 1 pointing at set-secret', async () => {
  const harness = createHarness();
  assert.equal(await harness.run(['provider', 'add', '--label', 'openrouter', '--base-url', 'https://openrouter.ai/api/v1', '--model', 'm']), 0);
  const code = await harness.run(['run', 'Objective here.']);

  assert.equal(code, 1);
  assert.match(harness.errors(), /hane provider set-secret openrouter/);
  assert.equal(harness.createdProviders.length, 0);
});

test('--json prints only the task snapshot without leaking the secret', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  const code = await harness.run(['run', 'Draft a migration plan.', '--json']);

  assert.equal(code, 0);
  const output = harness.output();
  assert.equal(JSON.parse(output).status, 'completed');
  assert.match(output, /^\{/);
  assert.equal(output.includes('[1/3]'), false);
  assert.equal(output.includes('mission'), false);
  assert.equal(output.includes('sk-test-value'), false);
  assert.equal(output.includes('apiKey'), false);
});

test('provider list shows the configured label', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['provider', 'list']), 0);
  assert.match(harness.output(), /openrouter · meta-llama\/llama-3\.1-8b-instruct:free · https:\/\/openrouter\.ai\/api\/v1/);
});

test('provider add records a token budget and rejects a malformed one', async () => {
  const harness = createHarness();
  assert.equal(await harness.run(['provider', 'add', '--label', 'openrouter', '--base-url', 'https://openrouter.ai/api/v1', '--model', 'gpt-test', '--max-tokens', '4096']), 0);
  assert.equal(harness.database.prepare('SELECT max_tokens AS maxTokens FROM provider_configs').get().maxTokens, 4096);

  assert.equal(await harness.run(['provider', 'list']), 0);
  assert.match(harness.output(), /gpt-test · https:\/\/openrouter\.ai\/api\/v1 · max_tokens 4096/);

  assert.equal(await harness.run(['provider', 'add', '--label', 'other', '--base-url', 'https://x.test/v1', '--model', 'm', '--max-tokens', 'zero']), 1);
  assert.match(harness.errors(), /--max-tokens must be a positive integer/);
});

test('set-secret rejects an unknown label and an empty piped secret', async () => {
  const harness = createHarness();
  assert.equal(await harness.run(['provider', 'set-secret', 'ghost']), 1);
  assert.match(harness.errors(), /error: unknown provider "ghost"\./);

  await configureProvider(harness);
  assert.equal(await harness.run(['provider', 'set-secret', 'openrouter'], { stdin: Readable.from(['   \n']) }), 1);
  assert.match(harness.errors(), /secret is required/);
  assert.equal(harness.credentialManager.secrets.size, 1);
});

test('run without any configured provider exits 1', async () => {
  const harness = createHarness();
  const code = await harness.run(['run', 'Objective here.']);

  assert.equal(code, 1);
  assert.match(harness.errors(), /No provider is configured/);
});

test('serve exposes the mission API on loopback and exits cleanly on SIGINT', async () => {
  const database = openHaneDatabase(':memory:');
  const credentialManager = new FakeCredentialManager();
  const providerConfigStore = new SqliteProviderConfigStore({ database });
  providerConfigStore.upsert({ label: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', credentialReference: 'local-agent-orchestrator/openrouter' });
  await credentialManager.set('local-agent-orchestrator/openrouter', 'sk-serve-value');
  const stdoutLines = [];
  const stderrLines = [];
  const signals = new Map();
  let exitCode;
  const running = runCli({
    argv: ['serve', '--port', '0'],
    stdout: { write: (text) => { stdoutLines.push(text); return true; } },
    stderr: { write: (text) => { stderrLines.push(text); return true; } },
    dependencies: {
      openDatabase: () => database,
      createTaskRepository: (db) => new SqliteTaskRepository({ database: db }),
      createProviderConfigStore: (db) => new SqliteProviderConfigStore({ database: db }),
      credentialManager,
      createProvider: (options) => createProviderFromConfig({ ...options, providerConstructor: RecordingProvider }),
      addSignalListener: (name, handler) => { signals.set(name, handler); },
    },
  }).then((code) => { exitCode = code; });

  const printed = await new Promise((resolve) => {
    const deadline = Date.now() + 3000;
    const timer = setInterval(() => {
      const joined = stdoutLines.join('');
      if (joined.includes('http://127.0.0.1:')) { clearInterval(timer); resolve(joined); }
      else if (Date.now() > deadline) { clearInterval(timer); resolve(null); }
    }, 10);
  });
  assert.ok(printed !== null, `serve never printed its address; stdout: ${stdoutLines.join('')}stderr: ${stderrLines.join('')}`);
  const { port } = printed.match(/127\.0\.0\.1:(?<port>\d+)/).groups;

  const listed = await (await fetch(`http://127.0.0.1:${port}/api/missions`)).json();
  assert.deepEqual(listed.missions, []);
  const created = await fetch(`http://127.0.0.1:${port}/api/missions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'Serve a mission end to end.' }),
  });
  assert.equal(created.status, 202);

  assert.ok(signals.has('SIGINT'));
  signals.get('SIGINT')();
  await running;
  assert.equal(exitCode, 0);
  database.close();
});

test('--db keeps config and missions in the requested file', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hane-cli-'));
  const dbPath = path.join(directory, 'missions.sqlite');
  const credentialManager = new FakeCredentialManager();
  const stdoutLines = [];
  const stderrLines = [];
  const collector = (lines) => ({ write: (text) => { lines.push(text); return true; } });
  const run = (argv, stdin = Readable.from([])) => runCli({
    argv,
    stdout: collector(stdoutLines),
    stderr: collector(stderrLines),
    stdin,
    dependencies: {
      openDatabase: (filename) => openHaneDatabase(filename),
      createTaskRepository: (db) => new SqliteTaskRepository({ database: db }),
      createProviderConfigStore: (db) => new SqliteProviderConfigStore({ database: db }),
      credentialManager,
      createProvider: (options) => createProviderFromConfig({ ...options, providerConstructor: RecordingProvider }),
    },
  });

  assert.equal(await run(['provider', 'add', '--label', 'openrouter', '--base-url', 'https://openrouter.ai/api/v1', '--model', 'm', '--db', dbPath]), 0);
  assert.equal(await run(['provider', 'set-secret', 'openrouter', '--db', dbPath], Readable.from(['sk-db-value\n'])), 0);
  assert.equal(await run(['run', 'Persist this mission.', '--db', dbPath]), 0);

  const database = openHaneDatabase(dbPath);
  const stored = database.prepare('SELECT status FROM task_runs').get();
  assert.equal(stored.status, 'completed');
  database.close();
});

test('missions lists recorded missions with status and budget', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['missions']), 0);
  assert.match(harness.output(), /No missions recorded/);

  assert.equal(await harness.run(['run', 'First recorded mission.']), 0);
  assert.equal(await harness.run(['run', 'Second recorded mission.']), 0);
  assert.equal(await harness.run(['missions']), 0);

  const lines = harness.output().split('\n').filter((line) => line.includes(' · '));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Second recorded mission/);
  assert.match(lines[0], /completed\s+· 3\/3 calls/);
});

test('mission <id> shows the stored outputs and --json returns the record', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['run', 'Inspect mission details.']), 0);
  const id = harness.latestMissionId();

  assert.equal(await harness.run(['mission', id]), 0);
  assert.match(harness.output(), new RegExp(`mission ${id}`));
  assert.match(harness.output(), /status: completed · calls: 3\/3/);
  assert.match(harness.output(), /--- planner ---/);
  assert.match(harness.output(), /--- reviewer ---/);

  assert.equal(await harness.run(['mission', id, '--json']), 0);
  const record = JSON.parse(harness.output());
  assert.equal(record.status, 'completed');
  assert.equal(record.outputs.planner, 'planner output');
  assert.equal(harness.output().includes('sk-test-value'), false);

  assert.equal(await harness.run(['mission', 'no-such-id']), 1);
  assert.match(harness.errors(), /unknown mission "no-such-id"/);
});

test('retry resumes a budget-stopped mission once the budget is raised', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['run', 'Finish what the budget stopped.', '--max-calls', '2']), 2);
  const id = harness.latestMissionId();

  const code = await harness.run(['retry', id, '--max-calls', '4']);

  assert.equal(code, 0);
  assert.match(harness.output(), /reviewer saved/);
  assert.match(harness.output(), /status: completed/);
  const stored = harness.database.prepare('SELECT status, provider_calls AS providerCalls FROM task_runs WHERE id = ?').get(id);
  assert.equal(stored.status, 'completed');
  assert.equal(stored.providerCalls, 3);
});

test('retry reuses the provider the mission recorded, even with several configured', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['provider', 'add', '--label', 'backup', '--base-url', 'https://backup.test/v1', '--model', 'backup-model']), 0);
  assert.equal(await harness.run(['run', 'Stop on budget with two providers.', '--provider', 'openrouter', '--max-calls', '2']), 2);
  const id = harness.latestMissionId();

  assert.equal(await harness.run(['mission', id]), 0);
  assert.match(harness.output(), /provider: openrouter · objective: Stop on budget/);

  assert.equal(await harness.run(['retry', id, '--max-calls', '4']), 0);
  assert.match(harness.output(), /provider: openrouter \(meta-llama\/llama-3\.1-8b-instruct:free\)/);
});

test('retry points at --provider when the recorded provider is gone', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['run', 'Lose its provider.', '--max-calls', '2']), 2);
  const id = harness.latestMissionId();
  assert.equal(await harness.run(['provider', 'remove', 'openrouter']), 0);

  assert.equal(await harness.run(['retry', id, '--max-calls', '4']), 1);
  assert.match(harness.errors(), /Provider "openrouter" was used by this mission but is no longer configured/);
});

test('retry refuses a completed mission and points a parked mission at approve', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['run', 'A mission that completes.']), 0);
  const doneId = harness.latestMissionId();
  assert.equal(await harness.run(['retry', doneId]), 1);
  assert.match(harness.errors(), /is completed; only needs_attention or failed missions can be retried/);

  const parked = createHarness({ reviewerOutput: 'Not good enough.\nverdict: revise' });
  await configureProvider(parked);
  assert.equal(await parked.run(['run', 'A mission that parks.']), 2);
  const parkedId = parked.latestMissionId();
  assert.equal(await parked.run(['retry', parkedId]), 1);
  assert.match(parked.errors(), new RegExp(`hint: hane approve ${parkedId}`));
});

test('approve spends new calls on the revision and completes the mission', async () => {
  const harness = createHarness({ reviewerOutput: (attempt) => attempt === 1 ? 'Still weak.\nverdict: revise' : 'Much better.\nverdict: approved' });
  await configureProvider(harness);
  assert.equal(await harness.run(['run', 'Improve the result.']), 2);
  const id = harness.latestMissionId();
  assert.equal(harness.database.prepare('SELECT status FROM task_runs WHERE id = ?').get(id).status, 'awaiting_approval');
  const auditBefore = harness.database.prepare('SELECT COUNT(*) AS entries FROM task_audit_entries WHERE task_id = ?').get(id).entries;

  const code = await harness.run(['approve', id]);

  assert.equal(code, 0);
  assert.match(harness.output(), /approved: re-running executor and reviewer/);
  assert.match(harness.output(), /status: completed/);
  const stored = harness.database.prepare('SELECT status, provider_calls AS providerCalls FROM task_runs WHERE id = ?').get(id);
  assert.equal(stored.status, 'completed');
  assert.equal(stored.providerCalls, 5);
  assert.equal(harness.reviewerCallCount(), 2);
  assert.equal(harness.database.prepare('SELECT COUNT(*) AS entries FROM task_audit_entries WHERE task_id = ?').get(id).entries, auditBefore + 9);
});

test('approve refuses a mission that never parked for review', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['run', 'A clean mission.']), 0);
  const id = harness.latestMissionId();

  assert.equal(await harness.run(['approve', id]), 1);
  assert.match(harness.errors(), /is completed, not awaiting_approval/);
});

test('approve on an unknown mission exits 1 with a hint', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  assert.equal(await harness.run(['approve', 'ghost-id']), 1);
  assert.match(harness.errors(), /unknown mission "ghost-id"/);
});

test('run records the workspace root and grants it was given', async () => {
  const harness = createHarness();
  await configureProvider(harness);
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'hane-cli-')));

  const code = await harness.run(['run', 'Inspect the workspace.', '--workspace', root, '--capability', 'workspace.read=src']);
  assert.equal(code, 0);
  assert.match(harness.output(), new RegExp(`grants: workspace\\.read\\(src\\)`));
  assert.match(harness.output(), new RegExp(`workspace: ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(harness.output(), /tool calls: 0/);

  const stored = harness.database.prepare('SELECT workspace_root AS workspaceRoot, capability_grants_json AS grants, tool_calls AS toolCalls FROM task_runs').get();
  assert.equal(stored.workspaceRoot, root);
  assert.deepEqual(JSON.parse(stored.grants), [{ name: 'workspace.read', scope: 'src' }]);
  assert.equal(stored.toolCalls, 0);
});

test('workspace capabilities without a root are a usage error, not a silent no-op', async () => {
  const harness = createHarness();
  await configureProvider(harness);

  assert.equal(await harness.run(['run', 'Read some files.', '--capability', 'workspace.read=src']), 1);
  assert.match(harness.errors(), /--workspace <dir>/);
});

test('a workspace root that does not exist is refused before the first provider call', async () => {
  const harness = createHarness();
  await configureProvider(harness);

  assert.equal(await harness.run(['run', 'Read some files.', '--workspace', path.join(tmpdir(), 'no-such-hane-root'), '--capability', 'workspace.read=src']), 1);
  assert.match(harness.errors(), /does not exist/);
  assert.equal(harness.database.prepare('SELECT COUNT(*) AS count FROM task_runs').get().count, 0);
});

test('a malformed capability flag is rejected before any provider call', async () => {
  const harness = createHarness();
  await configureProvider(harness);

  assert.equal(await harness.run(['run', 'Read some files.', '--workspace', realpathSync(tmpdir()), '--capability', 'workspace.read']), 1);
  assert.match(harness.errors(), /name=scope/);

  assert.equal(await harness.run(['run', 'Read some files.', '--workspace', realpathSync(tmpdir()), '--capability', 'delete.everything=/']), 1);
  assert.match(harness.errors(), /Unknown capability/);
});

async function printedAddress(stdoutLines) {
  return await new Promise((resolve) => {
    const deadline = Date.now() + 3000;
    const timer = setInterval(() => {
      const joined = stdoutLines.join('');
      if (joined.includes('http://127.0.0.1:')) { clearInterval(timer); resolve(joined); }
      else if (Date.now() > deadline) { clearInterval(timer); resolve(null); }
    }, 10);
  });
}

function serveDependencies({ database, credentialManager, signals }) {
  return {
    openDatabase: () => database,
    createTaskRepository: (db) => new SqliteTaskRepository({ database: db }),
    createProviderConfigStore: (db) => new SqliteProviderConfigStore({ database: db }),
    credentialManager,
    createProvider: (options) => createProviderFromConfig({ ...options, providerConstructor: RecordingProvider }),
    addSignalListener: (name, handler) => { signals.set(name, handler); },
  };
}

test('serve --workspace registers the option and offers the root as the mission default', async () => {
  const database = openHaneDatabase(':memory:');
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'hane-cli-')));
  const credentialManager = new FakeCredentialManager();
  const providerConfigStore = new SqliteProviderConfigStore({ database });
  providerConfigStore.upsert({ label: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', credentialReference: 'local-agent-orchestrator/openrouter' });
  await credentialManager.set('local-agent-orchestrator/openrouter', 'sk-serve-value');
  const stdoutLines = [];
  const stderrLines = [];
  const signals = new Map();
  let exitCode;
  const running = runCli({
    argv: ['serve', '--port', '0', '--workspace', root],
    stdout: { write: (text) => { stdoutLines.push(text); return true; } },
    stderr: { write: (text) => { stderrLines.push(text); return true; } },
    dependencies: serveDependencies({ database, credentialManager, signals }),
  }).then((code) => { exitCode = code; });

  const printed = await printedAddress(stdoutLines);
  assert.ok(printed !== null, `serve never printed its address; stdout: ${stdoutLines.join('')}stderr: ${stderrLines.join('')}`);
  assert.match(printed, new RegExp(`workspace: ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const { port } = printed.match(/127\.0\.0\.1:(?<port>\d+)/).groups;

  const workspace = await (await fetch(`http://127.0.0.1:${port}/api/workspace`)).json();
  assert.deepEqual(workspace, { available: true, root });

  const created = await fetch(`http://127.0.0.1:${port}/api/missions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'Serve a mission on the server root.', capabilities: [{ name: 'workspace.read', scope: 'src' }] }),
  });
  assert.equal(created.status, 202);
  assert.equal((await created.json()).workspaceRoot, root);

  signals.get('SIGINT')();
  await running;
  assert.equal(exitCode, 0);
  database.close();
});

test('serve --workspace with a missing directory exits 1 before binding', async () => {
  const database = openHaneDatabase(':memory:');
  const credentialManager = new FakeCredentialManager();
  const providerConfigStore = new SqliteProviderConfigStore({ database });
  providerConfigStore.upsert({ label: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', credentialReference: 'local-agent-orchestrator/openrouter' });
  await credentialManager.set('local-agent-orchestrator/openrouter', 'sk-serve-value');
  const stdoutLines = [];
  const stderrLines = [];
  const signals = new Map();
  const missing = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'hane-cli-'))), 'never-created');

  const code = await runCli({
    argv: ['serve', '--port', '0', '--workspace', missing],
    stdout: { write: (text) => { stdoutLines.push(text); return true; } },
    stderr: { write: (text) => { stderrLines.push(text); return true; } },
    dependencies: serveDependencies({ database, credentialManager, signals }),
  });

  assert.equal(code, 1);
  assert.match(stderrLines.join(''), new RegExp(`Workspace root "${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" does not exist\\.`));
  assert.match(stderrLines.join(''), /hint: hane serve --workspace <dir>/);
  assert.equal(stdoutLines.join('').includes('http://127.0.0.1'), false);
  assert.equal(signals.size, 0);
  database.close();
});

test('serve --workspace rejects a file root and a blank value', async () => {
  const database = openHaneDatabase(':memory:');
  const run = async (value) => {
    const stdoutLines = [];
    const stderrLines = [];
    const code = await runCli({
      argv: ['serve', '--port', '0', '--workspace', value],
      stdout: { write: (text) => { stdoutLines.push(text); return true; } },
      stderr: { write: (text) => { stderrLines.push(text); return true; } },
      dependencies: serveDependencies({ database, credentialManager: new FakeCredentialManager(), signals: new Map() }),
    });
    return { code, errors: stderrLines.join(''), printed: stdoutLines.join('').includes('http://127.0.0.1') };
  };

  const file = await run(import.meta.filename);
  assert.equal(file.code, 1);
  assert.match(file.errors, /is not a directory/);
  assert.equal(file.printed, false);

  const blank = await run('');
  assert.equal(blank.code, 1);
  assert.match(blank.errors, /non-empty path/);
  assert.equal(blank.printed, false);
  database.close();
});
