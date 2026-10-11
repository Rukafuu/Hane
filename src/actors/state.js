import { assertExecutionRef } from './envelope.js';

/**
 * The board several actors read and write at the same instant. Everything a
 * writer says about a key carries the revision it saw, and a write only lands on
 * top of the revision it was drafted against — so two agents finishing the same
 * section at the same time produce one winner and one visible `state_conflict`
 * rather than a silent overwrite.
 *
 * The scheduler owns this object; an agent never holds it. A model proposes a
 * board write through a task result and the runtime commits it, which is what
 * keeps "no agent writes state" true while agents still work concurrently.
 */
export function createSharedState({ executionRef, store, bus = null, audit = () => {} }) {
  const ref = assertExecutionRef(executionRef);
  if (!store?.commit) throw new TypeError('createSharedState requires a state store with commit().');

  return Object.freeze({
    executionRef: ref,

    read(key) {
      return store.read({ executionId: ref.id, key });
    },

    history(key, { limit } = {}) {
      return store.history({ executionId: ref.id, key, ...(limit === undefined ? {} : { limit }) });
    },

    /** Every key on the board, current revision and all — what a new turn is shown. */
    list() {
      return store.list({ executionId: ref.id });
    },

    /**
     * @returns {{ ok: true, revision: number }} or
     *   {{ ok: false, conflict: true, current: { revision, value } }}
     */
    commit({ key, expectedRevision, value, writerAgentId = null }) {
      const outcome = store.commit({ executionId: ref.id, key, expectedRevision, value, writerAgentId });
      if (outcome.ok) {
        if (bus) bus.emit({ type: 'actor_state_committed', actorId: writerAgentId, data: { key, revision: outcome.revision } });
        return outcome;
      }
      // Conflict is a fact about this run, not an exception: the writer re-reads
      // and decides. Auditing it is what makes the losing attempt visible.
      audit('state_conflict', {
        ...(writerAgentId === null ? {} : { agentId: writerAgentId }),
        key,
        expectedRevision,
        actualRevision: outcome.current?.revision ?? null,
      });
      return outcome;
    },

    /** Books something an agent produced. Idempotent by `effectKey`, so a retried claim never double-books. */
    putArtifact({ agentId, kind, path, bytes, sha256, taskId = null, effectKey = null }) {
      const outcome = store.putArtifact({ executionId: ref.id, agentId, kind, path, bytes, sha256, taskId, effectKey });
      if (bus && !outcome.duplicate) {
        bus.emit({
          type: 'actor_artifact_created',
          actorId: agentId,
          data: { path: outcome.artifact.path, bytes: outcome.artifact.bytes, kind: outcome.artifact.kind, taskId, artifactId: outcome.artifact.id },
        });
      }
      return outcome;
    },

    artifacts({ agentId = null, taskId = null, limit } = {}) {
      return store.listArtifacts({ executionId: ref.id, agentId, taskId, ...(limit === undefined ? {} : { limit }) });
    },
  });
}
