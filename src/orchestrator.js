import { roleInstruction } from './teams/execution-plan.js';
import { TASK_STATUS } from './contracts.js';
import { grantsForWorkspaceRead, resolveWorkspaceRoot } from './workspace-scope.js';
import { createWorkspaceDirSandbox } from './sandbox/workspace-dir.js';
import { createToolRouter } from './tools/router.js';
import { buildToolLoopMessages, runToolLoop } from './orchestrator/tool-loop.js';
import { TaskRun, DEFAULT_MAX_PROVIDER_CALLS } from './task-run.js';
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
 * Only the executor is offered tools. The planner plans in the dark and the
 * reviewer reads what was written: giving them a file handle would let a verdict
 * depend on bytes the mission never audited, and it would cost a call each.
 */
const TOOL_ROLES = Object.freeze(['executor']);

/**
 * @typedef {{ type: 'role_saved' | 'role_skipped_budget' | 'role_failed' | 'run_finished', role?: string, task: object }} OrchestratorEvent
 */

export class Orchestrator {
  constructor({ provider, roleProviders = null, agentCapabilityCheck = null, repository = null, idFactory = () => crypto.randomUUID() }) {
    if (!provider || typeof provider.complete !== 'function') {
      throw new TypeError('provider.complete(request) is required.');
    }
    this.provider = provider;
    this.roleProviders = roleProviders;
    this.agentCapabilityCheck = agentCapabilityCheck;
    this.repository = repository;
    this.idFactory = idFactory;
  }

  /**
   * @param {{ objective: string, maxProviderCalls?: number, providerLabel?: string|null,
   *           capabilityGrants?: readonly object[], workspaceRoot?: string|null,
   *           signal?: AbortSignal|null,
   *           onEvent?: ((event: OrchestratorEvent) => void) | null }} request
   */
  async start({ objective, teamId = null, executionPlan = null, maxProviderCalls = DEFAULT_MAX_PROVIDER_CALLS, providerLabel = null, capabilityGrants = [], workspaceRoot = null, maxToolCalls = undefined, signal = null, onEvent = null }) {
    const task = new TaskRun({
      id: this.idFactory(),
      teamId,
      executionPlan,
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
    if (task.executionPlan && ROLE_FLOW.some(({role})=>typeof this.roleProviders?.[role]?.complete !== 'function')) throw new TypeError('Configured executions require all three role providers.');
    this.#persist(task);
    let settled = true;
    for (const { role, activeStatus } of ROLE_FLOW) {
      if (signal?.aborted) return this.#cancel(task, onEvent, signal);
      if (task.outputs[role] !== undefined) continue;
      const cancelled = await this.#runRole(task, role, activeStatus, onEvent, signal);
      if (cancelled) return this.#finish(task, onEvent);
      if (task.status !== activeStatus) { settled = false; break; }
    }
    if (settled && task.status === TASK_STATUS.REVIEWING) this.#settleByVerdict(task);
    return this.#finish(task, onEvent);
  }

  async #runRole(task, role, activeStatus, onEvent, signal) {
    this.#transitionIfNeeded(task, activeStatus);
    if (!task.reserveProviderCall(role)) {
      this.#transitionIfNeeded(task, TASK_STATUS.NEEDS_ATTENTION);
      this.#persist(task);
      this.#emit(onEvent, { type: 'role_skipped_budget', role, task: task.snapshot() });
      return;
    }
    const provider = this.#providerFor(task,role);
    const router = this.#routerFor(task, role);
    if (task.executionPlan) {
      const index=ROLE_FLOW.findIndex(item=>item.role===role), previous=ROLE_FLOW[index-1]?.role;
      if (previous && task.outputs[previous]) task.record('agent_handoff',{role,fromAgentId:task.executionPlan.roles[previous].agentId,fromAgentName:task.executionPlan.roles[previous].name,fromRole:previous});
    }
    try {
      const content = router === null
        ? await provider.complete({
          role,
          objective: task.objective,
          instruction: roleInstruction(task.executionPlan,role,ROLE_INSTRUCTIONS[role]),
          ...(task.executionPlan ? {referenceDocuments:task.executionPlan.roles[role].instructionFiles} : {}),
          priorOutputs: { ...task.outputs },
          signal,
          onRetry: (info) => task.record('provider_retry', { role, ...info }),
        })
        : await this.#runToolLoop(task, role, router, onEvent, signal);
      if (content === null) {
        // The loop spent its turns without the model ever answering. Saving half a
        // thought as a role output would invent a result, so the mission stops here
        // for a human to raise the budget.
        this.#transitionIfNeeded(task, TASK_STATUS.NEEDS_ATTENTION);
        this.#persist(task);
        this.#emit(onEvent, { type: 'role_skipped_budget', role, task: task.snapshot() });
        return;
      }
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

  /**
   * The tools this mission may offer, or null when it may offer none. A grant
   * without a root and an adapter that cannot take a turn both mean the role runs
   * exactly as it did before tools existed — the second is audited, because a
   * mission that silently lost its tools is a mission whose result means less
   * than it looks.
   */
  #providerFor(task,role) { return task.executionPlan ? this.roleProviders[role] : this.provider; }

  #routerFor(task, role) {
    if (!TOOL_ROLES.includes(role)) return null;
    if (task.executionPlan && (!task.executionPlan.roles[role].capabilities.includes('workspace.read')
      || (this.agentCapabilityCheck && !this.agentCapabilityCheck(task.executionPlan.roles[role].agentId,'workspace.read')))) return null;
    if (task.workspaceRoot === null || grantsForWorkspaceRead(task.capabilityGrants).length === 0) return null;
    if (typeof this.#providerFor(task,role).completeTurn !== 'function') {
      task.record('tool_loop_unavailable', { ...(task.executionPlan ? {role} : {}), reason: 'provider_cannot_take_a_turn' });
      return null;
    }

    let sandbox;
    try {
      sandbox = createWorkspaceDirSandbox({ root: resolveWorkspaceRoot(task.workspaceRoot), grants: task.capabilityGrants });
    } catch (error) {
      task.record('workspace_unavailable', { ...(task.executionPlan ? {role} : {}), message: error instanceof Error ? error.message : String(error) });
      this.#persist(task);
      return null;
    }
    const router = createToolRouter({ sandbox, grants: task.capabilityGrants });
    return router.schemas.length === 0 ? null : router;
  }

  /**
   * The executor asks, the sandbox answers, and the answer goes back into the
   * same message list — so this is the model using a tool, not the orchestrator
   * guessing which files it wanted. Every outcome is persisted and broadcast as
   * it happens: a panel that filled up only at the end of the batch would be a
   * log, and the point of the loop is that the work is watchable.
   *
   * The loop itself is `src/orchestrator/tool-loop.js`; this is the mission's
   * reading of it, handing over the ledger, the audit line and the revocation
   * check that only the mission can answer.
   */
  async #runToolLoop(task, role, router, onEvent, signal) {
    const binding = task.executionPlan?.roles[role];
    return runToolLoop({
      provider: this.#providerFor(task, role),
      router,
      role,
      messages: buildToolLoopMessages({
        instruction: roleInstruction(task.executionPlan, role, ROLE_INSTRUCTIONS[role]),
        objective: task.objective,
        priorOutputs: task.outputs,
        toolNames: router.names,
        referenceDocuments: binding?.instructionFiles ?? [],
      }),
      ledger: task,
      audit: (type, detail) => task.record(type, detail),
      roleTag: task.executionPlan ? { role } : {},
      // A frozen prompt must not resurrect a capability revoked while inference was in flight.
      capabilityRevoked: () => (binding && this.agentCapabilityCheck && !this.agentCapabilityCheck(binding.agentId, 'workspace.read') ? 'agent_capability_revoked' : null),
      signal,
      onToolAudited: () => {
        this.#persist(task);
        this.#emit(onEvent, { type: 'tool_audited', role, task: task.snapshot() });
      },
    });
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
