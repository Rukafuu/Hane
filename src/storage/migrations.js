/**
 * Numbered, append-only schema migrations. A migration never edits an applied
 * entry: new schema changes get a new number. Databases created before this
 * table existed are adopted by the baseline migration, which is idempotent.
 */

const MIGRATIONS = Object.freeze([
  Object.freeze({
    id: 1,
    name: 'baseline',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        max_provider_calls INTEGER NOT NULL,
        provider_calls INTEGER NOT NULL
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS task_outputs (
        task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY (task_id, role)
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS task_audit_entries (
        task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        at TEXT NOT NULL,
        type TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        PRIMARY KEY (task_id, ordinal)
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS provider_configs (
        label TEXT PRIMARY KEY,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        credential_reference TEXT NOT NULL
      ) STRICT;`,
    ]),
  }),
  Object.freeze({
    id: 2,
    name: 'mission_provider_and_max_tokens',
    statements: Object.freeze([
      'ALTER TABLE task_runs ADD COLUMN provider_label TEXT;',
      'ALTER TABLE provider_configs ADD COLUMN max_tokens INTEGER;',
    ]),
  }),
]);

export function latestMigrationId() {
  return MIGRATIONS.at(-1).id;
}

/**
 * Applies every migration the database has not recorded yet, one transaction
 * per migration, and returns the database unchanged.
 * @param {import('node:sqlite').DatabaseSync} database
 */
export function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(database.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.statements) database.exec(statement);
      database.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw new Error(`Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return database;
}
