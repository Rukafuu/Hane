import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrate, latestMigrationId } from '../src/storage/migrations.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';

const appliedIds = (database) => database.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((row) => row.id);
const columns = (database, table) => database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);

test('a fresh database holds the whole schema and records every migration', () => {
  const database = openHaneDatabase(':memory:');

  assert.deepEqual(appliedIds(database), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.deepEqual(columns(database, 'task_runs'), ['id', 'objective', 'status', 'max_provider_calls', 'provider_calls', 'provider_label', 'capability_grants_json', 'workspace_root', 'max_tool_calls', 'tool_calls', 'team_id', 'execution_plan_json', 'mode', 'max_provider_calls_per_actor']);
  assert.deepEqual(columns(database, 'provider_configs'), ['label', 'base_url', 'model', 'credential_reference', 'max_tokens']);
  assert.deepEqual(columns(database, 'onboarding_connections'), ['kind', 'account_label', 'scopes_json', 'connected_at']);
  assert.deepEqual(columns(database, 'installed_skills'), ['id', 'version', 'name', 'description', 'instructions', 'tags_json', 'source_path', 'content_hash', 'installed_at']);
  for (const table of ['task_outputs', 'task_audit_entries']) assert.equal(columns(database, table).length > 0, true);
  database.close();
});

test('re-running the migrations is a no-op', () => {
  const database = openHaneDatabase(':memory:');
  database.prepare('INSERT INTO provider_configs (label, base_url, model, credential_reference) VALUES (?, ?, ?, ?)')
    .run('openrouter', 'https://openrouter.ai/api/v1', 'gpt-test', 'local-agent-orchestrator/openrouter');

  migrate(database);
  migrate(database);

  assert.deepEqual(appliedIds(database), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM provider_configs').get().count, 1);
  database.close();
});

test('adopts a legacy database, keeping its rows and adding the new columns', () => {
  const database = new DatabaseSync(':memory:');
  // The pre-migration schema, exactly as the stores used to create it.
  database.exec(`
    CREATE TABLE task_runs (
      id TEXT PRIMARY KEY,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      max_provider_calls INTEGER NOT NULL,
      provider_calls INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE task_outputs (
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (task_id, role)
    ) STRICT;
    CREATE TABLE task_audit_entries (
      task_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      PRIMARY KEY (task_id, ordinal)
    ) STRICT;
    CREATE TABLE provider_configs (
      label TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      credential_reference TEXT NOT NULL
    ) STRICT;
    INSERT INTO task_runs (id, objective, status, max_provider_calls, provider_calls)
      VALUES ('legacy-run', 'Keep me.', 'completed', 3, 3);
  `);

  migrate(database);

  assert.deepEqual(appliedIds(database), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.equal(database.prepare('SELECT objective FROM task_runs WHERE id = ?').get('legacy-run').objective, 'Keep me.');
  assert.ok(columns(database, 'task_runs').includes('provider_label'));
  assert.ok(columns(database, 'task_runs').includes('capability_grants_json'));
  assert.ok(columns(database, 'task_runs').includes('workspace_root'));
  assert.ok(columns(database, 'provider_configs').includes('max_tokens'));
  // A pre-workspace row must adopt the tool budget defaults, not NULLs.
  const legacy = database.prepare('SELECT workspace_root AS workspaceRoot, max_tool_calls AS maxToolCalls, tool_calls AS toolCalls, max_provider_calls_per_actor AS perActor FROM task_runs WHERE id = ?').get('legacy-run');
  assert.equal(legacy.workspaceRoot, null);
  assert.equal(legacy.maxToolCalls, 24);
  assert.equal(legacy.toolCalls, 0);
  // The same for the actor share: a sequential mission stored before actors existed
  // gets the documented default rather than an empty budget.
  assert.equal(legacy.perActor, 6);
  database.close();
});

test('a failing migration rolls back and names itself', () => {
  const database = new DatabaseSync(':memory:');
  // A half-migrated shape: provider_configs already carries the column migration 2 adds last,
  // so the task_runs ALTER runs first and must be rolled back with the failed one.
  database.exec(`
    CREATE TABLE task_runs (
      id TEXT PRIMARY KEY,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      max_provider_calls INTEGER NOT NULL,
      provider_calls INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE task_outputs (task_id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL) STRICT;
    CREATE TABLE task_audit_entries (task_id TEXT NOT NULL, ordinal INTEGER NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, detail_json TEXT NOT NULL, PRIMARY KEY (task_id, ordinal)) STRICT;
    CREATE TABLE provider_configs (label TEXT PRIMARY KEY, base_url TEXT NOT NULL, model TEXT NOT NULL, credential_reference TEXT NOT NULL, max_tokens INTEGER) STRICT;
  `);

  assert.throws(() => migrate(database), /Migration 2 \(mission_provider_and_max_tokens\) failed/);
  assert.deepEqual(appliedIds(database), [1]);
  assert.equal(columns(database, 'task_runs').includes('provider_label'), false);
  database.close();
});

test('latestMigrationId reports the newest migration', () => {
  assert.equal(latestMigrationId(), 24);
});

test('a file database reads while a second connection writes', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hane-wal-'));
  const file = path.join(directory, 'hane.sqlite');
  // Windows keeps the -wal and -shm sidecars briefly after the last close, so the
  // temp directory needs a retry before it will go away.
  t.after(async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { fs.rmSync(directory, { recursive: true, force: true }); return; }
      catch { await new Promise((resolve) => setTimeout(resolve, 60)); }
    }
  });

  const database = openHaneDatabase(file);
  assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(database.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  database.prepare('INSERT INTO provider_configs (label, base_url, model, credential_reference) VALUES (?, ?, ?, ?)')
    .run('openrouter', 'https://openrouter.ai/api/v1', 'gpt-test', 'local-agent-orchestrator/openrouter');

  const writer = openHaneDatabase(file);
  writer.exec('BEGIN IMMEDIATE');
  writer.prepare('INSERT INTO provider_configs (label, base_url, model, credential_reference) VALUES (?, ?, ?, ?)')
    .run('local', 'http://127.0.0.1:8787/v1', 'gpt-other', 'local-agent-orchestrator/local');
  // The open transaction used to make every read on the live connection throw
  // "database is locked"; the serve process must keep answering while it commits.
  const labels = () => database.prepare('SELECT label FROM provider_configs ORDER BY label').all().map((row) => row.label);
  assert.deepEqual(labels(), ['openrouter']);
  writer.exec('COMMIT');
  assert.deepEqual(labels(), ['local', 'openrouter']);
  writer.close();
  database.close();
});

test('an in-memory database keeps its journal and still applies the schema', () => {
  const database = openHaneDatabase(':memory:');
  assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'memory');
  assert.equal(database.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  // The exact id list belongs to the tests above. This one only proves the
  // migration pass ran on a fresh in-memory file, so it must not name the newest
  // id: an id is added every time the schema grows.
  assert.ok(appliedIds(database).includes(latestMigrationId()));
  database.close();
});
