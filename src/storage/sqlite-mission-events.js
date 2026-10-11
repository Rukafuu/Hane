/**
 * The event trail every actor writes through, ordered by one global sequence.
 * `task_audit_entries` is scoped to a single mission and its ordinal restarts
 * per task, which is enough for one ledger but not for a bus several agents
 * publish to and a client catches up on: here `ordinal` never repeats and never
 * rewinds, so "give me everything after 41" works across agents and reconnects.
 *
 * `execution_id` is deliberately not a foreign key. A team conversation is meant
 * to publish to the same trail one day, and a conversation has no row in
 * `task_runs` to reference.
 */

export const EXECUTION_KINDS = Object.freeze(['mission', 'conversation']);
const MAX_TYPE_LENGTH = 64;

const cleanType = (type) => {
  if (typeof type !== 'string' || type.trim() === '' || type.length > MAX_TYPE_LENGTH || /[\r\n\0]/.test(type)) {
    throw new TypeError(`event type must be a single-line string up to ${MAX_TYPE_LENGTH} characters.`);
  }
  return type.trim();
};
const cleanOptionalText = (value, label) => (value === null ? null : (() => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 128 || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${label} must be a single-line string up to 128 characters, or null.`);
  }
  return value.trim();
})());
const stamp = (now) => (now === undefined ? new Date().toISOString() : now);

const eventOf = (row) => ({
  ordinal: row.ordinal,
  executionKind: row.execution_kind,
  executionId: row.execution_id,
  teamId: row.team_id,
  actorId: row.actor_id,
  type: row.type,
  payload: JSON.parse(row.payload_json),
  createdAt: row.created_at,
});

export class SqliteMissionEventStore {
  constructor({ database }) {
    if (!database?.prepare) throw new TypeError('a SQLite database handle is required.');
    this.database = database;
  }

  /**
   * Appends one event and returns it with its ordinal, so the caller can hand
   * that ordinal to a client as the position to resume from.
   */
  append({ executionId, type, payload = null, actorId = null, teamId = null, executionKind = 'mission', now }) {
    if (!EXECUTION_KINDS.includes(executionKind)) throw new TypeError(`executionKind must be one of ${EXECUTION_KINDS.join(', ')}.`);
    if (executionId === undefined || executionId === null || String(executionId).trim() === '' || String(executionId).length > 128) {
      throw new TypeError('executionId must be a non-empty string up to 128 characters.');
    }
    const name = cleanType(type);
    const json = encode(payload);
    const actor = cleanOptionalText(actorId, 'actorId');
    const team = cleanOptionalText(teamId, 'teamId');
    const row = this.database.prepare(`
      INSERT INTO mission_events (execution_kind, execution_id, team_id, actor_id, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(executionKind, String(executionId).trim(), team, actor, name, json, stamp(now));
    return eventOf(row);
  }

  /** Everything after `after`, oldest first: the catch-up a reconnecting client reads. */
  since({ executionId, after = 0, limit = 200 }) {
    if (!Number.isInteger(after) || after < 0) throw new TypeError('after must be a non-negative integer.');
    return this.database.prepare('SELECT * FROM mission_events WHERE execution_id = ? AND ordinal > ? ORDER BY ordinal LIMIT ?')
      .all(executionId, after, Math.min(Math.max(1, Math.trunc(limit)), 1_000))
      .map(eventOf);
  }

  /** The highest ordinal written, or 0 when nothing has been. */
  latest({ executionId }) {
    return this.database.prepare('SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM mission_events WHERE execution_id = ?').get(executionId).ordinal;
  }
}

function encode(payload) {
  if (payload === null || payload === undefined) return 'null';
  let json;
  try {
    json = JSON.stringify(payload);
  } catch {
    throw new TypeError('event payload must be JSON-serializable.');
  }
  if (json === undefined) return 'null';
  if (json.length > 200_000) throw new TypeError('event payload is larger than 200000 bytes of JSON.');
  return json;
}
