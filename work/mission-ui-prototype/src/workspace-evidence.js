// Everything in this module is derived from what the local API actually
// publishes: the mission snapshot (workspaceRoot, capabilityGrants, toolCalls,
// maxToolCalls) and its append-only audit entries. Nothing here invents a row,
// a path, or a byte count, and nothing presents a capability as working unless
// the core records it.

/**
 * A workspace grant is a relative path. `.` means "the root this mission was
 * granted", which is the only scope the core can enforce without the browser
 * guessing at an absolute path. Globs are not scopes, so they are never sent.
 */
export const WORKSPACE_ROOT_SCOPE = ".";

/**
 * The two workspace grants only mean something when the server was launched
 * with a root (`hane serve --workspace <dir>`); `GET /api/workspace` says
 * whether that happened. The remaining grant is selectable and carries the
 * scope the core would enforce: a program allowlist, never a sentence, because
 * a sentence authorizes nothing. Nothing here is executed yet and the labels
 * say so.
 *
 * `network.request` is deliberately absent. The name stays valid in the core
 * (`src/capabilities.js`), in stored missions and in backups, but no code path
 * on this machine lets a grant open a socket: egress is only decided by the
 * box's proxy and `nftables`, which do not exist yet. A chip that authorizes
 * nothing is not an honest option, so the UI does not offer it.
 */
export const CAPABILITY_OPTIONS = Object.freeze([
  { name: "workspace.read", scope: WORKSPACE_ROOT_SCOPE, label: "Ler workspace", detail: "Leitura real dentro da raiz concedida a esta missão", requiresServerRoot: true },
  { name: "workspace.write", scope: WORKSPACE_ROOT_SCOPE, label: "Escrever no workspace", detail: "Não executado · a escrita ainda não tem runtime atrás deste grant", requiresServerRoot: true },
  { name: "process.run", scope: "python3, node, git", label: "Executar comandos", detail: "Não executado · nenhum comando roda a partir deste grant" },
]);

export const WORKSPACE_DISABLED_HINT = "Leitura e escrita só ficam disponíveis quando o servidor é iniciado com hane serve --workspace <pasta>.";

export const WORKSPACE_ROW_HINT = "Indisponível · inicie com hane serve --workspace <pasta>";

/** Machine reasons emitted by src/workspace-scope.js, src/tools/workspace-read.js and src/sandbox/interface.js. */
export const DENIAL_REASON_LABELS = Object.freeze({
  absolute_path_rejected: "caminho absoluto recusado",
  escapes_workspace_root: "fora da raiz da missão",
  outside_granted_scope: "fora do escopo concedido",
  denied_by_secret_policy: "bloqueado pela política de segredos",
  not_found: "não encontrado",
  binary_content: "conteúdo binário",
  not_a_file: "não é um arquivo",
  not_a_directory: "não é um diretório",
  invalid_path: "caminho inválido",
  read_failed: "falha ao ler",
  list_failed: "falha ao listar",
  capability_not_available: "sem executor nesta máquina",
  // The messaging gateway's refusals: a peer message is denied by the roster and
  // the grant, and the user reads which of the two stopped it.
  sender_not_in_execution: "este agente não integra mais a execução",
  recipient_not_in_execution: "o destinatário não integra a execução",
  recipient_ambiguous: "dois colegas compartilham esse nome",
  self_message_not_allowed: "o agente não pode falar consigo mesmo",
  peer_not_granted: "colega fora da concessão de mensagem",
  invalid_message: "mensagem inválida",
  hop_limit_exceeded: "a cadeia de respostas atingiu o limite",
  pair_limit_exceeded: "este colega já enviou mensagens demais para o mesmo destino",
  actor_inbound_limit_exceeded: "o destinatário já absorveu mensagens demais",
});

/** An unknown reason is shown verbatim rather than translated into a guess. */
export function denialReasonLabel(reason) {
  if (typeof reason !== "string" || reason.trim() === "") return "motivo não informado";
  return DENIAL_REASON_LABELS[reason] ?? reason;
}

/** A grant the composer sends: name plus the scope the core will enforce. */
export function capabilityGrant(option) {
  return { name: option.name, scope: option.scope };
}

/** Grants handed to `POST /api/missions`; the server needs no root of its own. */
export function capabilityPayload(grants = []) {
  return grants
    .filter((grant) => typeof grant?.name === "string" && typeof grant?.scope === "string")
    .map((grant) => ({ name: grant.name, scope: grant.scope }));
}

/**
 * The workspace grants are only selectable when the server reports a root.
 * A missing or failing `/api/workspace` counts as unavailable, never as ready.
 */
export function isCapabilityEnabled(option, serverWorkspace) {
  if (!option) return false;
  if (!option.requiresServerRoot) return true;
  // Only a real `available: true` opens the chip; a missing, failing or oddly
  // shaped /api/workspace stays "unavailable".
  return serverWorkspace?.available === true;
}

export const workspaceRootLabel = (root) => (typeof root === "string" && root.trim() !== "" ? root : "não configurado");

export const grantDisplay = (grant) => `${grant.name}(${grant.scope})`;

export function toolUsageLabel(mission) {
  if (!Number.isInteger(mission?.maxToolCalls)) return null;
  const used = Number.isInteger(mission.toolCalls) ? mission.toolCalls : "?";
  return `${used}/${mission.maxToolCalls}`;
}

/**
 * Non-executed affordances keep their own label so the panel never reads as
 * though writing, shell or network had run.
 */
export const GATED_CAPABILITIES_NOTE = "escrita e comandos · não executados";

const EVIDENCE_TYPES = new Set(["tool_read", "tool_listing", "tool_denied", "tool_listing_denied", "workspace_unavailable", "tool_budget_exhausted"]);

// "." is what the core audits for the granted root itself: the relative path of
// the root is the empty string.
const shownPath = (value) => (typeof value === "string" && value !== "" ? value : WORKSPACE_ROOT_SCOPE);

const count = (value) => (Number.isFinite(value) ? value : null);

function rowFor(entry, index) {
  const detail = entry.detail ?? {};
  const base = {
    id: `${entry.at ?? "audit"}-${entry.type}-${index}`,
    kind: "tool",
    at: entry.at ?? null,
    role: typeof detail.role === "string" ? detail.role : null,
    label: entry.type,
    path: null,
    meta: null,
    marker: null,
  };

  if (entry.type === "tool_read") {
    const bytes = count(detail.bytes);
    return { ...base, kind: "read", label: "lido", path: shownPath(detail.path), meta: bytes === null ? null : `${bytes} bytes`, marker: detail.truncated ? "truncado" : null };
  }

  if (entry.type === "tool_listing") {
    const items = count(detail.entries);
    return { ...base, kind: "listing", label: "listado", path: shownPath(detail.path), meta: items === null ? null : `${items} itens`, marker: detail.truncated ? "truncado" : null };
  }

  if (entry.type === "tool_denied" || entry.type === "tool_listing_denied") {
    return { ...base, kind: "denied", label: "bloqueado", path: shownPath(detail.path), meta: denialReasonLabel(detail.reason), marker: entry.type === "tool_listing_denied" ? "listagem" : null };
  }

  if (entry.type === "workspace_unavailable") {
    return { ...base, kind: "unavailable", label: "workspace indisponível", path: null, meta: typeof detail.message === "string" && detail.message !== "" ? detail.message : "sem mensagem do servidor" };
  }

  if (entry.type === "tool_budget_exhausted") {
    const max = count(detail.maxToolCalls);
    return { ...base, kind: "budget", label: "orçamento de ferramentas esgotado", path: null, meta: null, marker: max === null ? null : `limite ${max}` };
  }

  return null;
}

/**
 * Real tool evidence for the live computer surface: only entries the mission
 * actually recorded, in the order the audit stores them.
 */
export function evidenceRows(mission) {
  const audit = mission?.audit;
  if (!Array.isArray(audit)) return [];
  return audit
    .map((entry, index) => (EVIDENCE_TYPES.has(entry?.type) ? rowFor(entry, index) : null))
    .filter((row) => row !== null);
}

/**
 * A concurrent run has its own work list, so the interface shows as many points
 * as there are tasks rather than a fixed three-step band. The payload is the
 * server's `GET /api/missions/:id/actors`: who was booked, what they hold, and
 * the note the scheduler wrote when a task stopped for a reason.
 */
export const ACTOR_TASK_STATUS_LABELS = Object.freeze({
  pending: "na fila",
  ready: "pronta",
  running: "em execução",
  completed: "concluída",
  failed: "falhou",
  blocked: "bloqueada",
});

export const actorTaskStatusLabel = (status) => ACTOR_TASK_STATUS_LABELS[status] ?? status;

export function actorWorkPoints(actorsPayload) {
  const actors = Array.isArray(actorsPayload?.actors) ? actorsPayload.actors : [];
  return actors.flatMap((actor) => (Array.isArray(actor?.tasks) ? actor.tasks.map((task) => ({
    id: `${actor.agentId}:${task.id}`,
    taskId: task.id,
    title: task.title,
    status: task.status,
    label: actorTaskStatusLabel(task.status),
    agentId: actor.agentId,
    agentName: actor.name,
    note: typeof task.note === "string" && task.note !== "" ? task.note : null,
    attempts: Number.isInteger(task.attempts) ? task.attempts : null,
  })) : []));
}

/** How many teammates hold a task at the instant the payload was read. */
export function activeActorCount(actorsPayload) {
  return actorWorkPoints(actorsPayload).filter((point) => point.status === "running").length;
}

export function activeActorsLabel(count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  return count === 1 ? "1 ator ativo" : `${count} atores ativos`;
}

const ACTOR_TRAIL_TYPES = new Set([
  "actor_started",
  "actor_task_completed",
  "actor_stopped",
  "actor_refused",
  "actor_message",
  "actor_state_committed",
]);

// Same two shapes as the avatars read: a live broadcast flattens its payload,
// a stored trail row nests it under `payload`.
const trailData = (event) => (event?.payload !== null && typeof event?.payload === "object" ? event.payload : event ?? {});

const trailText = (value) => (typeof value === "string" && value !== "" ? value : null);

/**
 * The live computer for an actor run, built from the mission's own event trail:
 * one row per thing a teammate did, in the order the server wrote it. There is
 * no row here for a mission that said nothing, which is the point — a run that
 * is idle reads as idle.
 * @param {readonly object[]} events `GET /api/mission-events` rows or live SSE events
 */
export function actorEvidenceRows(events = []) {
  if (!Array.isArray(events)) return [];
  return events
    .slice()
    .sort((left, right) => (left?.ordinal ?? 0) - (right?.ordinal ?? 0))
    .map((event) => {
      if (!ACTOR_TRAIL_TYPES.has(event?.type)) return null;
      const data = trailData(event);
      const base = {
        id: `${event.ordinal ?? "trail"}-${event.type}-${event.actorId ?? "mission"}`,
        ordinal: Number.isInteger(event.ordinal) ? event.ordinal : null,
        at: trailText(event.createdAt) ?? trailText(data.at) ?? null,
        agentId: trailText(event.actorId),
        type: event.type,
      };

      if (event.type === "actor_started") {
        return { ...base, kind: "task", label: "começou", text: trailText(data.title) ?? trailText(data.taskId), meta: Number.isInteger(data.attempts) && data.attempts > 1 ? `${data.attempts}ª tentativa` : null };
      }
      if (event.type === "actor_task_completed") {
        const characters = Number.isFinite(data.characters) ? data.characters : null;
        return { ...base, kind: "done", label: "concluiu", text: trailText(data.resultKey) ?? trailText(data.taskId), meta: characters === null ? null : `${characters} caracteres`, marker: data.stateConflict ? "conflito de estado" : null };
      }
      if (event.type === "actor_stopped") {
        return { ...base, kind: data.status === "failed" ? "error" : "stopped", label: data.status === "failed" ? "falhou" : "parou", text: trailText(data.taskId), meta: denialReasonLabel(trailText(data.reason) ?? "motivo não informado") };
      }
      if (event.type === "actor_refused") {
        const tasks = Array.isArray(data.tasks) ? data.tasks.filter((id) => typeof id === "string") : [];
        return { ...base, kind: "denied", label: "recusado", text: tasks.length > 0 ? tasks.join(", ") : trailText(data.taskId), meta: denialReasonLabel(trailText(data.reason) ?? "motivo não informado") };
      }
      if (event.type === "actor_state_committed") {
        const revision = Number.isInteger(data.revision) ? data.revision : null;
        return { ...base, kind: "state", label: "estado escrito", text: trailText(data.key), meta: revision === null ? null : `revisão ${revision}` };
      }
      // A message row says that a teammate talked to a teammate. The body stays out
      // of the work strip on purpose: it is in the inbox, where the user can read it
      // with a sender and a delivery status, not as decoration.
      return { ...base, kind: "message", label: "mensagem", text: `${trailText(data.fromAgentId) ?? "?"} → ${trailText(data.toAgentId) ?? "?"}`, meta: data.priority === "high" ? "urgente" : null };
    })
    .filter((row) => row !== null);
}
