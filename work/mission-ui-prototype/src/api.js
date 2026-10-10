async function json(response) {
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).error;
    } catch {
      /* body was not JSON */
    }
    throw new Error(detail || `A API respondeu ${response.status}.`);
  }
  return response.json();
}

export const fetchMissions = () => fetch("/api/missions").then(json);

export const fetchMission = (id) => fetch(`/api/missions/${encodeURIComponent(id)}`).then(json);

export const fetchProviders = () => fetch("/api/providers").then(json);

export const createMission = (objective, provider, capabilities = []) => fetch("/api/missions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ objective, ...(provider ? { provider } : {}), ...(capabilities.length > 0 ? { capabilities } : {}) }),
}).then(json);

const missionAction = (id, action, body = {}) => fetch(`/api/missions/${encodeURIComponent(id)}/${action}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
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
