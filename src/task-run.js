import { assertExecutionPlan } from './teams/execution-plan.js';
import { assertId } from './teams/domain.js';
import { assertObjective, assertPositiveInteger, ROLE_SEQUENCE, TASK_STATUS } from './contracts.js';
import { assertCapabilityGrants } from './capabilities.js';

const RESUMABLE_STATUSES = Object.freeze([TASK_STATUS.PLANNED, TASK_STATUS.EXECUTING, TASK_STATUS.REVIEWING]);
export const DEFAULT_MAX_TOOL_CALLS = 24;

/**
 * One actor's share of the mission's provider budget. The mission-level ceiling
 * stays the real limit — this is the second one, for the case a group of agents
 * working at the same time creates: one teammate spending the whole run on its
 * own reading while the others never get a turn.
 */
export const DEFAULT_MAX_PROVIDER_CALLS_PER_ACTOR = 6;

/**
 * A concurrent crew cannot live on a sequential budget: three teammates holding
 * six calls each need more than ten to ever get a turn. The actor mode has its
 * own global default, and an explicit `maxProviderCalls` still wins.
 */
export const DEFAULT_ACTOR_MAX_PROVIDER_CALLS = 24;

export const EXECUTION_MODES = Object.freeze(['sequential', 'actor']);

/**
 * Three roles plus the turns a looped role can spend. A tool turn is a provider
 * call, so a mission whose executor reads four files costs eight calls, not one:
 * the budget has to be the real spend or it stops meaning anything.
 */
export const DEFAULT_MAX_PROVIDER_CALLS = 10;

const TRANSITIONS = Object.freeze({
  [TASK_STATUS.DRAFT]: new Set([TASK_STATUS.PLANNED, TASK_STATUS.NEEDS_ATTENTION, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.PLANNED]: new Set([TASK_STATUS.EXECUTING, TASK_STATUS.NEEDS_ATTENTION, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.EXECUTING]: new Set([TASK_STATUS.REVIEWING, TASK_STATUS.NEEDS_ATTENTION, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.REVIEWING]: new Set([TASK_STATUS.COMPLETED, TASK_STATUS.AWAITING_APPROVAL, TASK_STATUS.NEEDS_ATTENTION, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.COMPLETED]: new Set(),
  [TASK_STATUS.AWAITING_APPROVAL]: new Set([TASK_STATUS.EXECUTING, TASK_STATUS.NEEDS_ATTENTION, TASK_STATUS.FAILED]),
  [TASK_STATUS.NEEDS_ATTENTION]: new Set([...RESUMABLE_STATUSES, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.FAILED]: new Set([...RESUMABLE_STATUSES, TASK_STATUS.NEEDS_ATTENTION, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.CANCELLED]: new Set(),
});

export class TaskRun {
  #calls = 0;
  #toolCalls = 0;
  #actorCalls = new Map();

  constructor({ id, objective, teamId = null, executionPlan = null, mode = 'sequential', maxProviderCalls = DEFAULT_MAX_PROVIDER_CALLS, maxProviderCallsPerActor = DEFAULT_MAX_PROVIDER_CALLS_PER_ACTOR, providerLabel = null, capabilityGrants = [], workspaceRoot = null, maxToolCalls = DEFAULT_MAX_TOOL_CALLS, now = () => new Date().toISOString() }) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id is required.');
    if (!EXECUTION_MODES.includes(mode)) throw new TypeError(`mode must be one of ${EXECUTION_MODES.join(', ')}.`);
    if (providerLabel !== null && (typeof providerLabel !== 'string' || providerLabel.trim().length === 0)) {
      throw new TypeError('providerLabel must be a non-empty string or null.');
    }
    this.teamId = teamId === null ? null : assertId(teamId,'teamId');
    this.executionPlan = executionPlan === null ? null : assertExecutionPlan(executionPlan,this.teamId);
    this.id = id;
    this.mode = mode;
    this.objective = assertObjective(objective);
    this.maxProviderCalls = assertPositiveInteger(maxProviderCalls, 'maxProviderCalls');
    this.maxProviderCallsPerActor = assertPositiveInteger(maxProviderCallsPerActor, 'maxProviderCallsPerActor');
    this.providerLabel = providerLabel;
    this.capabilityGrants = assertCapabilityGrants(capabilityGrants);
    this.workspaceRoot = assertWorkspaceRoot(workspaceRoot);
    this.maxToolCalls = assertPositiveInteger(maxToolCalls, 'maxToolCalls');
    this.status = TASK_STATUS.DRAFT;
    this.outputs = {};
    this.audit = [];
    this.now = now;
    this.record('task_created', {
      ...(this.teamId ? { teamId: this.teamId } : {}),
      ...(this.executionPlan ? { executionMode: 'team-preset' } : {}),
      // A sequential ledger has no per-actor share to report, and a mission that
      // is both a Team preset and actor-run says both rather than one overwriting
      // the other.
      ...(this.mode === 'sequential' ? {} : { mode: this.mode, maxProviderCallsPerActor: this.maxProviderCallsPerActor }),
      objective: this.objective,
      maxProviderCalls: this.maxProviderCalls,
      providerLabel,
      capabilityGrants: this.capabilityGrants,
      workspaceRoot: this.workspaceRoot,
      maxToolCalls: this.maxToolCalls,
    });
  }

  get providerCalls() { return this.#calls; }

  get toolCalls() { return this.#toolCalls; }

  /** What each actor has spent so far — the number a scheduler reads before waking another. */
  actorCalls() {
    return Object.freeze([...this.#actorCalls.entries()].map(([agentId, providerCalls]) => ({ agentId, providerCalls })));
  }

  snapshot() {
    return Object.freeze({
      id: this.id,
      ...(this.teamId ? { teamId: this.teamId } : {}),
      objective: this.objective,
      status: this.status,
      mode: this.mode,
      ...(this.executionPlan ? {executionPlan:this.executionPlan} : {}),
      maxProviderCalls: this.maxProviderCalls,
      maxProviderCallsPerActor: this.maxProviderCallsPerActor,
      providerCalls: this.#calls,
      providerLabel: this.providerLabel,
      capabilityGrants: Object.freeze(this.capabilityGrants.map((grant) => ({ ...grant }))),
      workspaceRoot: this.workspaceRoot,
      maxToolCalls: this.maxToolCalls,
      toolCalls: this.#toolCalls,
      actors: this.actorCalls(),
      outputs: Object.freeze({ ...this.outputs }),
      audit: Object.freeze(this.audit.map((entry) => ({ ...entry, detail: { ...entry.detail } }))),
    });
  }

  record(type, detail = {}) {
    const binding = ROLE_SEQUENCE.includes(detail.role) ? this.executionPlan?.roles[detail.role] : null;
    if (binding) detail = {...detail,agentId:binding.agentId,agentName:binding.name,providerLabel:binding.providerLabel,model:binding.model};
    this.audit.push(Object.freeze({ at: this.now(), type, detail: Object.freeze({ ...detail }) }));
  }

  transition(nextStatus) {
    if (!TRANSITIONS[this.status].has(nextStatus)) {
      throw new Error(`Cannot transition task from ${this.status} to ${nextStatus}.`);
    }
    const previousStatus = this.status;
    this.status = nextStatus;
    this.record('state_changed', { previousStatus, nextStatus });
  }

  /**
   * Buys one provider call. `agentId` is how an actor mission spends: the
   * mission counter stays the global ceiling and the per-actor counter is the
   * fairness bound under it. A sequential role keeps the old shape exactly —
   * same unknown-role refusal, same audit line — because that ledger is what a
   * stored mission is resumed against.
   */
  reserveProviderCall(role, agentId = null) {
    if (agentId === null) {
      if (!ROLE_SEQUENCE.includes(role)) throw new TypeError(`Unknown role: ${role}`);
    } else if (typeof agentId !== 'string' || agentId.trim() === '' || agentId.length > 128 || /[\r\n\0]/.test(agentId)) {
      throw new TypeError('an actor reservation needs a single-line agentId of at most 128 characters.');
    }
    const tag = agentId === null ? {} : { agentId };
    if (this.#calls >= this.maxProviderCalls) {
      this.record('budget_exhausted', { role, ...tag, maxProviderCalls: this.maxProviderCalls });
      return false;
    }
    if (agentId !== null && (this.#actorCalls.get(agentId) ?? 0) >= this.maxProviderCallsPerActor) {
      this.record('actor_budget_exhausted', { role, agentId, maxProviderCallsPerActor: this.maxProviderCallsPerActor });
      return false;
    }
    this.#calls += 1;
    if (agentId !== null) this.#actorCalls.set(agentId, (this.#actorCalls.get(agentId) ?? 0) + 1);
    this.record('provider_call_reserved', { role, ...tag, providerCall: this.#calls });
    return true;
  }

  /**
   * Tools are spent against the mission counter only: an actor that reads fifty
   * files still costs the group one budget, which is the number the user set.
   */
  reserveToolCall(role, agentId = null) {
    if (agentId === null) {
      if (!ROLE_SEQUENCE.includes(role)) throw new TypeError(`Unknown role: ${role}`);
    } else if (typeof agentId !== 'string' || agentId.trim() === '') {
      throw new TypeError('an actor reservation needs an agentId.');
    }
    if (this.#toolCalls >= this.maxToolCalls) {
      this.record('tool_budget_exhausted', { role, ...(agentId === null ? {} : { agentId }), maxToolCalls: this.maxToolCalls });
      return false;
    }
    this.#toolCalls += 1;
    return true;
  }

  saveOutput(role, content) {
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new TypeError(`${role} must return non-empty text.`);
    }
    this.outputs[role] = content.trim();
    this.record('agent_output_recorded', { role, characters: content.trim().length });
  }

  extendBudget(to) {
    assertPositiveInteger(to, 'maxProviderCalls');
    if (to <= this.maxProviderCalls) {
      throw new Error(`New budget (${to}) must be greater than the current budget (${this.maxProviderCalls}).`);
    }
    const previousMax = this.maxProviderCalls;
    this.maxProviderCalls = to;
    this.record('budget_extended', { previousMax, maxProviderCalls: to });
  }

  /**
   * The tool budget is spent against the same per-mission counter across
   * resumes, so raising it is the only way a resumed mission gathers evidence
   * it has already used up.
   */
  extendToolBudget(to) {
    assertPositiveInteger(to, 'maxToolCalls');
    if (to <= this.maxToolCalls) {
      throw new Error(`New tool budget (${to}) must be greater than the current tool budget (${this.maxToolCalls}).`);
    }
    const previousMax = this.maxToolCalls;
    this.maxToolCalls = to;
    this.record('tool_budget_extended', { previousMax, maxToolCalls: to });
  }

  cancel(reason = 'user_requested') {
    if (this.status === TASK_STATUS.CANCELLED) return;
    this.transition(TASK_STATUS.CANCELLED);
    this.record('mission_cancelled', { reason });
  }

  /**
   * Rebuilds a TaskRun from a persisted snapshot. The private call counter can
   * only be restored from inside the class; no lifecycle events are re-recorded.
   * @param {ReturnType<TaskRun['snapshot']>} snapshot
   */
  static fromSnapshot(snapshot, { now } = {}) {
    const task = new TaskRun({
      id: snapshot.id,
      teamId: snapshot.teamId ?? null,
      executionPlan: snapshot.executionPlan ?? null,
      mode: snapshot.mode ?? 'sequential',
      objective: snapshot.objective,
      maxProviderCalls: snapshot.maxProviderCalls,
      maxProviderCallsPerActor: snapshot.maxProviderCallsPerActor ?? DEFAULT_MAX_PROVIDER_CALLS_PER_ACTOR,
      providerLabel: snapshot.providerLabel ?? null,
      capabilityGrants: snapshot.capabilityGrants ?? [],
      workspaceRoot: snapshot.workspaceRoot ?? null,
      maxToolCalls: snapshot.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
      now,
    });
    if (!Object.values(TASK_STATUS).includes(snapshot.status)) {
      throw new TypeError(`snapshot.status "${snapshot.status}" is not a known task status.`);
    }
    if (!Number.isInteger(snapshot.providerCalls) || snapshot.providerCalls < 0) {
      throw new TypeError('snapshot.providerCalls must be a non-negative integer.');
    }
    if (!Number.isInteger(snapshot.toolCalls) || snapshot.toolCalls < 0) {
      throw new TypeError('snapshot.toolCalls must be a non-negative integer.');
    }
    task.status = snapshot.status;
    task.#calls = snapshot.providerCalls;
    task.#toolCalls = snapshot.toolCalls;
    task.outputs = { ...snapshot.outputs };
    task.audit = snapshot.audit.map((entry) => Object.freeze({ ...entry, detail: Object.freeze({ ...entry.detail }) }));
    task.#actorCalls = actorCallsFrom(snapshot, task.audit);
    return task;
  }
}

/**
 * A resumed actor mission must not get a fresh allowance for work it already
 * paid for. The snapshot carries the per-actor counts, and a mission rebuilt
 * from SQLite — which stores the trail but not that field — is read back out of
 * the trail itself, one `provider_call_reserved` per call spent.
 */
function actorCallsFrom(snapshot, audit) {
  if (Array.isArray(snapshot.actors)) {
    const counts = new Map();
    for (const actor of snapshot.actors) {
      if (typeof actor?.agentId !== 'string' || actor.agentId === '') throw new TypeError('snapshot.actors entries need an agentId.');
      if (!Number.isInteger(actor.providerCalls) || actor.providerCalls < 0) throw new TypeError('snapshot.actors providerCalls must be a non-negative integer.');
      counts.set(actor.agentId, actor.providerCalls);
    }
    return counts;
  }
  const counts = new Map();
  for (const entry of audit) {
    const agentId = entry?.detail?.agentId;
    if (typeof agentId === 'string' && agentId !== '' && entry?.type === 'provider_call_reserved') {
      counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Stored as authored: resolving a path against the filesystem is the
 * orchestrator's job, so rebuilding a mission from SQLite never does I/O.
 */
function assertWorkspaceRoot(candidate) {
  if (candidate === null || candidate === undefined) return null;
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new TypeError('workspaceRoot must be a non-empty path or null.');
  }
  if (/[\r\n\0]/.test(candidate) || candidate.length > 1024) {
    throw new TypeError('workspaceRoot must be a single-line path of at most 1024 characters.');
  }
  return candidate.trim();
}
