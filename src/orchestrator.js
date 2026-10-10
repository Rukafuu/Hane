import { TASK_STATUS } from './contracts.js';
import { createScopeResolver, grantsForWorkspaceRead, resolveWorkspaceRoot } from './workspace-scope.js';
import { listWorkspaceDir, parseRequestedPaths, readWorkspaceFile } from './tools/workspace-read.js';
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
   *           capabilityGrants?: readonly object[], workspaceRoot?: string|null,
   *           signal?: AbortSignal|null,
   *           onEvent?: ((event: OrchestratorEvent) => void) | null }} request
   */
  async start({ objective, maxProviderCalls = 3, providerLabel = null, capabilityGrants = [], workspaceRoot = null, maxToolCalls = undefined, signal = null, onEvent = null }) {
    const task = new TaskRun({
      id: this.idFactory(),
      objective,
      maxProviderCalls,
      providerLabel,
      capabilityGrants,
      workspaceRoot,
      ...(maxToolCalls === undefined ? {} : { maxToolCalls }),
    });
    return this.#execute(task, onEvent, signal);
  }

  /**
   * Continues a stored task from its current status, running only the roles
   * that have no saved output. The task may have been rebuilt via
   * TaskRun.fromSnapshot and had its budget extended beforehand.
   */
  async resume(task, { onEvent = null, signal = null } = {}) {
    if (!(task instanceof TaskRun)) throw new TypeError('resume requires a TaskRun instance.');
    return this.#execute(task, onEvent, signal);
  }

  async #execute(task, onEvent, signal) {
    // Persist the mission before its first provider call. This makes a queued
    // request immediately inspectable and, crucially, cancellable even while
    // the first network request is still in flight.
    this.#persist(task);
    let settled = true;
    for (const { role, activeStatus } of ROLE_FLOW) {
      if (signal?.aborted) return this.#cancel(task, onEvent, signal);
      if (task.outputs[role] !== undefined) continue;
      // Evidence is re-read instead of stored: file contents stay out of SQLite,
      // so a resume repeats the same grant-bounded reads rather than replaying
      // a cached copy of the workspace.
      const evidence = role === 'executor' ? await this.#gatherWorkspaceEvidence(task) : null;
      const cancelled = await this.#runRole(task, role, activeStatus, evidence, onEvent, signal);
      if (cancelled) return this.#finish(task, onEvent);
      if (task.status !== activeStatus) { settled = false; break; }
    }
    if (settled && task.status === TASK_STATUS.REVIEWING) this.#settleByVerdict(task);
    return this.#finish(task, onEvent);
  }

  async #runRole(task, role, activeStatus, workspaceEvidence, onEvent, signal) {
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
        workspaceEvidence,
        signal,
        onRetry: (info) => task.record('provider_retry', { role, ...info }),
      });
      task.saveOutput(role, content);
    } catch (error) {
      if (signal?.aborted) {
        task.cancel(cancellationReason(signal));
        this.#persist(task);
        this.#emit(onEvent, { type: 'role_cancelled', role, task: task.snapshot() });
        return true;
      }
      task.record('provider_call_failed', { role, message: error instanceof Error ? error.message : 'Unknown provider failure' });
      this.#transitionIfNeeded(task, TASK_STATUS.FAILED);
      this.#persist(task);
      this.#emit(onEvent, { type: 'role_failed', role, task: task.snapshot() });
      return;
    }
    this.#persist(task);
    this.#emit(onEvent, { type: 'role_saved', role, task: task.snapshot() });
  }

  async #gatherWorkspaceEvidence(task) {
    const grants = grantsForWorkspaceRead(task.capabilityGrants);
    if (grants.length === 0 || task.workspaceRoot === null) return null;

    let resolver;
    let root;
    try {
      root = resolveWorkspaceRoot(task.workspaceRoot);
      resolver = createScopeResolver({ root, grants });
    } catch (error) {
      task.record('workspace_unavailable', { message: error instanceof Error ? error.message : String(error) });
      this.#persist(task);
      return null;
    }

    const files = [];
    const listings = [];
    const denied = [];
    for (const candidate of parseRequestedPaths(task.outputs.planner)) {
      if (!task.reserveToolCall('executor')) break;
      const wantsDirectory = candidate.endsWith('/') || candidate.endsWith('\\');
      const relPath = wantsDirectory ? candidate.replace(/[\\/]+$/, '') || '.' : candidate;
      const outcome = wantsDirectory
        ? await listWorkspaceDir({ resolver, relPath })
        : await readWorkspaceFile({ resolver, relPath });
      if (!outcome.ok) {
        denied.push({ path: outcome.relPath ?? relPath, reason: outcome.reason });
        task.record(wantsDirectory ? 'tool_listing_denied' : 'tool_denied', { path: outcome.relPath ?? relPath, reason: outcome.reason });
        continue;
      }
      if (wantsDirectory) {
        listings.push({ path: outcome.relPath, entries: outcome.entries, truncated: outcome.truncated });
        task.record('tool_listing', { path: outcome.relPath, entries: outcome.entries.length, truncated: outcome.truncated });
      } else {
        files.push({ path: outcome.relPath, content: outcome.content, truncated: outcome.truncated, totalBytes: outcome.totalBytes });
        task.record('tool_read', { path: outcome.relPath, bytes: outcome.bytes, truncated: outcome.truncated, totalBytes: outcome.totalBytes });
      }
    }

    this.#persist(task);
    if (files.length === 0 && listings.length === 0 && denied.length === 0) return null;
    return Object.freeze({ root, files, listings, denied });
  }

  #cancel(task, onEvent, signal) {
    task.cancel(cancellationReason(signal));
    this.#persist(task);
    this.#emit(onEvent, { type: 'run_cancelled', task: task.snapshot() });
    return this.#finish(task, onEvent);
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

function cancellationReason(signal) {
  const reason = signal?.reason;
  return reason instanceof Error && reason.message ? reason.message : 'user_requested';
}
