import { MESSAGE_PRIORITIES } from '../storage/sqlite-mailbox-store.js';

/**
 * The one shape a directed message has while it travels through the runtime.
 * The mailbox stores it, the gateway builds it, the agent loop reads it — and the
 * fields the model never gets to set (`fromAgentId`, `hop`, `id`) are exactly the
 * ones that make a spoofed sender impossible.
 *
 * `executionRef` is `{ kind, id }` rather than a mission id because a team
 * conversation is meant to run on this same runtime one day: the envelope must
 * not have to learn what a mission is.
 */

const MAX_BODY_LENGTH = 16_000;
const MAX_AGENT_ID_LENGTH = 128;
const MAX_KIND_LENGTH = 48;

const singleLine = (value, label, max) => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${label} must be a single-line string up to ${max} characters.`);
  }
  return value.trim();
};

export function assertExecutionRef(candidate) {
  const kind = candidate?.kind;
  if (kind !== 'mission' && kind !== 'conversation') {
    throw new TypeError('executionRef.kind must be "mission" or "conversation".');
  }
  return Object.freeze({ kind, id: singleLine(candidate.id, 'executionRef.id', 128) });
}

/**
 * Validates a message on its way in. Body length and shape are the model's
 * business, so the caller that takes model text checks these before calling —
 * a TypeError here is a runtime bug, not bad prompting.
 */
export function createEnvelope({ executionRef, kind = 'agent', fromAgentId, toAgentId, body, hop = 0, priority = 'normal', replyTo = null, dedupeKey = null, id = null }) {
  const ref = assertExecutionRef(executionRef);
  if (!Number.isInteger(hop) || hop < 0 || hop > 16) throw new TypeError('hop must be a non-negative integer.');
  if (!MESSAGE_PRIORITIES.includes(priority)) throw new TypeError(`priority must be one of ${MESSAGE_PRIORITIES.join(', ')}.`);
  if (replyTo !== null && !Number.isInteger(replyTo)) throw new TypeError('replyTo must be an integer message id or null.');
  if (typeof body !== 'string' || body.trim() === '' || body.length > MAX_BODY_LENGTH) {
    throw new TypeError(`body must be text of at most ${MAX_BODY_LENGTH} characters.`);
  }
  const sender = singleLine(fromAgentId, 'fromAgentId', MAX_AGENT_ID_LENGTH);
  const recipient = singleLine(toAgentId, 'toAgentId', MAX_AGENT_ID_LENGTH);
  if (sender === recipient) throw new TypeError('an agent cannot message itself.');

  return Object.freeze({
    ...(id === null ? {} : { id }),
    executionRef: ref,
    kind: singleLine(kind, 'kind', MAX_KIND_LENGTH),
    fromAgentId: sender,
    toAgentId: recipient,
    body: body.trim(),
    hop,
    priority,
    replyTo,
    dedupeKey,
  });
}

/**
 * A stored row back into the shape the runtime passes around. The row carries an
 * execution id but not its kind — only the event trail records that — so the
 * caller that knows which runtime it is in hands the ref in.
 */
export function envelopeFromRow(row, executionRef) {
  const ref = executionRef === undefined || executionRef === null
    ? Object.freeze({ kind: 'mission', id: row.executionId })
    : assertExecutionRef(executionRef);
  return Object.freeze({
    id: row.id,
    executionRef: ref,
    kind: row.kind,
    fromAgentId: row.senderAgentId,
    toAgentId: row.recipientAgentId,
    body: row.body,
    hop: row.hop,
    priority: row.priority,
    replyTo: row.replyTo,
    dedupeKey: row.dedupeKey ?? null,
    status: row.status,
    attempts: row.attempts,
  });
}

/**
 * How deep into a reply chain this turn already is. A turn started by a task has
 * no incoming hop, so its replies are the first generation; a turn answering a
 * peer that was itself answering somebody inherits the deepest chain it read.
 */
export function maxHopOf(messages = []) {
  return messages.reduce((deepest, message) => Math.max(deepest, Number.isInteger(message?.hop) ? message.hop : 0), 0);
}
