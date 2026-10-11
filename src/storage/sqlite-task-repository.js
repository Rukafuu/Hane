import { assertExecutionPlan } from '../teams/execution-plan.js';
import { openHaneDatabase } from './sqlite-database.js';
import { migrate } from './migrations.js';

export class SqliteTaskRepository {
  constructor(filenameOrDatabase = 'agent-orchestrator.sqlite') {
    const database = typeof filenameOrDatabase === 'string'
      ? openHaneDatabase(filenameOrDatabase)
      : filenameOrDatabase?.database;
    if (!database) throw new TypeError('a SQLite database handle or filename is required.');
    this.database = migrate(database);
  }

  save(task) {
    const planJson = task.executionPlan == null ? null : JSON.stringify(assertExecutionPlan(task.executionPlan,task.teamId));
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const stored = this.database.prepare('SELECT provider_calls AS providerCalls, tool_calls AS toolCalls, team_id AS teamId, execution_plan_json AS planJson FROM task_runs WHERE id = ?').get(task.id);
      if (stored && (task.teamId ?? null) !== stored.teamId) throw new Error('cannot change the team of a persisted execution.');
      if (stored && stored.planJson !== planJson) throw new Error('cannot change the execution plan of a persisted mission.');
      if (stored && task.providerCalls < stored.providerCalls) {
        throw new Error(`cannot persist a task with fewer provider calls (${task.providerCalls}) than already stored (${stored.providerCalls}).`);
      }
      if (stored && task.toolCalls < stored.toolCalls) {
        throw new Error(`cannot persist a task with fewer tool calls (${task.toolCalls}) than already stored (${stored.toolCalls}).`);
      }
      // The per-actor share is deliberately absent from the conflict update: it is
      // what the user authorized when the mission was created, and a save whose
      // snapshot happens to omit it must narrow nothing and widen nothing.
      this.database.prepare(`
        INSERT INTO task_runs (id, objective, status, max_provider_calls, provider_calls, provider_label, capability_grants_json, workspace_root, max_tool_calls, tool_calls, team_id, execution_plan_json, mode, max_provider_calls_per_actor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          objective = excluded.objective,
          status = excluded.status,
          max_provider_calls = excluded.max_provider_calls,
          provider_calls = excluded.provider_calls,
          provider_label = excluded.provider_label,
          capability_grants_json = excluded.capability_grants_json,
          workspace_root = excluded.workspace_root,
          max_tool_calls = excluded.max_tool_calls,
          tool_calls = excluded.tool_calls,
          team_id = excluded.team_id,
          execution_plan_json = excluded.execution_plan_json,
          mode = excluded.mode
      `).run(
        task.id,
        task.objective,
        task.status,
        task.maxProviderCalls,
        task.providerCalls,
        task.providerLabel ?? null,
        JSON.stringify(task.capabilityGrants ?? []),
        task.workspaceRoot ?? null,
        task.maxToolCalls ?? 24,
        task.toolCalls ?? 0,
        task.teamId ?? null,
        planJson,
        // A snapshot from before actors existed has no mode. Writing the default
        // rather than the stored value keeps a sequential mission sequential.
        task.mode === 'actor' ? 'actor' : 'sequential',
        task.maxProviderCallsPerActor ?? 6,
      );
      const outputStatement = this.database.prepare('INSERT OR REPLACE INTO task_outputs (task_id, role, content) VALUES (?, ?, ?)');
      for (const [role, content] of Object.entries(task.outputs)) outputStatement.run(task.id, role, content);
      const base = this.database.prepare('SELECT COALESCE(MAX(ordinal), -1) AS base FROM task_audit_entries WHERE task_id = ?').get(task.id).base;
      if (base + 1 > task.audit.length) {
        throw new Error('cannot persist a task whose audit trail is shorter than the stored history.');
      }
      const auditStatement = this.database.prepare('INSERT INTO task_audit_entries (task_id, ordinal, at, type, detail_json) VALUES (?, ?, ?, ?, ?)');
      task.audit.slice(base + 1).forEach((entry, index) => auditStatement.run(task.id, base + 1 + index, entry.at, entry.type, JSON.stringify(entry.detail)));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  list() {
    return this.database.prepare(`
      SELECT r.id, r.objective, r.status, r.team_id AS teamId, r.execution_plan_json AS planJson,
             r.max_provider_calls AS maxProviderCalls,
             r.provider_calls AS providerCalls,
             COALESCE(MAX(a.at), '') AS updatedAt
      FROM task_runs r
      LEFT JOIN task_audit_entries a ON a.task_id = r.id
      GROUP BY r.id
      -- Two missions finishing inside the same millisecond tie on updatedAt, and the
      -- TEXT id is not a clock: sorting by it made the newest mission depend on which
      -- name comes later in the alphabet. rowid is the insert order and stays put
      -- across upserts, so the tie resolves to "created later, listed first".
      ORDER BY updatedAt DESC, r.rowid DESC
    `).all().map(row => {
      if (row.planJson !== null) {
        const plan=assertExecutionPlan(JSON.parse(row.planJson),row.teamId);
        row.executionPlan={version:plan.version,kind:plan.kind,teamId:plan.teamId,roles:Object.fromEntries(Object.entries(plan.roles).map(([role,{agentId,name,providerLabel,model}])=>[role,{agentId,name,providerLabel,model}]))};
      }
      delete row.planJson;
      if (row.teamId === null) delete row.teamId;
      return row;
    });
  }

  findById(id) {
    const task = this.database.prepare(`
      SELECT id, objective, status, max_provider_calls AS maxProviderCalls, provider_calls AS providerCalls,
             provider_label AS providerLabel, capability_grants_json AS capabilityGrantsJson,
             workspace_root AS workspaceRoot, max_tool_calls AS maxToolCalls, tool_calls AS toolCalls, team_id AS teamId, execution_plan_json AS planJson, mode,
             max_provider_calls_per_actor AS maxProviderCallsPerActor
      FROM task_runs WHERE id = ?
    `).get(id);
    if (!task) return null;
    const outputs = Object.fromEntries(this.database.prepare('SELECT role, content FROM task_outputs WHERE task_id = ? ORDER BY role').all(id).map(({ role, content }) => [role, content]));
    const audit = this.database.prepare('SELECT at, type, detail_json AS detailJson FROM task_audit_entries WHERE task_id = ? ORDER BY ordinal').all(id)
      .map(({ at, type, detailJson }) => ({ at, type, detail: JSON.parse(detailJson) }));
    if (task.planJson != null) task.executionPlan = assertExecutionPlan(JSON.parse(task.planJson),task.teamId);
    delete task.planJson;
    if (task.teamId === null) delete task.teamId;
    return { ...task, capabilityGrants: parseCapabilityGrants(task.capabilityGrantsJson), outputs, audit };
  }

  close() { this.database.close(); }
}

function parseCapabilityGrants(value) {
  try {
    const grants = JSON.parse(value ?? '[]');
    if (!Array.isArray(grants)) throw new TypeError('not an array');
    return grants;
  } catch {
    throw new Error('Stored capability grants are invalid.');
  }
}
