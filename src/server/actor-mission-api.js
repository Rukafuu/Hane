import { assertId, assertObject, TeamError } from '../teams/domain.js';
import { TASK_STATUS } from '../contracts.js';
import { MESSAGE_PRIORITIES, MESSAGE_STATUSES } from '../storage/sqlite-mailbox-store.js';
import { USER_SENDER_ID } from '../actors/envelope.js';
import { SqliteActorPlanStore } from '../storage/sqlite-actor-plan-store.js';

/**
 * The read-only windows onto a running actor mission, plus the one way the user
 * puts something into it.
 *
 * These routes exist because a mission that works concurrently cannot be answered
 * by `GET /api/missions/:id`: that payload is one ledger, while the work is
 * spread over inboxes, a board, and a task list. Each route reads persisted rows
 * and nothing else — no in-memory "who is live right now" is invented here,
 * because a serve process that restarted would report a crew that is not there.
 *
 * The composer posts as `USER_SENDER_ID`, never as an agent: a message the user
 * typed and a message a teammate wrote have to be tellable apart in the inbox and
 * in the audit, and the only honest way to say which is to send it under its real
 * author.
 */

const MAX_MESSAGE_BYTES = 16_000;

export function createActorMissionApi({ repository, agentStore = null, tasks, mailbox, state, events, readJsonBody, respondJson, broadcast = () => {} }) {
  const plans = repository.database ? new SqliteActorPlanStore({ database: repository.database }) : null;
  return async function handle({ request, response, isAuthorized }) {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    const match = pathname.match(/^\/api\/missions\/([\w-]+)\/(mailbox|state|actors|actor-plan)$/);
    const trail = pathname === '/api/mission-events';
    if (!match && !trail) return false;
    const reply = (status, payload) => { respondJson(response, status, payload); return true; };
    if (!isAuthorized()) return reply(401, { error: 'Seu Hane está bloqueado.' });
    // A server built without a SQLite store has no mailbox to read and no board to
    // post into. Saying so is honest; an empty list would look like an idle crew.
    if (!tasks || !mailbox || !state || !events) {
      return reply(503, { error: 'Actor storage is unavailable on this server: mission routes need a SQLite repository.' });
    }

    try {
      if (trail) {
        const missionId = url.searchParams.get('missionId');
        if (!missionId) return reply(400, { error: 'missionId is required.' });
        assertId(missionId, 'missionId');
        const after = url.searchParams.get('after');
        if (after !== null && (!/^\d+$/.test(after) || Number(after) > Number.MAX_SAFE_INTEGER)) {
          return reply(400, { error: 'after must be a non-negative ordinal.' });
        }
        if (!repository.findById(missionId)) return reply(404, { error: `Unknown mission "${missionId}".` });
        return reply(200, {
          events: events.since({ executionId: missionId, after: after === null ? 0 : Number(after) }),
          latest: events.latest({ executionId: missionId }),
        });
      }

      const missionId = match[1];
      assertId(missionId, 'missionId');
      const mission = repository.findById(missionId);
      if (!mission) return reply(404, { error: `Unknown mission "${missionId}".` });
      if (mission.mode !== 'actor') return reply(409, { error: `Mission "${missionId}" is a sequential run; it has no mailboxes, board or task crew.` });
      const rows = tasks.list({ executionId: missionId });

      if (match[2] === 'actor-plan' && request.method === 'GET') {
        const plan = plans?.get({ executionId: missionId }) ?? null;
        if (!plan) return reply(404, { error: `No actor plan has been proposed for mission "${missionId}".` });
        return reply(200, { missionId, status: mission.status, proposal: plan, providerCalls: mission.providerCalls, maxProviderCalls: mission.maxProviderCalls, maxProviderCallsPerActor: mission.maxProviderCallsPerActor });
      }
      if (match[2] === 'actors' && request.method === 'GET') {
        const names = new Map(rows.map((row) => [row.assigneeAgentId, agentStore?.get(row.assigneeAgentId)?.name ?? null]));
        return reply(200, {
          missionId,
          status: mission.status,
          maxProviderCalls: mission.maxProviderCalls,
          providerCalls: mission.providerCalls,
          counts: tasks.counts({ executionId: missionId }),
          actors: [...names].map(([agentId, name]) => ({
            agentId,
            name,
            tasks: rows.filter((row) => row.assigneeAgentId === agentId).map((row) => ({
              id: row.id, title: row.title, status: row.status, note: row.note, attempts: row.attempts, resultKey: row.resultKey,
            })),
          })),
        });
      }

      if (match[2] === 'state' && request.method === 'GET') {
        return reply(200, {
          missionId,
          revisionOf: state.list({ executionId: missionId }).map((entry) => ({
            key: entry.key, revision: entry.revision, writerAgentId: entry.writerAgentId, updatedAt: entry.updatedAt, value: entry.value,
          })),
          tasks: rows.map((row) => ({ id: row.id, title: row.title, assigneeAgentId: row.assigneeAgentId, status: row.status, note: row.note, resultKey: row.resultKey, attempts: row.attempts })),
        });
      }

      if (match[2] === 'mailbox' && request.method === 'GET') {
        const agentId = url.searchParams.get('agentId');
        const status = url.searchParams.get('status');
        // Not `assertId`: one side of an inbox is the user, whose sender id is a
        // word rather than a UUID, and filtering by it is exactly what the composer
        // needs to show.
        if (agentId !== null && (agentId.trim() === '' || agentId.length > 128 || /[\r\n\0]/.test(agentId))) {
          return reply(400, { error: 'agentId must be a single-line name or id.' });
        }
        if (status !== null && !MESSAGE_STATUSES.includes(status)) {
          return reply(400, { error: `status must be one of ${MESSAGE_STATUSES.join(', ')}.` });
        }
        return reply(200, {
          missionId,
          messages: mailbox.list({ executionId: missionId, ...(agentId === null ? {} : { agentId }), status: status ?? null }),
        });
      }

      if (match[2] === 'mailbox' && request.method === 'POST') {
        let body;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          return reply(400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
        }
        // A mission that finished will never read its inbox again. Refusing is the
        // honest answer: storing the row and letting it sit unread looks like a
        // delivery the user paid for and nobody received.
        if (mission.status === TASK_STATUS.COMPLETED || mission.status === TASK_STATUS.CANCELLED) {
          return reply(409, { error: `Mission "${missionId}" is ${mission.status}; there is no one left to read a new message.` });
        }
        assertObject(body);
        if (!isAuthorized()) return reply(401, { error: 'Seu Hane está bloqueado.' });
        const recipient = resolveRecipient(String(body?.to ?? ''), rows, (id) => agentStore?.get(id)?.name ?? null);
        if (recipient === null) return reply(400, { error: 'That teammate does not work this mission. Send to one of the assignees named by the plan.' });
        const content = typeof body?.content === 'string' ? body.content.trim() : '';
        if (content === '' || content.length > MAX_MESSAGE_BYTES) return reply(400, { error: `content must be text of up to ${MAX_MESSAGE_BYTES} characters.` });
        const priority = body?.priority === undefined ? 'normal' : body.priority;
        if (!MESSAGE_PRIORITIES.includes(priority)) return reply(400, { error: 'priority must be normal or high.' });

        const delivered = mailbox.deliver({
          executionId: missionId,
          recipientAgentId: recipient,
          senderAgentId: USER_SENDER_ID,
          kind: 'user',
          body: content,
          hop: 0,
          priority,
        });
        // The row and the event are one fact: a message the user posted has to be
        // in the catch-up trail a reconnecting client reads, not only on the wire.
        const written = events.append({ executionId: missionId, type: 'actor_message', actorId: USER_SENDER_ID, payload: { messageId: delivered.message.id, fromAgentId: USER_SENDER_ID, toAgentId: recipient, kind: 'user', hop: 0, priority, body: content } });
        broadcast({ type: 'actor_message', missionId, actorId: USER_SENDER_ID, messageId: delivered.message.id, fromAgentId: USER_SENDER_ID, toAgentId: recipient, kind: 'user', hop: 0, priority, body: content, ordinal: written.ordinal });
        return reply(202, { missionId, messageId: delivered.message.id, to: recipient, status: delivered.message.status, priority, ...(delivered.duplicate ? { duplicate: true } : {}) });
      }

      return reply(405, { error: 'Method not allowed.' });
    } catch (error) {
      if (error instanceof TeamError) return reply(error.status, { error: error.message });
      if (error instanceof TypeError) return reply(400, { error: error.message });
      throw error;
    }
  };
}

/**
 * An id, or a name that belongs to exactly one assignee of this plan. A teammate
 * who left the group is not a recipient: the plan is the roster here, because
 * that is what the scheduler actually runs.
 */
function resolveRecipient(claimed, rows, nameOf) {
  const needle = claimed.trim().toLowerCase();
  if (needle === '') return null;
  const assignees = [...new Set(rows.map((row) => row.assigneeAgentId))];
  if (assignees.some((id) => id.toLowerCase() === needle)) return assignees.find((id) => id.toLowerCase() === needle);
  const named = assignees.filter((id) => String(nameOf(id) ?? '').toLowerCase() === needle);
  return named.length === 1 ? named[0] : null;
}
