/** @typedef {'planner' | 'executor' | 'reviewer'} AgentRole */
/** @typedef {'draft' | 'planned' | 'executing' | 'reviewing' | 'completed' | 'awaiting_approval' | 'needs_attention' | 'failed'} TaskStatus */

export const TASK_STATUS = Object.freeze({
  DRAFT: 'draft',
  PLANNED: 'planned',
  EXECUTING: 'executing',
  REVIEWING: 'reviewing',
  COMPLETED: 'completed',
  AWAITING_APPROVAL: 'awaiting_approval',
  NEEDS_ATTENTION: 'needs_attention',
  FAILED: 'failed',
});

export const ROLE_SEQUENCE = Object.freeze(['planner', 'executor', 'reviewer']);

export const CREDENTIAL_REFERENCE_PATTERN = Object.freeze(/^local-agent-orchestrator\/[a-z0-9._-]+$/i);

export function assertObjective(objective) {
  if (typeof objective !== 'string' || objective.trim().length < 3) {
    throw new TypeError('A task objective must contain at least three characters.');
  }
  return objective.trim();
}

export function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return value;
}
