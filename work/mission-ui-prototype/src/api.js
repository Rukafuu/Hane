/** Carries the status so a caller can show the API's own message inline. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function json(response) {
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("hane-session-expired"));
    let detail = "";
    try {
      detail = (await response.json()).error;
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(detail || `A API respondeu ${response.status}.`, response.status);
  }
  return response.json();
}

export const fetchMissions = () => fetch("/api/missions").then(json);

export const fetchMission = (id) => fetch(`/api/missions/${encodeURIComponent(id)}`).then(json);

export const fetchProviders = () => fetch("/api/providers").then(json);

/**
 * Whether the server itself owns a workspace root (`hane serve --workspace
 * <dir>`). Older servers have no route here, so a failed or unexpected response
 * is reported as "no root" instead of being guessed at.
 */
export async function fetchWorkspace() {
  try {
    const data = await fetch("/api/workspace").then(json);
    return { available: data?.available === true, root: typeof data?.root === "string" && data.root.trim() !== "" ? data.root : null };
  } catch {
    return { available: false, root: null };
  }
}

export const fetchOnboarding = () => fetch("/api/onboarding").then(json);

export const startGitHubAuthorization = () => fetch("/api/onboarding/github/device", { method: "POST", headers: { "x-hane-request": "1" } }).then(json);

export const pollGitHubAuthorization = (id) => fetch(`/api/onboarding/github/device/${encodeURIComponent(id)}/poll`, { method: "POST", headers: { "x-hane-request": "1" } }).then(async (response) => {
  if (response.status === 202) return { status: "pending" };
  return json(response);
});

/**
 * A workspace grant without a server-side root, or a glob scope, is rejected by
 * the core with 400; `json` turns that body into an `ApiError` carrying the
 * API's own message so the composer can show it instead of failing silently.
 */
export const createMission = (objective, provider, capabilities = [], limits = {}) => fetch("/api/missions", {
  method: "POST",
  headers: { "content-type": "application/json", "x-hane-request": "1" },
  body: JSON.stringify({ objective, ...(limits.teamId ? { teamId: limits.teamId } : {}), ...(limits.maxProviderCalls ? { maxProviderCalls: limits.maxProviderCalls } : {}), ...(limits.maxToolCalls ? { maxToolCalls: limits.maxToolCalls } : {}), ...(provider ? { provider } : {}), ...(capabilities.length > 0 ? { capabilities } : {}) }),
}).then(json);

const missionAction = (id, action, body = {}) => fetch(`/api/missions/${encodeURIComponent(id)}/${action}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hane-request": "1" },
  body: JSON.stringify(body),
}).then(json);

export const approveMission = (id) => missionAction(id, "approve");

export const retryMission = (id, options) => missionAction(id, "retry", options);

export const cancelMission = (id) => missionAction(id, "cancel");

export function openMissionEvents(onEvent) {
  // ?noevents lets headless screenshot tooling settle the page; SSE never closes on its own.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("noevents")) return () => {};
  const source = new EventSource("/api/events");
  source.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => source.close();
}
