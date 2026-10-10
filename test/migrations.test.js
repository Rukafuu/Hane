import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrate, latestMigrationId } from '../src/storage/migrations.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';

const appliedIds = (database) => database.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((row) => row.id);
const columns = (database, table) => database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);

test('a fresh database holds the whole schema and records every migration', () => {
  const database = openHaneDatabase(':memory:');

  assert.deepEqual(appliedIds(database), [1, 2, 3]);
  assert.deepEqual(columns(database, 'task_runs'), ['id', 'objective', 'status', 'max_provider_calls', 'provider_calls', 'provider_label', 'capability_grants_json']);
  assert.deepEqual(columns(database, 'provider_configs'), ['label', 'base_url', 'model', 'credential_reference', 'max_tokens']);
  for (const table of ['task_outputs', 'task_audit_entries']) assert.equal(columns(database, table).length > 0, true);
  database.close();
});

test('re-running the migrations is a no-op', () => {
  const database = openHaneDatabase(':memory:');
  database.prepare('INSERT INTO provider_configs (label, base_url, model, credential_reference) VALUES (?, ?, ?, ?)')
    .run('openrouter', 'https://openrouter.ai/api/v1', 'gpt-test', 'local-agent-orchestrator/openrouter');

  migrate(database);
  migrate(database);

  assert.deepEqual(appliedIds(database), [1, 2, 3]);
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

  assert.deepEqual(appliedIds(database), [1, 2, 3]);
  assert.equal(database.prepare('SELECT objective FROM task_runs WHERE id = ?').get('legacy-run').objective, 'Keep me.');
  assert.ok(columns(database, 'task_runs').includes('provider_label'));
  assert.ok(columns(database, 'task_runs').includes('capability_grants_json'));
  assert.ok(columns(database, 'provider_configs').includes('max_tokens'));
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
  assert.equal(latestMigrationId(), 3);
});
