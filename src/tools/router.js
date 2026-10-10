import { availableToolNames, toolFor, toolSchemas } from './registry.js';

/**
 * The one place where a model's request becomes a sandbox call. It knows the
 * grants and the tool table and nothing else — budget, audit and message
 * history stay with the orchestrator, so a refusal here is a fact about this
 * mission rather than a policy decided twice.
 */
export function createToolRouter({ sandbox, grants = [] }) {
  const names = availableToolNames(grants);

  return Object.freeze({
    names: Object.freeze([...names]),
    schemas: Object.freeze(toolSchemas(names)),
    sandboxId: sandbox.id,

    /**
     * @param {{name?: string, arguments?: object, malformed?: string, raw?: string}} call
     *   as normalized by the provider or the inline protocol.
     * @returns the sandbox outcome tagged `finished` or `denied`, or a
     * `refused` envelope for a call that never reached the sandbox. A call that
     * cannot be read is refused with its raw text attached: the audit has to show
     * the model asked for something even when we could not tell what.
     */
    async execute(call) {
      if (typeof call?.name !== 'string' || call.name.trim() === '') {
        return { ok: false, status: 'refused', reason: call?.malformed ?? 'unnamed_call', raw: call?.raw ?? null };
      }
      if (call.malformed) {
        return { ok: false, status: 'refused', name: call.name, reason: call.malformed, raw: call.raw };
      }
      const tool = toolFor(call.name);
      if (tool === null) {
        return { ok: false, status: 'refused', name: call.name, reason: 'unknown_tool' };
      }
      if (!names.includes(tool.name)) {
        return { ok: false, status: 'refused', name: tool.name, reason: 'capability_not_granted', capability: tool.capability };
      }
      if (!sandbox.executable.includes(tool.verb)) {
        return { ok: false, status: 'refused', name: tool.name, reason: 'capability_not_available', verb: tool.verb };
      }

      const outcome = await sandbox[tool.verb]({ path: call.arguments?.path });
      return { ...outcome, tool: tool.name, verb: tool.verb, status: outcome.ok ? 'finished' : 'denied' };
    },
  });
}
