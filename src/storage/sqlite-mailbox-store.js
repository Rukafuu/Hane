import { randomUUID } from 'node:crypto';

/**
 * The per-agent inbox. One row is one directed message, and the row itself is
 * the delivery record: `pending` means nobody has taken it, `processing` means
 * exactly one claim holds it under a lease, `processed` means that claim
 * confirmed its work, and `dropped` means it will never be handed out again.
 *
 * Delivery is at-least-once, and says so. A claim reserves a message so two
 * turns of the same agent cannot read it twice, but a message whose claim dies
 * mid-generation goes back to `pending` under the same id, because the
 * alternative — calling it processed before the work is done — is how a peer's
 * discovery silently disappears.
 */

export const MESSAGE_STATUSES = Object.freeze(['pending', 'processing', 'processed', 'dropped']);
export const MESSAGE_PRIORITIES = Object.freeze(['normal', 'high']);
/** A claim that outlives this many attempts is dropped rather than retried again. */
export const MAX_DELIVERY_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 120_000;
const MAX_CLAIM_LIMIT = 32;
const MAX_BODY_LENGTH = 16_000;

const requiredText = (value, label, max) => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new TypeError(`${label} must be a non-empty string up to ${max} characters.`);
  }
  return value.trim();
};
const stamp = (now) => (now === undefined ? new Date().toISOString() : now);
const isoIn = (from, ms) => new Date(Date.parse(from) + ms).toISOString();

const rowOf = (row) => ({
  id: row.id,
  executionId: row.execution_id,
  recipientAgentId: row.recipient_agent_id,
  senderAgentId: row.sender_agent_id,
  kind: row.kind,
  body: row.body,
  hop: row.hop,
  priority: row.priority,
  replyTo: row.reply_to,
  status: row.status,
  dropReason: row.drop_reason,
  attempts: row.attempts,
  claimOwner: row.claim_owner,
  leaseExpiresAt: row.lease_expires_at,
  createdAt: row.created_at,
  processedAt: row.processed_at,
});

export class SqliteMailboxStore {
  constructor({ database }) {
    if (!database?.prepare) throw new TypeError('a SQLite database handle is required.');
    this.database = database;
  }

  /**
   * Records a message for one recipient. A duplicate `dedupeKey` is not an
   * error: a retried send must land once, so the already stored row comes back
   * with `duplicate: true` and the caller publishes nothing new.
   * @returns {{ ok: true, duplicate: boolean, message: object }}
   */
  deliver({ executionId, recipientAgentId, senderAgentId, kind, body, hop = 0, priority = 'normal', replyTo = null, dedupeKey = null, now }) {
    const at = stamp(now);
    const clean = {
      executionId: requiredText(executionId, 'executionId', 128),
      recipientAgentId: requiredText(recipientAgentId, 'recipientAgentId', 128),
      senderAgentId: requiredText(senderAgentId, 'senderAgentId', 128),
      kind: requiredText(kind, 'kind', 48),
      body: requiredText(body, 'body', MAX_BODY_LENGTH),
    };
    if (!Number.isInteger(hop) || hop < 0 || hop > 16) throw new TypeError('hop must be a non-negative integer.');
    if (!MESSAGE_PRIORITIES.includes(priority)) throw new TypeError(`priority must be one of ${MESSAGE_PRIORITIES.join(', ')}.`);
    if (clean.recipientAgentId === clean.senderAgentId) throw new TypeError('an agent cannot message itself.');
    if (dedupeKey !== null) requiredText(dedupeKey, 'dedupeKey', 160);
    if (replyTo !== null && !Number.isInteger(replyTo)) throw new TypeError('replyTo must be an integer message id or null.');

    const statement = this.database.prepare(`
      INSERT INTO actor_mailbox (execution_id, recipient_agent_id, sender_agent_id, kind, body, hop, priority, reply_to, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `);
    const result = statement.run(clean.executionId, clean.recipientAgentId, clean.senderAgentId, clean.kind, clean.body, hop, priority, replyTo, dedupeKey, at);
    if (result.changes === 0) {
      return { ok: true, duplicate: true, message: this.byId(this.database.prepare('SELECT id FROM actor_mailbox WHERE dedupe_key = ?').get(dedupeKey).id) };
    }
    return { ok: true, duplicate: false, message: this.byId(result.lastInsertRowid) };
  }

  byId(id) {
    const row = this.database.prepare('SELECT * FROM actor_mailbox WHERE id = ?').get(id);
    return row ? rowOf(row) : null;
  }

  /**
   * Reserves up to `limit` pending messages for one agent, highest priority
   * first and oldest first within a priority. The reservation is one statement,
   * so no second claim can read the same rows between the pick and the mark.
   * @returns {object[]} each entry carries the `claimToken` the ack needs
   */
  claim({ executionId, recipientAgentId, limit = 8, owner, leaseMs = DEFAULT_LEASE_MS, now }) {
    const at = stamp(now);
    const count = Math.min(Math.max(1, Math.trunc(limit)), MAX_CLAIM_LIMIT);
    const claimToken = randomUUID();
    const cleanOwner = requiredText(owner, 'owner', 128);
    if (!Number.isFinite(leaseMs) || leaseMs < 1_000) throw new TypeError('leaseMs must be at least 1000.');

    this.database.exec('BEGIN IMMEDIATE');
    try {
      // The order is read first and re-applied afterwards, because the rows an
      // `UPDATE ... WHERE id IN (SELECT ... ORDER BY ...)` returns come back in
      // table order: a priority sort living only in the subselect would drain
      // the oldest message first and leave the user's urgent one at the back.
      const picked = this.database.prepare(`
        SELECT id FROM actor_mailbox
         WHERE execution_id = ? AND recipient_agent_id = ? AND status = 'pending'
         ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END, id
         LIMIT ?
      `).all(executionId, recipientAgentId, count).map((row) => row.id);
      if (picked.length === 0) {
        this.database.exec('COMMIT');
        return [];
      }
      const rows = this.database.prepare(`
        UPDATE actor_mailbox
           SET status = 'processing', claim_token = ?, claim_owner = ?, lease_expires_at = ?, attempts = attempts + 1
         WHERE id IN (${picked.map(() => '?').join(', ')})
        RETURNING *
      `).all(claimToken, cleanOwner, isoIn(at, leaseMs), ...picked);
      this.database.exec('COMMIT');
      const rank = new Map(picked.map((id, index) => [id, index]));
      return rows
        .sort((left, right) => rank.get(left.id) - rank.get(right.id))
        .map((row) => ({ ...rowOf(row), claimToken }));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Confirms reserved work. The token is the whole point: a turn that survived
   * its own lease cannot mark a message processed after someone else claimed it.
   */
  ack({ id, claimToken, now }) {
    if (claimToken == null) throw new TypeError('ack requires the claimToken the message was reserved with.');
    const result = this.database.prepare(`
      UPDATE actor_mailbox SET status = 'processed', processed_at = ?
       WHERE id = ? AND status = 'processing' AND claim_token = ?
    `).run(stamp(now), id, claimToken);
    return result.changes > 0;
  }

  /**
   * Gives reserved work back. Below the attempt ceiling the row returns to
   * `pending` with its id and its token cleared, so a late ack from the dead
   * claim fails; at the ceiling it is dropped and stays visible for the audit.
   * @returns {{ ok: boolean, status: string }} `ok: false` when the token no
   *   longer owns the row — the same refusal rule as `ack`.
   */
  nack({ id, claimToken, reason = null, now }) {
    if (claimToken == null) throw new TypeError('nack requires the claimToken the message was reserved with.');
    const result = this.database.prepare(`
      UPDATE actor_mailbox
         SET status = CASE WHEN attempts >= ? THEN 'dropped' ELSE 'pending' END,
             drop_reason = CASE WHEN attempts >= ? THEN ? ELSE drop_reason END,
             claim_token = NULL,
             lease_expires_at = NULL
       WHERE id = ? AND status = 'processing' AND claim_token = ?
    `).run(MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_ATTEMPTS, requiredText(reason ?? 'claim_released', 'reason', 120), id, claimToken);
    if (result.changes === 0) return { ok: false, status: this.byId(id)?.status ?? 'unknown' };
    const row = this.database.prepare('SELECT status FROM actor_mailbox WHERE id = ?').get(id);
    return { ok: true, status: row.status };
  }

  /**
   * Reconciles claims that outlived their holder: expired leases go back to
   * `pending`, and the ones already at the attempt ceiling are dropped instead
   * of requeued forever. Called on resume and on a scheduler tick, idempotent.
   */
  recoverExpiredLeases({ executionId = null, now } = {}) {
    const at = stamp(now);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const scope = executionId === null ? 'lease_expires_at IS NOT NULL AND lease_expires_at <= ?' : 'execution_id = ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?';
      const args = executionId === null ? [at] : [executionId, at];
      const dropped = this.database.prepare(`
        UPDATE actor_mailbox
           SET status = 'dropped', drop_reason = 'lease_exhausted', claim_token = NULL, lease_expires_at = NULL
         WHERE status = 'processing' AND attempts >= ? AND ${scope}
        RETURNING id, execution_id AS executionId, recipient_agent_id AS recipientAgentId, sender_agent_id AS senderAgentId
      `).all(MAX_DELIVERY_ATTEMPTS, ...args);
      const requeued = this.database.prepare(`
        UPDATE actor_mailbox
           SET status = 'pending', claim_token = NULL, lease_expires_at = NULL
         WHERE status = 'processing' AND attempts < ? AND ${scope}
        RETURNING id, execution_id AS executionId, recipient_agent_id AS recipientAgentId, sender_agent_id AS senderAgentId
      `).all(MAX_DELIVERY_ATTEMPTS, ...args);
      this.database.exec('COMMIT');
      return { requeued, dropped };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** What an agent has waiting, for the badge and for the drain decision. */
  peek({ executionId, recipientAgentId }) {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS pending,
             SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) AS high,
             MIN(created_at) AS oldestQueuedAt
        FROM actor_mailbox
       WHERE execution_id = ? AND recipient_agent_id = ? AND status = 'pending'
    `).get(executionId, recipientAgentId);
    return { pending: row.pending, high: row.high ?? 0, oldestQueuedAt: row.oldestQueuedAt ?? null };
  }

  /** The inbox as the user reads it, including the messages that were dropped. */
  list({ executionId, agentId = null, status = null, limit = 200 }) {
    const clauses = ['execution_id = ?'];
    const args = [executionId];
    if (agentId !== null) { clauses.push('(recipient_agent_id = ? OR sender_agent_id = ?)'); args.push(agentId, agentId); }
    if (status !== null) {
      if (!MESSAGE_STATUSES.includes(status)) throw new TypeError(`status must be one of ${MESSAGE_STATUSES.join(', ')}.`);
      clauses.push('status = ?');
      args.push(status);
    }
    args.push(Math.min(Math.max(1, Math.trunc(limit)), 500));
    return this.database.prepare(`
      SELECT * FROM actor_mailbox WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?
    `).all(...args).map(rowOf);
  }

  /**
   * Messages this ordered pair has carried. Refusals never reach the table, so
   * every row here was delivered, which is exactly what the per-pair cap counts.
   */
  countBetween({ executionId, fromAgentId, toAgentId }) {
    return this.database.prepare('SELECT COUNT(*) AS count FROM actor_mailbox WHERE execution_id = ? AND sender_agent_id = ? AND recipient_agent_id = ?')
      .get(executionId, fromAgentId, toAgentId).count;
  }

  /** How much this agent has actually taken in — the inbound cap's counter. */
  countProcessed({ executionId, recipientAgentId }) {
    return this.database.prepare("SELECT COUNT(*) AS count FROM actor_mailbox WHERE execution_id = ? AND recipient_agent_id = ? AND status = 'processed'")
      .get(executionId, recipientAgentId).count;
  }
}
