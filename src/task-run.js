import { assertObjective, assertPositiveInteger, ROLE_SEQUENCE, TASK_STATUS } from './contracts.js';
import { assertCapabilityGrants } from './capabilities.js';

const RESUMABLE_STATUSES = Object.freeze([TASK_STATUS.PLANNED, TASK_STATUS.EXECUTING, TASK_STATUS.REVIEWING]);

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

  constructor({ id, objective, maxProviderCalls = 3, providerLabel = null, capabilityGrants = [], now = () => new Date().toISOString() }) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id is required.');
    if (providerLabel !== null && (typeof providerLabel !== 'string' || providerLabel.trim().length === 0)) {
      throw new TypeError('providerLabel must be a non-empty string or null.');
    }
    this.id = id;
    this.objective = assertObjective(objective);
    this.maxProviderCalls = assertPositiveInteger(maxProviderCalls, 'maxProviderCalls');
    this.providerLabel = providerLabel;
    this.capabilityGrants = assertCapabilityGrants(capabilityGrants);
    this.status = TASK_STATUS.DRAFT;
    this.outputs = {};
    this.audit = [];
    this.now = now;
    this.record('task_created', { objective: this.objective, maxProviderCalls: this.maxProviderCalls, providerLabel, capabilityGrants: this.capabilityGrants });
  }

  get providerCalls() { return this.#calls; }

  snapshot() {
    return Object.freeze({
      id: this.id,
      objective: this.objective,
      status: this.status,
      maxProviderCalls: this.maxProviderCalls,
      providerCalls: this.#calls,
      providerLabel: this.providerLabel,
      capabilityGrants: Object.freeze(this.capabilityGrants.map((grant) => ({ ...grant }))),
      outputs: Object.freeze({ ...this.outputs }),
      audit: Object.freeze(this.audit.map((entry) => ({ ...entry, detail: { ...entry.detail } }))),
    });
  }

  record(type, detail = {}) {
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

  reserveProviderCall(role) {
    if (!ROLE_SEQUENCE.includes(role)) throw new TypeError(`Unknown role: ${role}`);
    if (this.#calls >= this.maxProviderCalls) {
      this.record('budget_exhausted', { role, maxProviderCalls: this.maxProviderCalls });
      return false;
    }
    this.#calls += 1;
    this.record('provider_call_reserved', { role, providerCall: this.#calls });
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
      objective: snapshot.objective,
      maxProviderCalls: snapshot.maxProviderCalls,
      providerLabel: snapshot.providerLabel ?? null,
      capabilityGrants: snapshot.capabilityGrants ?? [],
      now,
    });
    if (!Object.values(TASK_STATUS).includes(snapshot.status)) {
      throw new TypeError(`snapshot.status "${snapshot.status}" is not a known task status.`);
    }
    if (!Number.isInteger(snapshot.providerCalls) || snapshot.providerCalls < 0) {
      throw new TypeError('snapshot.providerCalls must be a non-negative integer.');
    }
    task.status = snapshot.status;
    task.#calls = snapshot.providerCalls;
    task.outputs = { ...snapshot.outputs };
    task.audit = snapshot.audit.map((entry) => Object.freeze({ ...entry, detail: Object.freeze({ ...entry.detail }) }));
    return task;
  }
}
