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

// Reserved contract for richer runtime instrumentation.  Consumers can feed
// this into a HaneAvatar without coupling the renderer to SSE transport.
export const AVATAR_RUNTIME_EVENTS = Object.freeze({
  "agent.started": "working",
  "agent.thinking": "thinking",
  "agent.tool.started": "working",
  "agent.tool.completed": "thinking",
  "agent.waiting": "waiting",
  "agent.blocked": "blocked",
  "agent.completed": "done",
  "agent.failed": "error",
  "agent.handoff": "waiting",
});

export function avatarStateFromRuntimeEvent(event) {
  return AVATAR_RUNTIME_EVENTS[event?.type] ?? null;
}
