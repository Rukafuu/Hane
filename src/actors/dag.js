/**
 * The shape an actor mission's work list has, and the two questions the
 * scheduler asks of it: is this a graph I may run at all, and what may run now.
 *
 * Validation happens before a mission is persisted and before an actor is
 * woken, because the alternative is worse in both directions: a cyclic plan
 * deadlocks a scheduler that is waiting for a predecessor, and a plan naming an
 * agent outside the roster spends a provider call to discover a peer that does
 * not exist in this execution. Both are refusals on the way in rather than a
 * runtime that gets stuck.
 *
 * This file deliberately knows nothing about SQLite, `TaskRun`, or a mission:
 * it reads the `{id,title,assigneeAgentId,dependsOn}` shape the API accepts and
 * answers about it. The conversation runtime is meant to reuse it.
 */

export const MAX_ACTOR_TASKS = 12;
export const MAX_TASK_TITLE = 200;
export const MAX_DEPENDS_ON = 12;

const cleanId = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 128 || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${label} must be a single-line string up to 128 characters.`);
  }
  return value.trim();
};

/**
 * A task as the DAG sees it: the caller's ids, normalized and nothing else.
 * @throws TypeError with the reason a scheduler would refuse to run it.
 */
export function normalizeActorTask(raw) {
  if (raw === null || typeof raw !== 'object') throw new TypeError('a task must be an object with an id, a title and an assignee.');
  const dependsOn = raw.dependsOn ?? [];
  if (!Array.isArray(dependsOn)) throw new TypeError('dependsOn must be a list of task ids.');
  if (dependsOn.length > MAX_DEPENDS_ON) throw new TypeError(`a task may depend on at most ${MAX_DEPENDS_ON} others.`);
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title === '' || title.length > MAX_TASK_TITLE || /[\r\n\0]/.test(raw.title ?? '')) {
    throw new TypeError(`a task needs a single-line title of up to ${MAX_TASK_TITLE} characters.`);
  }
  return Object.freeze({
    id: cleanId(raw.id, 'task id'),
    title,
    assigneeAgentId: cleanId(raw.assigneeAgentId, 'assigneeAgentId'),
    dependsOn: Object.freeze([...new Set(dependsOn.map((id) => cleanId(id, 'dependsOn entry')))]),
  });
}

/**
 * The whole plan, checked as one graph.
 *
 * Every rule here is a deadlock or a phantom the scheduler would otherwise meet
 * mid-run: two tasks with one id, a dependency on a task nobody wrote, a cycle,
 * an assignee the execution cannot reach, a plan longer than a mission can pay
 * for. `agentIds` is the roster of this execution — a Team member who left
 * between the draft and the start is refused here, not at turn time.
 *
 * @param {{ tasks: readonly object[], agentIds: readonly string[] }} plan
 * @throws TypeError naming the first rule the plan breaks.
 */
export function assertActorDag({ tasks, agentIds }) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new TypeError('an actor execution needs at least one task.');
  }
  if (tasks.length > MAX_ACTOR_TASKS) {
    throw new TypeError(`an actor execution plans at most ${MAX_ACTOR_TASKS} tasks, and got ${tasks.length}.`);
  }
  const roster = new Set((agentIds ?? []).map((id) => cleanId(id, 'roster agentId')));
  if (roster.size === 0) throw new TypeError('an actor execution needs at least one agent in the roster.');

  const seen = new Map();
  const normalized = tasks.map((raw) => {
    const task = normalizeActorTask(raw);
    if (seen.has(task.id)) throw new TypeError(`task id "${task.id}" appears twice; dependencies would point at two tasks.`);
    if (!roster.has(task.assigneeAgentId)) {
      throw new TypeError(`task "${task.id}" is assigned to ${task.assigneeAgentId}, which is not in this execution.`);
    }
    seen.set(task.id, task);
    return task;
  });

  for (const task of normalized) {
    if (task.dependsOn.includes(task.id)) throw new TypeError(`task "${task.id}" depends on itself.`);
    for (const dependency of task.dependsOn) {
      if (!seen.has(dependency)) throw new TypeError(`task "${task.id}" depends on "${dependency}", which this plan does not have.`);
    }
  }

  // Kahn's algorithm: whatever survives the peeling is a cycle, and the message
  // has to name the tasks in it rather than say "invalid graph".
  const remaining = new Map(normalized.map((task) => [task.id, task]));
  let progressed = true;
  while (remaining.size > 0 && progressed) {
    progressed = false;
    for (const [id, task] of remaining) {
      if (task.dependsOn.every((dependency) => !remaining.has(dependency))) {
        remaining.delete(id);
        progressed = true;
      }
    }
  }
  if (remaining.size > 0) {
    throw new TypeError(`these tasks depend on each other and would never start: ${[...remaining.keys()].join(', ')}.`);
  }
  return Object.freeze(normalized);
}

/**
 * The tasks that may start now: not finished, not already running, and with
 * every predecessor completed.
 *
 * A predecessor that *failed* does not release its dependents — it strands them,
 * which is what `blockedTasks` reports. Treating a failure as done is how a plan
 * quietly produces an answer built on a step nobody completed.
 *
 * @param {readonly object[]} tasks each `{id, assigneeAgentId, dependsOn, status}`
 */
export function readyTasks(tasks, { runningAgentIds = new Set() } = {}) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return Object.freeze(tasks.filter((task) => task.status === 'pending' || task.status === 'ready')
    .filter((task) => !runningAgentIds.has(task.assigneeAgentId))
    .filter((task) => task.dependsOn.every((dependency) => byId.get(dependency)?.status === 'completed')));
}

/**
 * Tasks that can never run because something they wait on is not coming: a
 * predecessor failed, was blocked, or is itself stranded.
 */
export function blockedTasks(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const dead = new Set(tasks.filter((task) => task.status === 'failed' || task.status === 'blocked').map((task) => task.id));
  if (dead.size === 0) return Object.freeze([]);
  // One pass in plan order is enough because the graph is acyclic and the caller
  // hands us the whole execution: whatever inherits a dead end is itself a dead end.
  for (const task of tasks) {
    if (dead.has(task.id)) continue;
    if (task.dependsOn.some((dependency) => dead.has(dependency))) dead.add(task.id);
  }
  return Object.freeze(tasks.filter((task) => dead.has(task.id) && task.status !== 'failed'));
}

/** True when nothing is left to run: every task reached a terminal state. */
export function isSettled(tasks) {
  return tasks.every((task) => ['completed', 'failed', 'blocked'].includes(task.status));
}
