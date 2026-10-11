import { TASK_STATUS } from './contracts.js';

const VERDICT_PATTERN = /\b(approved|revise|needs_attention|needs attention)\b/gi;

/**
 * Extracts the reviewer's verdict from free text. Fail-safe by design: output
 * without a recognizable verdict maps to 'verdict_unparsed' so a task is never
 * completed on an ambiguous review.
 * @param {string} text
 * @returns {'approved' | 'revise' | 'needs_attention' | 'verdict_unparsed'}
 */
export function parseVerdict(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return 'verdict_unparsed';
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim().length === 0) continue;
    return lastVerdictIn(lines[index]) ?? lastVerdictIn(text) ?? 'verdict_unparsed';
  }
  return 'verdict_unparsed';
}

function lastVerdictIn(text) {
  VERDICT_PATTERN.lastIndex = 0;
  let match = null;
  let verdict = null;
  while ((match = VERDICT_PATTERN.exec(text)) !== null) verdict = match[1];
  if (verdict === null) return null;
  const normalized = verdict.toLowerCase();
  return normalized === 'needs attention' ? 'needs_attention' : normalized;
}

/**
 * What a review means for the mission's status. Both orchestration styles settle
 * on the same rule — a verdict nobody can read never completes a run — so it
 * lives here rather than in one of them, where the second would copy it.
 * @param {{ outputs: Record<string, string>, record(type: string, detail: object): void,
 *           transition(status: string): void }} task
 */
export function settleByVerdict(task) {
  const verdict = parseVerdict(task.outputs.reviewer);
  task.record(verdict === 'verdict_unparsed' ? 'verdict_unparsed' : 'verdict_parsed', { verdict });
  if (verdict === 'approved') task.transition(TASK_STATUS.COMPLETED);
  else if (verdict === 'revise') task.transition(TASK_STATUS.AWAITING_APPROVAL);
  else task.transition(TASK_STATUS.NEEDS_ATTENTION);
  return verdict;
}
