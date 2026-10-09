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
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const stored = this.database.prepare('SELECT provider_calls AS providerCalls FROM task_runs WHERE id = ?').get(task.id);
      if (stored && task.providerCalls < stored.providerCalls) {
        throw new Error(`cannot persist a task with fewer provider calls (${task.providerCalls}) than already stored (${stored.providerCalls}).`);
      }
      this.database.prepare(`
        INSERT INTO task_runs (id, objective, status, max_provider_calls, provider_calls, provider_label)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          objective = excluded.objective,
          status = excluded.status,
          max_provider_calls = excluded.max_provider_calls,
          provider_calls = excluded.provider_calls,
          provider_label = excluded.provider_label
      `).run(task.id, task.objective, task.status, task.maxProviderCalls, task.providerCalls, task.providerLabel ?? null);
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
      SELECT r.id, r.objective, r.status,
             r.max_provider_calls AS maxProviderCalls,
             r.provider_calls AS providerCalls,
             COALESCE(MAX(a.at), '') AS updatedAt
      FROM task_runs r
      LEFT JOIN task_audit_entries a ON a.task_id = r.id
      GROUP BY r.id
      ORDER BY updatedAt DESC, r.id DESC
    `).all();
  }

  findById(id) {
    const task = this.database.prepare(`
      SELECT id, objective, status, max_provider_calls AS maxProviderCalls, provider_calls AS providerCalls,
             provider_label AS providerLabel
      FROM task_runs WHERE id = ?
    `).get(id);
    if (!task) return null;
    const outputs = Object.fromEntries(this.database.prepare('SELECT role, content FROM task_outputs WHERE task_id = ? ORDER BY role').all(id).map(({ role, content }) => [role, content]));
    const audit = this.database.prepare('SELECT at, type, detail_json AS detailJson FROM task_audit_entries WHERE task_id = ? ORDER BY ordinal').all(id)
      .map(({ at, type, detailJson }) => ({ at, type, detail: JSON.parse(detailJson) }));
    return { ...task, outputs, audit };
  }

  close() { this.database.close(); }
}
