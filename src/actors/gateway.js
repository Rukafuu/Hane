import { createHash } from 'node:crypto';
import { CAPABILITY, parseGrantScope, peerAllowedBy } from '../capabilities.js';
import { denial, defineSandbox } from '../sandbox/interface.js';
import { assertExecutionRef } from './envelope.js';
import { ACTOR_LIMITS } from './limits.js';

/**
 * The only way an agent's model can reach another agent.
 *
 * It is a sandbox behind the same tool router as a file read, so messaging is
 * offered, granted and refused by the one door the mission already has — and it
 * is a *gateway* rather than a mailbox handle, because an agent must not be able
 * to write a peer's inbox. Three things follow from that shape:
 *
 *   - the sender is the actor this gateway was built for. It is never read from
 *     the model's arguments, so a message cannot claim to come from a teammate;
 *   - the recipient is resolved against the roster of this execution, so an id
 *     invented by the model, or a peer who left the group, is refused;
 *   - the grant is read with the core's own grammar, so `team.communicate` means
 *     exactly the peers the user named.
 *
 * What the gateway does *not* do is audit. The turn loop already records every
 * tool call it handed here, and a second line for the same event is two places
 * for the truth to drift.
 */
export function createMessagingGateway({ executionRef, mailbox, roster, senderAgentId, grants = [], limits = ACTOR_LIMITS }) {
  // Checked on the way in rather than mid-inference: an unbound gateway is a
  // wiring bug, and it should say so before a model pays for a turn to find out.
  assertExecutionRef(executionRef);
  if (typeof senderAgentId !== 'string' || senderAgentId.trim() === '') throw new TypeError('createMessagingGateway requires the senderAgentId it is bound to.');
  if (!mailbox?.send) throw new TypeError('createMessagingGateway requires an actor mailbox with send().');

  const boundSender = senderAgentId.trim();
  const peerRules = grants
    .filter((grant) => grant?.name === CAPABILITY.TEAM_COMMUNICATE)
    .flatMap((grant) => {
      const outcome = parseGrantScope(CAPABILITY.TEAM_COMMUNICATE, grant.scope);
      return outcome.ok ? outcome.parsed : [];
    });

  // The turn this gateway is answering for: how deep in a reply chain it sits,
  // and a token stable across a re-run of the same turn so a retried send lands
  // once rather than twice.
  const turn = { hop: 0, token: null };

  const currentRoster = () => (typeof roster === 'function' ? roster() : roster) ?? [];

  const resolve = (needle) => {
    const peers = currentRoster();
    const byId = peers.filter((peer) => String(peer?.agentId ?? '').toLowerCase() === needle);
    if (byId.length === 1) return { ok: true, peer: byId[0] };
    const byName = peers.filter((peer) => String(peer?.name ?? '').toLowerCase() === needle);
    if (byName.length === 1) return { ok: true, peer: byName[0] };
    // A name two teammates share is not a coin flip: the model has to say which
    // one, and until it does nothing is delivered on a guess.
    if (byName.length > 1) return { ok: false, reason: 'recipient_ambiguous' };
    return { ok: false, reason: 'recipient_not_in_execution' };
  };

  const refuse = (reason, to) => denial(reason, { to: to ?? null });

  return Object.freeze({
    /**
     * Called by the agent loop before each turn: the depth a reply from this turn
     * inherits, and the token that makes a retried send idempotent.
     */
    beginTurn({ hop = 0, token = null } = {}) {
      turn.hop = Number.isInteger(hop) && hop >= 0 ? hop : 0;
      turn.token = typeof token === 'string' && token !== '' ? token.slice(0, 96) : null;
    },

    hop() { return turn.hop; },

    /** The router's sandbox side: one verb, `message`, and nothing else. */
    sandbox: defineSandbox({
      id: 'actor-messaging',
      async message(request) {
        const args = request ?? {};
        const rawTo = typeof args.to === 'string' ? args.to.trim() : '';
        // A roster that lost this agent while its prompt was in flight must not
        // keep sending: the frozen prompt cannot resurrect a revoked membership.
        const senderPresent = currentRoster().some((peer) => String(peer?.agentId ?? '') === boundSender);
        if (!senderPresent) return refuse('sender_not_in_execution', rawTo);

        if (rawTo === '') return refuse('invalid_message', null);
        const body = typeof args.content === 'string' ? args.content.trim() : '';
        if (body === '' || body.length > 16_000) return refuse('invalid_message', rawTo);

        const found = resolve(rawTo.toLowerCase());
        if (!found.ok) return refuse(found.reason, rawTo);
        const recipientAgentId = String(found.peer.agentId);
        if (recipientAgentId === boundSender) return refuse('self_message_not_allowed', rawTo);

        const allowed = peerAllowedBy(peerRules, recipientAgentId);
        if (!allowed.ok) return refuse('peer_not_granted', rawTo);

        const hop = turn.hop + 1;
        if (hop > limits.maxHop) return refuse('hop_limit_exceeded', rawTo);

        let replyTo = null;
        if (args.replyTo !== null && args.replyTo !== undefined) {
          const candidate = Number(args.replyTo);
          if (!Number.isInteger(candidate) || candidate < 1) return refuse('invalid_message', rawTo);
          replyTo = candidate;
        }

        const dedupeKey = turn.token === null
          ? null
          : `${turn.token}:${recipientAgentId}:${createHash('sha256').update(body).digest('hex').slice(0, 16)}`;

        const outcome = mailbox.send({
          fromAgentId: boundSender,
          toAgentId: recipientAgentId,
          kind: 'agent',
          body,
          hop,
          priority: 'normal',
          replyTo,
          dedupeKey,
        });
        if (!outcome.ok) return refuse(outcome.reason, rawTo);

        return {
          ok: true,
          to: recipientAgentId,
          toName: found.peer?.name ?? null,
          messageId: outcome.message.id,
          hop,
          duplicate: outcome.duplicate,
        };
      },
    }),
  });
}
