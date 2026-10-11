/**
 * What a resumed execution does with the work a crash left in the air.
 *
 * The rule this file exists to enforce is the one the plan was written around:
 * the truth is what was persisted and confirmed, not what the snapshot remembers.
 * A process died between a model answering and the scheduler closing the row, so
 * the row says `running` while the board already holds the result. Re-running
 * that turn would spend the user's money to produce an answer that is already
 * there — so the first thing reconciliation does is recognize what finished.
 *
 * The second thing is refuse to guess. A turn that wrote a file or ran a command
 * and then died has an outcome nobody can read: the effect is on the machine and
 * the answer never arrived. Repeating it is not "trying again", it is doing the
 * same damage twice, so those tasks are held and the mission asks.
 *
 * Nothing here knows about missions or `TaskRun`: it is handed stores, the audit
 * trail of the run that died, and a clock.
 */

/** Verbs whose success changed something outside this database. */
const EFFECT_TYPES = Object.freeze(['tool_written', 'tool_ran']);
/** Lines that close a turn: after any of these, the trail already says what happened. */
const SETTLED_TYPES = Object.freeze(['actor_task_completed', 'actor_stopped', 'actor_turn_failed', 'actor_held', 'actor_recovered']);

/**
 * The last thing the trail says about one task, and whether an unconfirmed
 * external effect is inside it.
 * @returns {{ started: number, effect: object|null, settled: boolean }}
 */
function readTrail(trail, taskId) {
  let started = -1;
  let effect = null;
  let settled = false;
  for (let index = 0; index < trail.length; index += 1) {
    const entry = trail[index];
    if (entry?.detail?.taskId !== taskId) continue;
    if (entry.type === 'actor_started') {
      // A later attempt reopens the reading: only effects after the *current*
      // start are unexplained.
      started = index;
      effect = null;
      settled = false;
      continue;
    }
    if (started < index && EFFECT_TYPES.includes(entry.type)) effect = { index, ...entry };
    if (started < index && SETTLED_TYPES.includes(entry.type)) settled = true;
  }
  return { started, effect, settled };
}

/**
 * @param {{ executionRef: {kind:string,id:string}, tasks: object, mailbox?: object|null,
 *           state?: object|null, trail?: readonly object[],
 *           audit?: (type: string, detail: object) => void, leaseMs?: number, now?: string }} input
 *   `trail` is the persisted audit of the run being resumed; `state` is the shared
 *   board, and passing it is what lets a finished-but-unclosed answer be recognized
 *   instead of paid for twice.
 * @returns {{ mailbox: object, completed: object[], held: object[], released: object[],
 *             failed: object[], needsAttention: boolean }}
 */
export function reconcileOnResume({ executionRef, tasks, mailbox = null, state = null, trail = [], audit = () => {}, now }) {
  const executionId = executionRef?.id;
  if (!executionId) throw new TypeError('reconcileOnResume requires an executionRef with an id.');
  if (!tasks?.list) throw new TypeError('reconcileOnResume requires an actor task store.');

  // Mailbox leases first: an agent's message that was claimed by a turn which
  // never finished belongs to the next turn of that agent, and a message that
  // ran out of attempts is dropped where the user can see it. Inside a live run
  // this never happens — every path of a turn acks or nacks what it claimed — so
  // recovery is a resume concern rather than a per-tick one.
  const mail = mailbox ? mailbox.recoverExpiredLeases(now === undefined ? {} : { now }) : { requeued: [], dropped: [] };
  for (const message of mail.dropped) {
    audit('actor_dropped', { agentId: message.recipientAgentId, messageId: message.id, reason: 'lease_exhausted' });
  }
  if (mail.requeued.length > 0 || mail.dropped.length > 0) {
    audit('actor_mailbox_reconciled', { requeued: mail.requeued.map((message) => message.id), dropped: mail.dropped.map((message) => message.id) });
  }

  const completed = [];
  const held = [];
  const released = [];
  const failed = [];
  const at = now === undefined ? {} : { now };

  for (const task of tasks.list({ executionId }).filter((row) => row.status === 'running')) {
    const key = `task:${task.id}`;
    const onBoard = state?.read(key);
    const authored = onBoard?.value?.taskId === task.id && onBoard.value.agentId === task.assigneeAgentId;
    if (authored && task.claimOwner !== null) {
      // The answer is confirmed on the board and written by the agent that held
      // the task: the turn finished, the row is what is missing.
      const closed = tasks.complete({ executionId, id: task.id, owner: task.claimOwner, resultKey: key, note: 'recovered_from_board', ...at });
      if (closed) {
        completed.push(closed);
        audit('actor_recovered', { agentId: task.claimOwner, taskId: task.id, resultKey: key, revision: onBoard.revision });
        continue;
      }
    }
    const { effect, settled } = readTrail(trail, task.id);
    if (effect && !settled) {
      if (tasks.hold({ executionId, ids: [task.id], reason: 'unknown_external_effect', ...at }) > 0) {
        held.push(task.id);
        // The reason names the verb that changed the machine, and the trail names
        // the path or command: a user deciding whether to re-run needs both.
        audit('actor_held', { agentId: task.claimOwner, taskId: task.id, reason: 'unknown_external_effect', via: effect.type, ...(effect.detail.path === undefined ? {} : { path: effect.detail.path }), ...(effect.detail.command === undefined ? {} : { command: effect.detail.command }) });
        continue;
      }
    }
    if (task.claimOwner === null) {
      // Running with nobody holding it: the row contradicts itself, so nothing is
      // retried on top of it and the mission says so.
      if (tasks.hold({ executionId, ids: [task.id], reason: 'unowned_running_task', ...at }) > 0) {
        held.push(task.id);
        audit('actor_held', { taskId: task.id, reason: 'unowned_running_task' });
      }
      continue;
    }
    // No confirmation and no unexplained effect: this turn is safe to repeat, so
    // the lease that outlived its holder is handed back below the attempt ceiling.
    const back = tasks.release({ executionId, id: task.id, owner: task.claimOwner, reason: 'resumed_after_interruption', ...at });
    if (back === null) continue;
    if (back.status === 'failed') {
      failed.push(back.id);
      audit('actor_stopped', { agentId: task.claimOwner, taskId: back.id, status: 'failed', reason: back.note });
    } else {
      released.push(back.id);
      audit('actor_stopped', { agentId: task.claimOwner, taskId: back.id, status: back.status, reason: 'resumed_after_interruption' });
    }
  }

  // Whatever is still `running` has an expired lease nobody reached above: the
  // store's own reconciliation requeues it, or fails it at the ceiling.
  const expired = tasks.recoverExpiredLeases({ executionId, ...at });
  released.push(...expired.released);
  failed.push(...expired.failed);
  for (const id of expired.released) audit('actor_stopped', { taskId: id, status: 'ready', reason: 'lease_expired' });
  for (const id of expired.failed) audit('actor_stopped', { taskId: id, status: 'failed', reason: 'lease_exhausted' });

  return {
    mailbox: mail,
    completed,
    held,
    released,
    failed,
    needsAttention: held.length > 0 || mail.dropped.length > 0 || failed.length > 0,
  };
}
