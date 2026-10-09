import { TASK_STATUS } from './contracts.js';
import { TaskRun } from './task-run.js';
import { parseVerdict } from './verdict.js';

const ROLE_INSTRUCTIONS = Object.freeze({
  planner: 'Create a concise plan. Do not claim to have run tools or changed files.',
  executor: 'Produce a proposed result. State exactly what is evidence and what remains unverified.',
  reviewer: 'Review the plan and result. End with one verdict: approved, revise, or needs_attention.',
});

const ROLE_FLOW = Object.freeze([
  { role: 'planner', activeStatus: TASK_STATUS.PLANNED },
  { role: 'executor', activeStatus: TASK_STATUS.EXECUTING },
  { role: 'reviewer', activeStatus: TASK_STATUS.REVIEWING },
]);

/**
 * @typedef {{ type: 'role_saved' | 'role_skipped_budget' | 'role_failed' | 'run_finished', role?: string, task: object }} OrchestratorEvent
 */

export class Orchestrator {
  constructor({ provider, repository = null, idFactory = () => crypto.randomUUID() }) {
    if (!provider || typeof provider.complete !== 'function') {
      throw new TypeError('provider.complete(request) is required.');
    }
    this.provider = provider;
    this.repository = repository;
    this.idFactory = idFactory;
  }

  /**
   * @param {{ objective: string, maxProviderCalls?: number, providerLabel?: string|null,
   *           onEvent?: ((event: OrchestratorEvent) => void) | null }} request
   */
  async start({ objective, maxProviderCalls = 3, providerLabel = null, onEvent = null }) {
    const task = new TaskRun({ id: this.idFactory(), objective, maxProviderCalls, providerLabel });
    return this.#execute(task, onEvent);
  }

  /**
   * Continues a stored task from its current status, running only the roles
   * that have no saved output. The task may have been rebuilt via
   * TaskRun.fromSnapshot and had its budget extended beforehand.
   */
  async resume(task, { onEvent = null } = {}) {
    if (!(task instanceof TaskRun)) throw new TypeError('resume requires a TaskRun instance.');
    return this.#execute(task, onEvent);
  }

  async #execute(task, onEvent) {
    let settled = true;
    for (const { role, activeStatus } of ROLE_FLOW) {
      if (task.outputs[role] !== undefined) continue;
      await this.#runRole(task, role, activeStatus, onEvent);
      if (task.status !== activeStatus) { settled = false; break; }
    }
    if (settled && task.status === TASK_STATUS.REVIEWING) this.#settleByVerdict(task);
    return this.#finish(task, onEvent);
  }

  async #runRole(task, role, activeStatus, onEvent) {
    this.#transitionIfNeeded(task, activeStatus);
    if (!task.reserveProviderCall(role)) {
      this.#transitionIfNeeded(task, TASK_STATUS.NEEDS_ATTENTION);
      this.#persist(task);
      this.#emit(onEvent, { type: 'role_skipped_budget', role, task: task.snapshot() });
      return;
    }
    try {
      const content = await this.provider.complete({
        role,
        objective: task.objective,
        instruction: ROLE_INSTRUCTIONS[role],
        priorOutputs: { ...task.outputs },
        onRetry: (info) => task.record('provider_retry', { role, ...info }),
      });
      task.saveOutput(role, content);
    } catch (error) {
      task.record('provider_call_failed', { role, message: error instanceof Error ? error.message : 'Unknown provider failure' });
      this.#transitionIfNeeded(task, TASK_STATUS.FAILED);
      this.#persist(task);
      this.#emit(onEvent, { type: 'role_failed', role, task: task.snapshot() });
      return;
    }
    this.#persist(task);
    this.#emit(onEvent, { type: 'role_saved', role, task: task.snapshot() });
  }

  #settleByVerdict(task) {
    const verdict = parseVerdict(task.outputs.reviewer);
    task.record(verdict === 'verdict_unparsed' ? 'verdict_unparsed' : 'verdict_parsed', { verdict });
    if (verdict === 'approved') {
      task.transition(TASK_STATUS.COMPLETED);
    } else if (verdict === 'revise') {
      task.transition(TASK_STATUS.AWAITING_APPROVAL);
    } else {
      task.transition(TASK_STATUS.NEEDS_ATTENTION);
    }
  }

  #transitionIfNeeded(task, status) {
    if (task.status !== status) task.transition(status);
  }

  #finish(task, onEvent) {
    this.#persist(task);
    this.#emit(onEvent, { type: 'run_finished', task: task.snapshot() });
    return task;
  }

  #emit(onEvent, event) {
    if (typeof onEvent === 'function') onEvent(event);
  }

  #persist(task) {
    if (this.repository) this.repository.save(task.snapshot());
    return task;
  }
}
