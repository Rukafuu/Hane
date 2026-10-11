import { assertActorDag } from '../actors/dag.js';

/** Append-only candidates shown to the human before an actor scheduler can run. */
export class SqliteActorPlanStore {
  constructor({ database }) { this.database = database; }

  create({ executionId, tasks, authorAgentId = null, source = 'planner', createdAt = new Date().toISOString() }) {
    const normalized = assertActorDag({ tasks, agentIds: [...new Set(tasks.map((task) => task.assigneeAgentId))] });
    const revision = (this.database.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM actor_plan_revisions WHERE execution_id = ?').get(executionId).revision ?? 0) + 1;
    this.database.prepare(`INSERT INTO actor_plan_revisions (execution_id, revision, tasks_json, author_agent_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(executionId, revision, JSON.stringify(normalized), authorAgentId, source, createdAt);
    return this.get({ executionId, revision });
  }

  get({ executionId, revision = null }) {
    const row = revision === null
      ? this.database.prepare('SELECT * FROM actor_plan_revisions WHERE execution_id = ? ORDER BY revision DESC LIMIT 1').get(executionId)
      : this.database.prepare('SELECT * FROM actor_plan_revisions WHERE execution_id = ? AND revision = ?').get(executionId, revision);
    return row ? hydrate(row) : null;
  }

  approve({ executionId, approvedAt = new Date().toISOString() }) {
    const plan = this.get({ executionId });
    if (!plan) return null;
    this.database.prepare('UPDATE actor_plan_revisions SET approved_at = ? WHERE execution_id = ? AND revision = ? AND approved_at IS NULL').run(approvedAt, executionId, plan.revision);
    return this.get({ executionId, revision: plan.revision });
  }

  count({ executionId }) { return this.database.prepare('SELECT COUNT(*) AS count FROM actor_plan_revisions WHERE execution_id = ?').get(executionId).count; }
}

function hydrate(row) {
  return Object.freeze({ executionId: row.execution_id, revision: row.revision, tasks: JSON.parse(row.tasks_json), authorAgentId: row.author_agent_id, source: row.source, createdAt: row.created_at, approvedAt: row.approved_at });
}