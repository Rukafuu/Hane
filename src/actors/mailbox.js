import { assertExecutionRef, createEnvelope, envelopeFromRow } from './envelope.js';
import { ACTOR_LIMITS } from './limits.js';

/**
 * The runtime's view of the inbox: a store that keeps rows plus the rules that
 * decide whether a row may exist.
 *
 * Two invariants live here rather than in the callers. The delivery limits are
 * checked before anything is persisted, so a refused message never becomes a row
 * the user later finds in an inbox nobody answered. And a message that lands is
 * published on the bus in the same breath: a row with no event is work that
 * happened invisibly, which is the failure this runtime is supposed to make
 * impossible.
 */
export function createActorMailbox({ executionRef, store, bus = null, limits = ACTOR_LIMITS }) {
  const ref = assertExecutionRef(executionRef);
  if (!store?.claim) throw new TypeError('createActorMailbox requires a mailbox store with claim().');

  return Object.freeze({
    executionRef: ref,
    limits,

    /**
     * Persists one directed message, or says why it will not be delivered.
     * A refusal is a value: an agent whose peer is busy is expected traffic.
     * @returns {{ ok: true, duplicate: boolean, message: object }} | {{ ok: false, reason: string }}
     */
    send({ fromAgentId, toAgentId, kind = 'agent', body, hop = 0, priority = 'normal', replyTo = null, dedupeKey = null }) {
      if (Number.isInteger(hop) && hop > limits.maxHop) {
        return { ok: false, reason: 'hop_limit_exceeded', hop, maxHop: limits.maxHop };
      }
      const inbound = store.countProcessed({ executionId: ref.id, recipientAgentId: toAgentId });
      if (inbound >= limits.messagesProcessedPerActor) {
        return { ok: false, reason: 'actor_inbound_limit_exceeded', inbound, limit: limits.messagesProcessedPerActor };
      }
      const between = store.countBetween({ executionId: ref.id, fromAgentId, toAgentId });
      if (between >= limits.messagesPerPair) {
        return { ok: false, reason: 'pair_limit_exceeded', sent: between, limit: limits.messagesPerPair };
      }

      let delivered;
      try {
        const envelope = createEnvelope({ executionRef: ref, kind, fromAgentId, toAgentId, body, hop, priority, replyTo, dedupeKey });
        delivered = store.deliver({
          executionId: ref.id,
          recipientAgentId: envelope.toAgentId,
          senderAgentId: envelope.fromAgentId,
          kind: envelope.kind,
          body: envelope.body,
          hop: envelope.hop,
          priority: envelope.priority,
          replyTo: envelope.replyTo,
          dedupeKey: envelope.dedupeKey,
        });
      } catch {
        // The body came from a model. Anything it failed to be is a refusal the
        // agent reads back, not a crash the mission dies of.
        return { ok: false, reason: 'invalid_message' };
      }

      if (delivered.duplicate) {
        // A retried send lands once: the row already exists and was already
        // published, so saying nothing new is the honest answer.
        return { ok: true, duplicate: true, message: delivered.message };
      }
      if (bus) {
        bus.emit({
          type: 'actor_message',
          actorId: delivered.message.senderAgentId,
          data: {
            messageId: delivered.message.id,
            fromAgentId: delivered.message.senderAgentId,
            toAgentId: delivered.message.recipientAgentId,
            kind: delivered.message.kind,
            hop: delivered.message.hop,
            priority: delivered.message.priority,
            replyTo: delivered.message.replyTo,
            body: delivered.message.body,
          },
        });
      }
      return { ok: true, duplicate: false, message: delivered.message };
    },

    /** Reserves the next batch for one agent, highest priority and oldest first. */
    claim({ agentId, owner, limit = limits.claimBatch, leaseMs = limits.claimLeaseMs, now } = {}) {
      return store.claim({ executionId: ref.id, recipientAgentId: agentId, owner, limit, leaseMs, ...(now === undefined ? {} : { now }) })
        .map((row) => ({ ...envelopeFromRow(row, ref), claimToken: row.claimToken }));
    },

    ack({ id, claimToken, now }) {
      return store.ack({ id, claimToken, ...(now === undefined ? {} : { now }) });
    },

    nack({ id, claimToken, reason, now }) {
      return store.nack({ id, claimToken, reason, ...(now === undefined ? {} : { now }) });
    },

    peek(agentId) {
      return store.peek({ executionId: ref.id, recipientAgentId: agentId });
    },

    list({ agentId = null, status = null, limit } = {}) {
      return store.list({ executionId: ref.id, agentId, status, ...(limit === undefined ? {} : { limit }) });
    },

    /** Hands back what a dead claim was holding. Idempotent, safe to run on every tick. */
    recoverExpiredLeases({ now } = {}) {
      return store.recoverExpiredLeases({ executionId: ref.id, ...(now === undefined ? {} : { now }) });
    },
  });
}
