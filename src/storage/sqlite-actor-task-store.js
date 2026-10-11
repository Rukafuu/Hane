/**
 * The plan an actor execution is working through, one row per task.
 *
 * Statuses are the scheduler's vocabulary, not the model's: `pending` waits for
 * a predecessor, `ready` waits for a free slot, `running` is a turn somebody was
 * handed, and `blocked` is the one state no agent asked for — a task stranded by
 * a predecessor that failed, or held because its effect cannot be safely
 * repeated. The last two matter for the same reason: a mission that resumes must
 * be able to tell "still in flight" from "left behind by a crash".
 *
 * A row claims its lease the way a mailbox message does. The mission may be
 * interrupted mid-generation, and `running` with an expired lease is exactly the
 * state `reconcileOnResume` reads: below the attempt ceiling the task goes back
 * to `ready`, at it the task fails rather than looping forever.
 */

export const ACTOR_TASK_STATUSES = Object.freeze(['pending', 'ready', 'running', 'completed', 'failed', 'blocked']);
/** Below this a released task runs again; at it, the task is declared failed. */
export const MAX_TASK_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 120_000;
const MAX_TITLE_LENGTH = 200;

const cleanText = (value, label, max) => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${label} must be a single-line string up to ${max} characters.`);
  }
  return value.trim();
};
const cleanOptional = (value, label, max) => (value === null || value === undefined ? null : cleanText(value, label, max));
const stamp = (now) => (now === undefined ? new Date().toISOString() : now);
const isoIn = (from, ms) => new Date(Date.parse(from) + ms).toISOString();

const rowOf = (row) => ({
  executionId: row.execution_id,
  id: row.id,
  title: row.title,
  assigneeAgentId: row.assignee_agent_id,
  dependsOn: JSON.parse(row.depends_on_json),
  status: row.status,
  resultKey: row.result_key,
  note: row.note,
  claimOwner: row.claim_owner,
  leaseExpiresAt: row.lease_expires_at,
  attempts: row.attempts,
  updatedAt: row.updated_at,
});

export class SqliteActorTaskStore {
  constructor({ database }) {
    if (!database?.prepare) throw new TypeError('a SQLite database handle is required.');
    this.database = database;
  }

  /**
   * Books the plan. A retry lands nothing new: a mission resumed after a crash
   * re-sends the same plan, and clobbering the rows would rewind the tasks that
   * already finished.
   * @returns {{ inserted: number, tasks: object[] }}
   */
  create({ executionId, tasks, now }) {
    const at = stamp(now);
    const execution = cleanText(executionId, 'executionId', 128);
    if (!Array.isArray(tasks) || tasks.length === 0) throw new TypeError('an actor plan needs at least one task.');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const statement = this.database.prepare(`
        INSERT INTO actor_tasks (execution_id, id, title, assignee_agent_id, depends_on_json, status, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(execution_id, id) DO NOTHING
      `);
      let inserted = 0;
      for (const raw of tasks) {
        const fields = {
          id: cleanText(raw.id, 'task id', 128),
          title: cleanText(raw.title, 'task title', MAX_TITLE_LENGTH),
          assignee: cleanText(raw.assigneeAgentId, 'assigneeAgentId', 128),
          dependsOn: JSON.stringify((raw.dependsOn ?? []).map((id) => cleanText(id, 'dependsOn entry', 128))),
        };
        inserted += statement.run(execution, fields.id, fields.title, fields.assignee, fields.dependsOn, at).changes;
      }
      this.database.exec('COMMIT');
      return { inserted, tasks: this.list({ executionId: execution }) };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  list({ executionId }) {
    return this.database.prepare('SELECT * FROM actor_tasks WHERE execution_id = ? ORDER BY id')
      .all(cleanText(executionId, 'executionId', 128)).map(rowOf);
  }

  get({ executionId, id }) {
    const row = this.database.prepare('SELECT * FROM actor_tasks WHERE execution_id = ? AND id = ?')
      .get(cleanText(executionId, 'executionId', 128), cleanText(id, 'task id', 128));
    return row ? rowOf(row) : null;
  }

  /**
   * Takes one task for one actor. The expected status is part of the write, so a
   * scheduler that decided on stale information cannot start a second turn over
   * the same task.
   * @returns {object|null} the row under its new lease, or null when it was not ours
   */
  claim({ executionId, id, owner, leaseMs = DEFAULT_LEASE_MS, now }) {
    const at = stamp(now);
    const claimOwner = cleanText(owner, 'owner', 128);
    if (!Number.isFinite(leaseMs) || leaseMs < 1_000) throw new TypeError('leaseMs must be at least 1000.');
    const result = this.database.prepare(`
      UPDATE actor_tasks
         SET status = 'running', claim_owner = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
       WHERE execution_id = ? AND id = ? AND status IN ('pending','ready') AND attempts < ?
    `).run(claimOwner, isoIn(at, leaseMs), at, cleanText(executionId, 'executionId', 128), cleanText(id, 'task id', 128), MAX_TASK_ATTEMPTS);
    if (result.changes === 0) return null;
    return this.get({ executionId, id });
  }

  /**
   * Confirms the turn's answer. Only the owner named on the row may close it, so
   * a scheduler whose lease already expired cannot mark work it no longer holds.
   */
  complete({ executionId, id, owner, resultKey = null, note = null, now }) {
    return this.#settle({
      executionId, id, owner,
      to: 'completed',
      resultKey: cleanOptional(resultKey, 'resultKey', 120),
      note: cleanOptional(note, 'note', MAX_TITLE_LENGTH),
      at: stamp(now),
    });
  }

  /** The turn ran and the answer did not come: the task is not waiting for anything. */
  fail({ executionId, id, owner, reason, now }) {
    return this.#settle({
      executionId, id, owner,
      to: 'failed',
      resultKey: null,
      note: cleanText(reason, 'reason', MAX_TITLE_LENGTH),
      at: stamp(now),
    });
  }

  #settle({ executionId, id, owner, to, resultKey, note, at }) {
    const execution = cleanText(executionId, 'executionId', 128);
    const task = cleanText(id, 'task id', 128);
    const result = this.database.prepare(`
      UPDATE actor_tasks
         SET status = ?, result_key = ?, note = ?, claim_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE execution_id = ? AND id = ? AND status = 'running' AND claim_owner = ?
    `).run(to, resultKey, note, at, execution, task, cleanText(owner, 'owner', 128));
    if (result.changes === 0) return null;
    return this.get({ executionId: execution, id: task });
  }

  /**
   * Gives a running task back. Below the attempt ceiling it returns to `ready`
   * for another turn; at it the task fails with the reason the user reads, rather
   * than being handed out a fourth time.
   */
  release({ executionId, id, owner, reason = 'turn_released', maxAttempts = MAX_TASK_ATTEMPTS, now }) {
    const at = stamp(now);
    const execution = cleanText(executionId, 'executionId', 128);
    const task = cleanText(id, 'task id', 128);
    const claimOwner = cleanText(owner, 'owner', 128);
    const result = this.database.prepare(`
      UPDATE actor_tasks
         SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'ready' END,
             note = CASE WHEN attempts >= ? THEN ? ELSE note END,
             claim_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE execution_id = ? AND id = ? AND status = 'running' AND claim_owner = ?
    `).run(maxAttempts, maxAttempts, cleanText(reason, 'reason', MAX_TITLE_LENGTH), at, execution, task, claimOwner);
    if (result.changes === 0) return null;
    return this.get({ executionId: execution, id: task });
  }

  /**
   * Renews the lease of a turn still in the air. A generation longer than the
   * lease is not a dead one, and a scheduler that requeues its own live task
   * would run the same agent on the same task twice.
   */
  renew({ executionId, id, owner, leaseMs = DEFAULT_LEASE_MS, now }) {
    const at = stamp(now);
    if (!Number.isFinite(leaseMs) || leaseMs < 1_000) throw new TypeError('leaseMs must be at least 1000.');
    const result = this.database.prepare(`
      UPDATE actor_tasks SET lease_expires_at = ?, updated_at = ?
       WHERE execution_id = ? AND id = ? AND status = 'running' AND claim_owner = ?
    `).run(isoIn(at, leaseMs), at, cleanText(executionId, 'executionId', 128), cleanText(id, 'task id', 128), cleanText(owner, 'owner', 128));
    return result.changes === 1;
  }

  /** Says which tasks have no unmet predecessor left, so the UI shows a queue and not a wall. */
  markReady({ executionId, ids, now }) {
    const at = stamp(now);
    const execution = cleanText(executionId, 'executionId', 128);
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const statement = this.database.prepare("UPDATE actor_tasks SET status = 'ready', updated_at = ? WHERE execution_id = ? AND id = ? AND status = 'pending'");
    let marked = 0;
    for (const id of ids) marked += statement.run(at, execution, cleanText(id, 'task id', 128)).changes;
    return marked;
  }

  /**
   * Strands tasks nobody was running: a predecessor failed, or reconciliation
   * found an effect whose outcome is unknown and will not be repeated. The owner
   * is not checked because there is no longer one — this is the scheduler's hand,
   * and `note` says why.
   */
  block({ executionId, ids, reason, now }) {
    const at = stamp(now);
    const execution = cleanText(executionId, 'executionId', 128);
    const note = cleanText(reason, 'reason', MAX_TITLE_LENGTH);
    const statement = this.database.prepare(`
      UPDATE actor_tasks SET status = 'blocked', note = ?, claim_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE execution_id = ? AND id = ? AND status IN ('pending','ready')
    `);
    let blocked = 0;
    for (const id of ids ?? []) blocked += statement.run(note, at, execution, cleanText(id, 'task id', 128)).changes;
    return blocked;
  }

  /**
   * Stops a task from being run again, from any state except a settled one.
   * Reconciliation uses it for the one case a lease cannot decide: a turn that
   * wrote to the machine and died before saying what happened. Retrying that would
   * repeat the effect, so the task is held and the mission asks the user.
   */
  hold({ executionId, ids, reason, now }) {
    const at = stamp(now);
    const execution = cleanText(executionId, 'executionId', 128);
    const note = cleanText(reason, 'reason', MAX_TITLE_LENGTH);
    const statement = this.database.prepare(`
      UPDATE actor_tasks SET status = 'blocked', note = ?, claim_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE execution_id = ? AND id = ? AND status IN ('pending','ready','running')
    `);
    let held = 0;
    for (const id of ids ?? []) held += statement.run(note, at, execution, cleanText(id, 'task id', 128)).changes;
    return held;
  }

  /**
   * Reconciles turns that died mid-generation: a lease that outlived its holder
   * goes back to `ready`, and one already at the attempt ceiling fails. Idempotent,
   * safe to call on resume and on every scheduler tick.
   */
  recoverExpiredLeases({ executionId, now }) {
    const at = stamp(now);
    const execution = cleanText(executionId, 'executionId', 128);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const scope = "execution_id = ? AND status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?";
      const failed = this.database.prepare(`
        UPDATE actor_tasks
           SET status = 'failed', note = 'lease_exhausted', claim_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE ${scope} AND attempts >= ?
        RETURNING id
      `).all(at, execution, at, MAX_TASK_ATTEMPTS).map((row) => row.id);
      const released = this.database.prepare(`
        UPDATE actor_tasks
           SET status = 'ready', claim_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE ${scope} AND attempts < ?
        RETURNING id
      `).all(at, execution, at, MAX_TASK_ATTEMPTS).map((row) => row.id);
      this.database.exec('COMMIT');
      return { released, failed };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** What the badge and the completion test read, in one pass. */
  counts({ executionId }) {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
             SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
             SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
        FROM actor_tasks WHERE execution_id = ?
    `).get(cleanText(executionId, 'executionId', 128));
    return {
      total: row.total,
      pending: row.pending ?? 0,
      ready: row.ready ?? 0,
      running: row.running ?? 0,
      completed: row.completed ?? 0,
      failed: row.failed ?? 0,
      blocked: row.blocked ?? 0,
    };
  }
}
