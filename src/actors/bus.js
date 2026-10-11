import { assertExecutionRef } from './envelope.js';

/**
 * The single door through which an actor says anything happened. It writes the
 * event before it tells a live client, because a browser that saw `task
 * completed` and then restarted to find no trail would be shown a past that does
 * not exist. Persisting first means the trail is always at least as far along as
 * what anyone was told.
 *
 * Nothing here knows about missions, roles, SSE or React: the bus is handed an
 * execution ref and a store, and a subscriber is a function. A throwing
 * subscriber is allowed to throw — a broadcast that fails quietly is how a run
 * ends up with witnesses nobody can find.
 */
export function createEventBus({ events, executionRef, teamId = null, subscribers = [] }) {
  const ref = assertExecutionRef(executionRef);
  if (!events?.append) throw new TypeError('createEventBus requires an event store with append().');
  const listeners = new Set(subscribers);

  return Object.freeze({
    executionRef: ref,

    /** @returns an unsubscribe function, so a request that ends can stop being a witness. */
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('subscribe requires a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * @param {{ type: string, actorId?: string|null, data?: object|null, uiEvent?: object|null }} event
     *   `data` is what the trail stores; `uiEvent` overrides the live shape when
     *   a client reads something the trail cannot hold, such as a mission snapshot.
     * @returns the stored row, ordinal included.
     */
    emit({ type, actorId = null, data = null, uiEvent = null }) {
      const stored = events.append({ executionId: ref.id, executionKind: ref.kind, teamId, actorId, type, payload: data });
      const live = uiEvent ?? {
        type,
        actorId,
        ordinal: stored.ordinal,
        ...(data !== null && typeof data === 'object' && !Array.isArray(data) ? data : { data }),
      };
      for (const listener of listeners) listener(live);
      return stored;
    },

    /** Everything after an ordinal, oldest first: the catch-up on a reconnect. */
    since({ after = 0, limit } = {}) {
      return events.since({ executionId: ref.id, after, ...(limit === undefined ? {} : { limit }) });
    },

    latest() {
      return events.latest({ executionId: ref.id });
    },
  });
}
