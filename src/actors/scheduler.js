import { blockedTasks, isSettled, readyTasks } from './dag.js';
import { ACTOR_LIMITS } from './limits.js';

/**
 * Who works, when, and what is written down afterwards.
 *
 * The scheduler is the only hand that moves a task's status and the only hand
 * that commits the result of one to the shared board. That is not a performance
 * rule: an agent proposing state it also writes is how two teammates end up
 * believing two different versions of the same plan. Agents propose, the
 * scheduler decides, and the audit trail is written by the same code that made
 * the call.
 *
 * Concurrency is what Node's event loop gives — several turns in the air over one
 * SQLite connection — and it is bounded here rather than trusted: at most
 * `maxConcurrentActors` turns at once and at most one per agent, because an
 * agent's own reasoning stays sequential. A peer message cannot land in the
 * middle of a generation, and neither can a second task.
 */

const TERMINAL = Object.freeze(['completed', 'failed', 'blocked']);

/**
 * @param {{ executionRef: {kind:string,id:string}, ledger: {record:Function},
 *           bus?: object|null, tasks: object, state?: object|null, roster: readonly object[],
 *           runTurn: (options: {agent: object, task: object}) => Promise<{ok: boolean, content: string|null, spentTurn?: boolean}>,
 *           maxConcurrentActors?: number, limits?: object, signal?: AbortSignal|null }} wiring
 */
export function createActorScheduler({ executionRef, ledger, bus = null, tasks, state = null, roster, runTurn, maxConcurrentActors = ACTOR_LIMITS.maxConcurrentActors, limits = ACTOR_LIMITS, signal = null }) {
  if (!executionRef?.id || !ledger?.record) throw new TypeError('the scheduler needs an execution and a ledger to audit against.');
  if (!tasks?.claim) throw new TypeError('the scheduler needs an actor task store.');
  if (typeof runTurn !== 'function') throw new TypeError('the scheduler needs a runTurn to hand a task to.');
  const agents = new Map((roster ?? []).map((agent) => [agent.agentId ?? agent.id, agent]));
  if (agents.size === 0) throw new TypeError('the scheduler needs a roster of at least one agent.');
  const slots = Math.max(1, Math.min(Math.trunc(maxConcurrentActors), limits.maxConcurrentActorsCeiling, agents.size));
  const executionId = executionRef.id;

  // taskId -> the turn in the air. A Map, not a counter, because the limits that
  // matter are per task and per agent, not "how many promises exist".
  const active = new Map();

  const emit = (type, actorId, data) => {
    ledger.record(type, { ...data, ...(actorId === null ? {} : { agentId: actorId }) });
    bus?.emit?.({ type, actorId, data });
  };

  const busyAgents = () => new Set([...active.values()].map((entry) => entry.agentId));

  /** The board entry a finished task leaves behind, read by the next turn's prompt. */
  const publish = (task, agent, content) => {
    const key = `task:${task.id}`;
    if (!state) return null;
    const outcome = state.commit({ key, expectedRevision: state.read(key).revision, value: { taskId: task.id, agentId: agent.agentId, title: task.title, content }, writerAgentId: agent.agentId });
    return outcome.ok ? { key, revision: outcome.revision } : { key, revision: outcome.current?.revision ?? null, conflict: true };
  };

  const release = (task, agent, reason) => {
    const back = tasks.release({ executionId, id: task.id, owner: agent.agentId, reason });
    if (back) emit('actor_stopped', agent.agentId, { taskId: task.id, status: back.status, reason: back.note, attempts: back.attempts });
    return back;
  };

  /** Hands one ready task to its agent and returns the promise the drain waits on. */
  const start = (task) => {
    const agent = agents.get(task.assigneeAgentId);
    if (!agent) {
      // The roster was validated when the plan was booked, so this is a member who
      // left mid-run. The task stops rather than running as nobody.
      tasks.block({ executionId, ids: [task.id], reason: 'assignee_left_execution' });
      emit('actor_refused', null, { taskId: task.id, reason: 'assignee_left_execution' });
      return null;
    }
    const claimed = tasks.claim({ executionId, id: task.id, owner: agent.agentId });
    if (claimed === null) return null;
    emit('actor_started', agent.agentId, { taskId: claimed.id, title: claimed.title, attempts: claimed.attempts });
    const entry = { agentId: agent.agentId, task: claimed, settled: null };
    active.set(task.id, entry);
    entry.settled = Promise.resolve()
      .then(() => runTurn({ agent, task: claimed }))
      .then((result) => settle(task.id, agent, result), () => settle(task.id, agent, null, true));
    return entry.settled;
  };

  /** One turn came back: write what it means, and tell the loop if the budget is gone. */
  const settle = (taskId, agent, result, threw = false) => {
    active.delete(taskId);
    if (threw && signal?.aborted) {
      // The user stopped the mission. The task was not finished by the failure, so
      // it goes back to the queue with the attempt it spent and the run drains.
      release({ id: taskId }, agent, 'cancelled');
      return { cancelled: true };
    }
    if (threw || result === null || result === undefined) {
      // The turn loop already wrote the `actor_turn_failed` line with the message
      // and the task it belongs to; the release below says what happened to the
      // task. A second record of the same failure is two places for it to drift.
      release({ id: taskId }, agent, 'turn_failed');
      return {};
    }
    // A turn that never bought its provider call leaves the task exactly where it
    // was: the budget ran out, not the agent, and the dependents of a task nobody
    // started must not be called failed.
    if (result.spentTurn === false) {
      release({ id: taskId }, agent, 'provider_budget_exhausted');
      return { exhausted: true };
    }
    if (!result.ok || typeof result.content !== 'string' || result.content.trim() === '') {
      const failed = tasks.fail({ executionId, id: taskId, owner: agent.agentId, reason: result.reason ?? 'no_answer' });
      if (failed) emit('actor_stopped', agent.agentId, { taskId, status: 'failed', reason: failed.note });
      return {};
    }
    const current = tasks.get({ executionId, id: taskId });
    // The answer is on the board before the task is closed: whoever reads
    // `completed` must be able to find what it produced.
    const published = publish(current, agent, result.content);
    const closed = tasks.complete({ executionId, id: taskId, owner: agent.agentId, resultKey: published?.conflict ? null : published?.key ?? null });
    if (closed) emit('actor_task_completed', agent.agentId, { taskId, resultKey: closed.resultKey, characters: result.content.length, ...(published?.conflict ? { stateConflict: true } : {}) });
    return {};
  };

  /**
   * One pass: reclaim dead leases, strand what a failure left behind, publish
   * what is newly startable. Returns the tasks eligible for a slot.
   */
  const tick = () => {
    // A turn still in this scheduler's hands is renewed before anything is
    // reclaimed: a generation that outlived its lease is a slow turn, not a dead
    // one, and requeuing it here would put the same agent on the same task twice.
    for (const entry of active.values()) tasks.renew({ executionId, id: entry.task.id, owner: entry.agentId });
    const recovered = tasks.recoverExpiredLeases({ executionId });
    for (const id of recovered.released) emit('actor_stopped', null, { taskId: id, status: 'ready', reason: 'lease_expired' });
    for (const id of recovered.failed) emit('actor_stopped', null, { taskId: id, status: 'failed', reason: 'lease_exhausted' });

    const stranded = blockedTasks(tasks.list({ executionId }));
    if (stranded.length > 0) {
      const blocked = tasks.block({ executionId, ids: stranded.map((task) => task.id), reason: 'predecessor_failed' });
      if (blocked > 0) emit('actor_refused', null, { reason: 'predecessor_failed', tasks: stranded.map((task) => task.id) });
    }
    // Re-read after the writes: eligibility is decided on what the store says now,
    // not on the rows this tick happened to load first.
    const rows = tasks.list({ executionId });
    const eligible = readyTasks(rows, { runningAgentIds: busyAgents() });
    const fresh = eligible.filter((task) => task.status === 'pending').map((task) => task.id);
    if (fresh.length > 0) tasks.markReady({ executionId, ids: fresh });
    return eligible;
  };

  /**
   * Runs the plan to a stop: nothing left that can run, the budget is gone, or
   * the user cancelled. The mission's own status is the orchestrator's to write.
   */
  const run = async () => {
    let exhausted = false;
    let cancelled = false;
    for (;;) {
      if (!cancelled && signal?.aborted) cancelled = true;
      const eligible = cancelled ? [] : tick();
      if (!cancelled && !exhausted) {
        for (const task of eligible) {
          if (active.size >= slots) break;
          if (active.has(task.id) || busyAgents().has(task.assigneeAgentId)) continue;
          start(task);
        }
      }
      if (active.size === 0) {
        const rows = tasks.list({ executionId });
        if (rows.length === 0 || isSettled(rows)) break;
        const outstanding = rows.filter((task) => !TERMINAL.includes(task.status)).map((task) => task.id);
        if (exhausted || cancelled) {
          // The queue keeps its shape. A mission that stopped for money or because
          // the user pressed cancel is resumed, not re-planned: a task nobody
          // started is neither failed nor stranded, and rewriting it to `blocked`
          // would be a row the next run has to unblock before it can do anything.
          emit('actor_refused', null, { reason: exhausted ? 'provider_budget_exhausted' : 'cancelled', tasks: outstanding });
          break;
        }
        // Nothing running and nothing startable: whatever is left waits on a task
        // that will never complete. Say which, and release the mission rather than
        // spin on it.
        tasks.block({ executionId, ids: outstanding, reason: 'no_runnable_task' });
        emit('actor_refused', null, { reason: 'no_runnable_task', tasks: outstanding });
        break;
      }
      // The drain: wait for a turn rather than poll for one.
      const outcome = await Promise.race([...active.values()].map((entry) => entry.settled));
      if (outcome?.exhausted) exhausted = true;
    }
    const counts = { total: 0, pending: 0, ready: 0, running: 0, completed: 0, failed: 0, blocked: 0 };
    for (const task of tasks.list({ executionId })) {
      counts.total += 1;
      counts[task.status] += 1;
    }
    return { ...counts, exhausted, cancelled, slots };
  };

  return Object.freeze({
    slots,
    active: () => [...active.entries()].map(([taskId, entry]) => ({ taskId, agentId: entry.agentId })),
    inFlight: () => tasks.list({ executionId }).filter((task) => task.status === 'running'),
    tick,
    start,
    run,
  });
}
