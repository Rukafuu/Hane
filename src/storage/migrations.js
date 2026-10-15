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
  Object.freeze({ id: 9, name: 'persistent_agents', statements: Object.freeze([
    `CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      instructions TEXT NOT NULL, provider_label TEXT REFERENCES provider_configs(label) ON DELETE RESTRICT,
      exclusive INTEGER NOT NULL DEFAULT 0 CHECK(exclusive IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;`,
  ]) }),
  Object.freeze({ id: 10, name: 'persistent_teams', statements: Object.freeze([
    `CREATE TABLE teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      leader_agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
    ) STRICT;`,
    `CREATE TABLE team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 7),
      exclusive INTEGER NOT NULL CHECK(exclusive IN (0,1)),
      PRIMARY KEY(team_id,agent_id), UNIQUE(team_id,position)
    ) STRICT;`,
    `CREATE UNIQUE INDEX team_member_exclusive ON team_members(agent_id) WHERE exclusive = 1;`,
    `CREATE TRIGGER team_member_boundary BEFORE INSERT ON team_members BEGIN
      SELECT CASE WHEN NEW.exclusive != (SELECT exclusive FROM agents WHERE id=NEW.agent_id)
        THEN RAISE(ABORT,'Member exclusivity must match the agent') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM team_members WHERE agent_id=NEW.agent_id AND team_id!=NEW.team_id AND (exclusive=1 OR NEW.exclusive=1))
        THEN RAISE(ABORT,'Exclusive agent belongs to another team') END;
    END;`,
  ]) }),
  Object.freeze({ id: 11, name: 'execution_team_link', statements: Object.freeze([
    'ALTER TABLE task_runs ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT;',
    'CREATE INDEX task_runs_team ON task_runs(team_id);',
  ]) }),
  Object.freeze({ id: 12, name: 'library_import_receipts', statements: Object.freeze([
    'CREATE TABLE library_imports (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;',
  ]) }),
  Object.freeze({ id: 13, name: 'agent_identity_and_capabilities', statements: Object.freeze([
    "ALTER TABLE agents ADD COLUMN visual_json TEXT NOT NULL DEFAULT '{}';",
    "ALTER TABLE agents ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';",
    'ALTER TABLE agents ADD COLUMN is_initial INTEGER NOT NULL DEFAULT 0 CHECK(is_initial IN (0,1));',
    'CREATE UNIQUE INDEX agents_initial ON agents(is_initial) WHERE is_initial=1;',
  ]) }),
  Object.freeze({ id: 14, name: 'agent_conversations', statements: Object.freeze([
    `CREATE TABLE conversations (id TEXT PRIMARY KEY, agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,
      team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT, title TEXT NOT NULL, created_at TEXT NOT NULL,
      CHECK((agent_id IS NULL) != (team_id IS NULL))) STRICT;`,
    `CREATE TABLE conversation_turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      recipient_id TEXT REFERENCES agents(id) ON DELETE RESTRICT, status TEXT NOT NULL, error TEXT,
      provider_calls INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0,
      max_provider_calls INTEGER NOT NULL, max_tool_calls INTEGER NOT NULL,
      audit_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL) STRICT;`,
    `CREATE UNIQUE INDEX conversation_active_turn ON conversation_turns(conversation_id) WHERE status='running';`,
    `CREATE TABLE conversation_messages (ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT, author_name TEXT NOT NULL,
      content TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;`,
  ]) }),
  Object.freeze({ id: 15, name: 'agent_instruction_documents', statements: Object.freeze([
    "ALTER TABLE agents ADD COLUMN instruction_files_json TEXT NOT NULL DEFAULT '[]';",
  ]) }),
  Object.freeze({ id: 17, name: 'execution_agent_snapshot', statements: Object.freeze([
    'ALTER TABLE task_runs ADD COLUMN execution_plan_json TEXT;',
  ]) }),
  Object.freeze({ id: 18, name: 'settings_memory_and_mcp', statements: Object.freeze([
    "CREATE TABLE settings_memory (id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('shared','agent','team')), target_id TEXT, content TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;",
    'CREATE TABLE settings_mcp (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL) STRICT;',
  ]) }),
  Object.freeze({ id: 19, name: 'manual_mcp_call_audit', statements: Object.freeze([
    'CREATE TABLE settings_mcp_calls (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, server_name TEXT NOT NULL, tool TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT) STRICT;',
  ]) }),
  // The actor runtime's own tables. They key on `execution_id` rather than a
  // foreign key into task_runs on purpose: the same mailbox, trail and versioned
  // state are meant to serve a team conversation later, and a conversation id
  // has no row in task_runs to point at. Nor do they reference agents(id):
  // deleting an agent is a supported library action, and an audit trail of what
  // already happened must not quietly make every agent that ever ran undeletable.
  // Roster membership is checked where a message or a task is accepted, which is
  // where the guarantee has to live anyway.
  Object.freeze({ id: 20, name: 'actor_mailbox', statements: Object.freeze([
    `CREATE TABLE actor_mailbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL,
      recipient_agent_id TEXT NOT NULL,
      sender_agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      hop INTEGER NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high')),
      reply_to INTEGER REFERENCES actor_mailbox(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','processed','dropped')),
      drop_reason TEXT,
      claim_token TEXT,
      claim_owner TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
      lease_expires_at TEXT,
      dedupe_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      processed_at TEXT
    ) STRICT;`,
    'CREATE INDEX actor_mailbox_inbox ON actor_mailbox(execution_id, recipient_agent_id, status, id);',
    "ALTER TABLE task_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'sequential';",
  ]) }),
  Object.freeze({ id: 21, name: 'execution_event_trail', statements: Object.freeze([
    `CREATE TABLE mission_events (
      ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_kind TEXT NOT NULL DEFAULT 'mission' CHECK(execution_kind IN ('mission','conversation')),
      execution_id TEXT NOT NULL,
      team_id TEXT,
      actor_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;`,
    'CREATE INDEX mission_events_by_execution ON mission_events(execution_id, ordinal);',
  ]) }),
  Object.freeze({ id: 22, name: 'versioned_execution_state', statements: Object.freeze([
    `CREATE TABLE task_state_revisions (
      execution_id TEXT NOT NULL,
      state_key TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision >= 1),
      value_json TEXT NOT NULL,
      writer_agent_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(execution_id, state_key, revision)
    ) STRICT;`,
    `CREATE TABLE task_state_current (
      execution_id TEXT NOT NULL,
      state_key TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(execution_id, state_key)
    ) STRICT;`,
    `CREATE TABLE artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL,
      task_id TEXT,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      effect_key TEXT UNIQUE,
      created_at TEXT NOT NULL
    ) STRICT;`,
    'CREATE INDEX artifacts_by_execution ON artifacts(execution_id, id);',
  ]) }),
  Object.freeze({ id: 23, name: 'actor_task_graph', statements: Object.freeze([
    `CREATE TABLE actor_tasks (
      execution_id TEXT NOT NULL,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      assignee_agent_id TEXT NOT NULL,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','running','completed','failed','blocked')),
      result_key TEXT,
      note TEXT,
      claim_owner TEXT,
      lease_expires_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(execution_id, id)
    ) STRICT;`,
    'CREATE INDEX actor_tasks_by_status ON actor_tasks(execution_id, status, id);',
  ]) }),
  // The per-actor share is part of the budget the user authorized, so a resume has
  // to read it back rather than re-decide it. The default mirrors
  // DEFAULT_MAX_PROVIDER_CALLS_PER_ACTOR in src/task-run.js; a mission stored
  // before actors existed keeps that share without saying anything about itself.
  Object.freeze({ id: 24, name: 'actor_provider_share', statements: Object.freeze([
    'ALTER TABLE task_runs ADD COLUMN max_provider_calls_per_actor INTEGER NOT NULL DEFAULT 6;',
  ]) }),
  Object.freeze({ id: 25, name: 'actor_plan_revisions', statements: Object.freeze([
    `CREATE TABLE actor_plan_revisions (
      execution_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      tasks_json TEXT NOT NULL,
      author_agent_id TEXT,
      source TEXT NOT NULL CHECK(source IN ('planner','authored','regenerated')),
      created_at TEXT NOT NULL,
      approved_at TEXT,
      PRIMARY KEY(execution_id, revision)
    ) STRICT;`,
    'CREATE INDEX actor_plan_revisions_latest ON actor_plan_revisions(execution_id, revision DESC);',
  ]) }),
  // Id 16 is reserved for the per-execution backend choice (mission sandbox
  // selection). Take a later id, or claim 16 explicitly, instead of colliding.

  // Managing a Team that already exists: a pin the sidebar can render after a
  // restart, and a revision counter that is the token two writers compare
  // against. Both default to the state a stored Team is already in, so nothing
  // existing moves.
  Object.freeze({ id: 26, name: 'team_pin_and_revision', statements: Object.freeze([
    'ALTER TABLE teams ADD COLUMN pinned_at TEXT;',
    'ALTER TABLE teams ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);',
    'CREATE INDEX teams_pinned ON teams(pinned_at, created_at) WHERE pinned_at IS NOT NULL;',
  ]) }),
  // The composition of a Team can only grow, so "who joined, and when" has to be
  // a record rather than a guess made later from the member list. Rows belong to
  // the Team: deleting it deletes its trail, which is what keeps the trail from
  // outliving the thing it describes.
  Object.freeze({ id: 27, name: 'team_composition_events', statements: Object.freeze([
    `CREATE TABLE team_events (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('created','renamed','description_changed','member_added','leader_set','leader_cleared','pinned','unpinned','archived','restored')),
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;`,
    // SQLite refuses rowid inside an index, so the trail orders itself by insertion
    // and the index only bounds the rows a single Team owns.
    'CREATE INDEX team_events_team ON team_events(team_id);',
  ]) }),
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
