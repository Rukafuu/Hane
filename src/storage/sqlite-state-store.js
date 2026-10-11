/**
 * The shared board. Every entry carries a revision, and a write only lands if
 * the writer saw the revision it is replacing — which is what keeps two agents
 * working at the same time from overwriting each other's result. The revision
 * history is kept, so `state_conflict` can be explained rather than merely
 * noticed, and an artifact row can be tied to the effect that produced it.
 *
 * Conflict is a return value, not a thrown error: an actor that loses a race has
 * to re-read and decide, and a policy that throws is a policy nobody tests.
 */

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_KEY_LENGTH = 120;
const MAX_PATH_LENGTH = 512;
const MAX_VALUE_BYTES = 200_000;

const cleanKey = (key) => {
  if (typeof key !== 'string' || key.trim() === '' || key.length > MAX_KEY_LENGTH || /[\r\n\0]/.test(key)) {
    throw new TypeError(`state key must be a single-line string up to ${MAX_KEY_LENGTH} characters.`);
  }
  return key.trim();
};
const cleanText = (value, label, max) => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${label} must be a single-line string up to ${max} characters.`);
  }
  return value.trim();
};
const stamp = (now) => (now === undefined ? new Date().toISOString() : now);

const encode = (value, label) => {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} must be JSON-serializable.`);
  }
  if (json === undefined) throw new TypeError(`${label} must not be undefined.`);
  if (json.length > MAX_VALUE_BYTES) throw new TypeError(`${label} is larger than ${MAX_VALUE_BYTES} bytes of JSON.`);
  return json;
};

const artifactOf = (row) => ({
  id: row.id,
  executionId: row.execution_id,
  taskId: row.task_id,
  agentId: row.agent_id,
  kind: row.kind,
  path: row.path,
  bytes: row.bytes,
  sha256: row.sha256,
  effectKey: row.effect_key,
  createdAt: row.created_at,
});

export class SqliteStateStore {
  constructor({ database }) {
    if (!database?.prepare) throw new TypeError('a SQLite database handle is required.');
    this.database = database;
  }

  /**
   * The current value of one key. An unseen key reads as revision 0 with no
   * value, which is also the `expectedRevision` a first writer must claim.
   */
  read({ executionId, key }) {
    const current = this.database.prepare('SELECT revision FROM task_state_current WHERE execution_id = ? AND state_key = ?')
      .get(executionId, cleanKey(key));
    if (!current) return { revision: 0, value: null };
    const stored = this.database.prepare('SELECT value_json AS valueJson, writer_agent_id AS writerAgentId, created_at AS createdAt FROM task_state_revisions WHERE execution_id = ? AND state_key = ? AND revision = ?')
      .get(executionId, cleanKey(key), current.revision);
    return { revision: current.revision, value: stored ? JSON.parse(stored.valueJson) : null, writerAgentId: stored?.writerAgentId ?? null, createdAt: stored?.createdAt ?? null };
  }

  readRevision({ executionId, key, revision }) {
    if (!Number.isInteger(revision) || revision < 1) throw new TypeError('revision must be a positive integer.');
    const row = this.database.prepare('SELECT revision, value_json AS valueJson, writer_agent_id AS writerAgentId, created_at AS createdAt FROM task_state_revisions WHERE execution_id = ? AND state_key = ? AND revision = ?')
      .get(executionId, cleanKey(key), revision);
    return row ? { revision: row.revision, value: JSON.parse(row.valueJson), writerAgentId: row.writerAgentId, createdAt: row.createdAt } : null;
  }

  history({ executionId, key, limit = 50 }) {
    return this.database.prepare('SELECT revision, value_json AS valueJson, writer_agent_id AS writerAgentId, created_at AS createdAt FROM task_state_revisions WHERE execution_id = ? AND state_key = ? ORDER BY revision DESC LIMIT ?')
      .all(executionId, cleanKey(key), Math.min(Math.max(1, Math.trunc(limit)), 200))
      .map((row) => ({ revision: row.revision, value: JSON.parse(row.valueJson), writerAgentId: row.writerAgentId, createdAt: row.createdAt }));
  }

  /** Every key the execution has on the board, with its current value. */
  list({ executionId }) {
    return this.database.prepare(`
      SELECT c.state_key AS key, c.revision AS revision, c.updated_at AS updatedAt, r.value_json AS valueJson, r.writer_agent_id AS writerAgentId
        FROM task_state_current c
        JOIN task_state_revisions r ON r.execution_id = c.execution_id AND r.state_key = c.state_key AND r.revision = c.revision
       WHERE c.execution_id = ?
       ORDER BY c.state_key
    `).all(executionId).map((row) => ({ ...row, value: JSON.parse(row.valueJson) }));
  }

  /**
   * Compare-and-set. `expectedRevision` is the revision the caller read; a
   * different one means somebody wrote in between and nothing is stored.
   * @returns {{ ok: true, revision: number }} | {{ ok: false, conflict: true, current: { revision, value } }}
   */
  commit({ executionId, key, expectedRevision, value, writerAgentId = null, now }) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('expectedRevision must be a non-negative integer.');
    const json = encode(value, 'value');
    return this.commitPrepared({ executionId, key, expectedRevision, json, writerAgentId, now });
  }

  /** @internal the JSON is encoded before the transaction opens, so a bad value
   * never leaves a half-run `BEGIN IMMEDIATE` behind. */
  commitPrepared({ executionId, key, expectedRevision, json, writerAgentId, now }) {
    const at = stamp(now);
    const name = cleanKey(key);
    if (writerAgentId !== null) cleanText(writerAgentId, 'writerAgentId', 128);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.database.prepare('SELECT revision FROM task_state_current WHERE execution_id = ? AND state_key = ?').get(executionId, name);
      const actual = current?.revision ?? 0;
      if (actual !== expectedRevision) {
        this.database.exec('COMMIT');
        const latest = current ? this.database.prepare('SELECT value_json AS valueJson FROM task_state_revisions WHERE execution_id = ? AND state_key = ? AND revision = ?').get(executionId, name, actual) : null;
        return { ok: false, conflict: true, current: { revision: actual, value: latest ? JSON.parse(latest.valueJson) : null } };
      }
      const revision = actual + 1;
      this.database.prepare('INSERT INTO task_state_revisions (execution_id, state_key, revision, value_json, writer_agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(executionId, name, revision, json, writerAgentId, at);
      this.database.prepare('INSERT INTO task_state_current (execution_id, state_key, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(execution_id, state_key) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at')
        .run(executionId, name, revision, at);
      this.database.exec('COMMIT');
      return { ok: true, revision };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Registers something an agent produced. `effectKey` makes the write
   * idempotent: a claim retried after a crash reports the artifact the first
   * attempt already stored instead of booking a second one.
   */
  putArtifact({ executionId, agentId, kind, path, bytes, sha256, taskId = null, effectKey = null, now }) {
    const at = stamp(now);
    const fields = {
      agentId: cleanText(agentId, 'agentId', 128),
      kind: cleanText(kind, 'kind', 48),
      path: cleanText(path, 'path', MAX_PATH_LENGTH),
    };
    if (!Number.isInteger(bytes) || bytes < 0) throw new TypeError('bytes must be a non-negative integer.');
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new TypeError('sha256 must be 64 hexadecimal characters.');
    if (effectKey !== null) cleanText(effectKey, 'effectKey', 160);
    if (taskId !== null) cleanText(taskId, 'taskId', 128);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const stored = this.database.prepare('SELECT * FROM artifacts WHERE effect_key = ?').get(effectKey);
      if (stored) {
        this.database.exec('COMMIT');
        return { ok: true, duplicate: true, artifact: artifactOf(stored) };
      }
      const result = this.database.prepare('INSERT INTO artifacts (execution_id, task_id, agent_id, kind, path, bytes, sha256, effect_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(executionId, taskId, fields.agentId, fields.kind, fields.path, bytes, sha256, effectKey, at);
      this.database.exec('COMMIT');
      return { ok: true, duplicate: false, artifact: artifactOf(this.database.prepare('SELECT * FROM artifacts WHERE id = ?').get(result.lastInsertRowid)) };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listArtifacts({ executionId, agentId = null, taskId = null, limit = 100 }) {
    const clauses = ['execution_id = ?'];
    const args = [executionId];
    if (agentId !== null) { clauses.push('agent_id = ?'); args.push(agentId); }
    if (taskId !== null) { clauses.push('task_id = ?'); args.push(taskId); }
    args.push(Math.min(Math.max(1, Math.trunc(limit)), 500));
    return this.database.prepare(`SELECT * FROM artifacts WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args).map(artifactOf);
  }
}
