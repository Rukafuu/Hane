/**
 * A model asks for a tool in one of two ways. A gateway that honours the
 * `tools` field answers with structured calls; a gateway that ignores it —
 * common on free tiers — has to say so in its text. Both end up as the same
 * normalized call, and neither is trusted before the router checks it against
 * what this mission was granted.
 *
 * The fence is a separate tag from `json` on purpose: a model quoting a JSON
 * example in prose is not asking for anything, and only a block that names this
 * protocol can ever be read as one.
 */
export const TOOL_FENCE = 'hane-tool';

const FENCE_PATTERN = /```[ \t]*hane-tool[ \t]*\r?\n([\s\S]*?)```/g;

/**
 * The instruction that makes the fallback possible. It travels with the tools
 * and says exactly one shape, because a protocol the model can improvise is a
 * protocol that gets improvised into something we then have to guess at.
 */
export function renderToolProtocolHint(toolNames = []) {
  return [
    `You may call tools. To call one, answer with a fenced block tagged "${TOOL_FENCE}" containing exactly one JSON object:`,
    `{"tool":"<name>","args":{...}}`,
    `Available tool names: ${toolNames.join(', ')}.`,
    `One call per block; write no "${TOOL_FENCE}" block unless you are actually asking for that tool, and never claim a result the call did not return.`,
  ].join('\n');
}

function normalized(candidate) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const { tool, name, args, arguments: argsAlias } = candidate;
  const calledName = typeof tool === 'string' ? tool : typeof name === 'string' ? name : null;
  if (calledName === null) return null;
  const rawArgs = args !== undefined ? args : argsAlias;
  // An absent argument list is a call with no arguments, which is what `list`
  // of the workdir looks like; anything but an object is not a shape we run.
  const parameters = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
  if (typeof parameters !== 'object' || Array.isArray(parameters)) return null;
  return { name: calledName, arguments: parameters };
}

/**
 * @returns {{ calls: object[], hadFence: boolean }} each call either carries
 * `{name, arguments}` or `{malformed, raw}` — never a best guess.
 */
export function parseInlineToolCalls(text) {
  if (typeof text !== 'string' || !text.includes(TOOL_FENCE)) return { calls: [], hadFence: false };
  const calls = [];
  let hadFence = false;
  for (const match of text.matchAll(FENCE_PATTERN)) {
    hadFence = true;
    const raw = match[1].trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      calls.push({ malformed: 'invalid_json', raw: raw.slice(0, 512) });
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    if (candidates.length === 0) {
      calls.push({ malformed: 'empty_call_list', raw: raw.slice(0, 512) });
      continue;
    }
    for (const candidate of candidates) {
      const call = normalized(candidate);
      calls.push(call ?? { malformed: 'invalid_call_shape', raw: raw.slice(0, 512) });
    }
  }
  return { calls, hadFence };
}

/** Removes the protocol blocks from the text a role keeps as its answer. */
export function stripToolFences(text) {
  if (typeof text !== 'string') return text;
  return text.replace(FENCE_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** The provider's structured calls, in the same shape the inline protocol uses. */
export function normalizeNativeToolCalls(toolCalls = []) {
  return toolCalls.map((call, index) => {
    const name = call?.function?.name ?? call?.name;
    const rawArguments = call?.function?.arguments ?? call?.arguments;
    const id = typeof call?.id === 'string' ? call.id : `call-${index + 1}`;
    if (typeof name !== 'string' || name.trim() === '') {
      return { id, name: null, arguments: null, malformed: 'unnamed_call', raw: String(rawArguments ?? '').slice(0, 512) };
    }
    if (typeof rawArguments === 'object' && rawArguments !== null) {
      return { id, name, arguments: rawArguments };
    }
    if (typeof rawArguments === 'string' && rawArguments.trim() === '') {
      return { id, name, arguments: {} };
    }
    try {
      const parsed = JSON.parse(rawArguments);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { id, name, arguments: null, malformed: 'invalid_call_shape', raw: String(rawArguments).slice(0, 512) };
      }
      return { id, name, arguments: parsed };
    } catch {
      // Kept as a call the router refuses: a truncated argument blob is evidence
      // the model tried something, and dropping it would hide that from the audit.
      return { id, name, arguments: null, malformed: 'invalid_json', raw: String(rawArguments).slice(0, 512) };
    }
  });
}
