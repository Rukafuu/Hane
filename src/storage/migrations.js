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
  Object.freeze({
    id: 3,
    name: 'mission_capability_grants',
    statements: Object.freeze([
      "ALTER TABLE task_runs ADD COLUMN capability_grants_json TEXT NOT NULL DEFAULT '[]';",
    ]),
  }),
  Object.freeze({
    id: 4,
    name: 'onboarding_connections',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS onboarding_connections (
        kind TEXT PRIMARY KEY,
        account_label TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        connected_at TEXT NOT NULL
      ) STRICT;`,
    ]),
  }),
  Object.freeze({
    id: 5,
    name: 'mission_workspace_read',
    statements: Object.freeze([
      'ALTER TABLE task_runs ADD COLUMN workspace_root TEXT;',
      'ALTER TABLE task_runs ADD COLUMN max_tool_calls INTEGER NOT NULL DEFAULT 24;',
      'ALTER TABLE task_runs ADD COLUMN tool_calls INTEGER NOT NULL DEFAULT 0;',
    ]),
  }),
  Object.freeze({
    id: 6,
    name: 'installed_local_skills',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS installed_skills (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        source_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        installed_at TEXT NOT NULL
      ) STRICT;`,
    ]),
  }),
  Object.freeze({
    id: 7,
    name: 'local_personal_profile',
    statements: Object.freeze([
      `CREATE TABLE local_profiles (
        id TEXT PRIMARY KEY,
        installation_slot INTEGER NOT NULL UNIQUE CHECK (installation_slot = 1),
        display_name TEXT NOT NULL,
        email TEXT,
        avatar_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        onboarding_step INTEGER NOT NULL DEFAULT 1 CHECK (onboarding_step BETWEEN 1 AND 3),
        onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1))
      ) STRICT;`,
      `CREATE TABLE local_profile_secrets (
        profile_id TEXT PRIMARY KEY REFERENCES local_profiles(id) ON DELETE CASCADE,
        password_verifier TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        blocked_until INTEGER NOT NULL DEFAULT 0
      ) STRICT;`,
    ]),
  }),
  Object.freeze({
    id: 8,
    name: "local_profile_recovery",
    statements: Object.freeze([`CREATE TABLE local_profile_recovery (
      profile_id TEXT PRIMARY KEY REFERENCES local_profile_secrets(profile_id) ON DELETE CASCADE,
      code_verifier TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      blocked_until INTEGER NOT NULL DEFAULT 0
    ) STRICT;`]),
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
