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
