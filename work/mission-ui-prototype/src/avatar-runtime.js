// The server currently publishes task snapshots (role_saved, role_failed and
// run_finished).  This adapter intentionally derives presence only from that
// evidence; it does not manufacture agent activity.
export const avatarStateFromMission = ({ mission, role, currentRole }) => {
  if (!mission) return "idle";
  if (mission.audit?.some((entry) => entry.type === "provider_call_failed" && entry.detail?.role === role)) return "error";
  if (mission.outputs?.[role] !== undefined) return "done";
  if (mission.status === "needs_attention" || mission.status === "awaiting_approval") return "blocked";
  if (["planned", "executing", "reviewing"].includes(mission.status) && currentRole === role) return "working";
  return "waiting";
};

// The names the actor runtime publishes on a mission's event trail. They are the
// server's own (`src/actors/bus.js` writes each row before telling a client), so
// an avatar never has to guess: a state with no event behind it is not a state.
// `agent.*` names from the old reserved contract are gone because nothing ever
// published them, and an adapter keyed on fiction is how a face starts working
// on its own.
export const AVATAR_RUNTIME_EVENTS = Object.freeze({
  actor_started: "working",
  actor_state_committed: "working",
  actor_artifact_created: "working",
  actor_message: "thinking",
  actor_task_completed: "done",
  actor_stopped: "waiting",
  actor_refused: "blocked",
});

/**
 * The same event arrives in two shapes: the live broadcast flattens its payload
 * onto the event, and `GET /api/mission-events` returns the stored row with the
 * payload nested. Presence is read from either, so the catch-up after a
 * reconnect shows the same faces as the stream that was missed.
 */
const dataOf = (event) => (event?.payload !== null && typeof event?.payload === "object" ? event.payload : event ?? {});

/**
 * Presence for one teammate from one live event. The event has to name the
 * teammate: `actor_refused` with no `actorId` is the mission saying it is stuck,
 * and a mission is not a face. A stopped task says which kind of stop it was, so
 * a failure reads as failure rather than as patience.
 * @returns {string|null} a `HaneAvatar` state, or null when the event is not somebody's
 */
export function avatarStateFromActorEvent(event) {
  if (!event?.actorId || typeof event.type !== "string") return null;
  if (event.type === "actor_stopped") return dataOf(event).status === "failed" ? "error" : "waiting";
  return AVATAR_RUNTIME_EVENTS[event.type] ?? null;
}

/**
 * Fold a trail into one presence per teammate: the last event that spoke about
 * them wins, because that is the only honest reading of a run that is over. The
 * walk is oldest-first and an unknown `actorId` still gets a row — a teammate who
 * worked and was never named by the roster is information, not a gap to hide.
 * @param {readonly object[]} events mission events in any order
 * @returns {Record<string, {agentId: string, state: string, taskId: string|null, ordinal: number|null}>}
 */
export function actorPresenceFromEvents(events = []) {
  const byOrdinal = [...events].sort((left, right) => (left?.ordinal ?? 0) - (right?.ordinal ?? 0));
  const presence = {};
  for (const event of byOrdinal) {
    const state = avatarStateFromActorEvent(event);
    if (state === null) continue;
    const data = dataOf(event);
    const previous = presence[event.actorId];
    presence[event.actorId] = {
      agentId: event.actorId,
      state,
      // An event that says nothing about a task does not erase the one the
      // teammate holds: `actor_state_committed` names a board key, not a task, and
      // the interface still has to say which of the two the avatar is working on.
      taskId: typeof data.taskId === "string" ? data.taskId : previous?.taskId ?? null,
      ordinal: Number.isInteger(event.ordinal) ? event.ordinal : null,
    };
  }
  return presence;
}
