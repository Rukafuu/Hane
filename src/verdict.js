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
