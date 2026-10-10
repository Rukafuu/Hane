import assert from "node:assert/strict";
import test from "node:test";
// The composer's default scopes are checked with the core's own grammar, so
// this test reaching outside the package is the point: it fails the day a
// default chip would make `POST /api/missions` answer 400.
import { assertCapabilityGrants, assertEnforceableScopes } from "../../../src/capabilities.js";
import { createMission, fetchWorkspace } from "../src/api.js";
import {
  CAPABILITY_OPTIONS,
  GATED_CAPABILITIES_NOTE,
  WORKSPACE_DISABLED_HINT,
  capabilityPayload,
  denialReasonLabel,
  evidenceRows,
  grantDisplay,
  isCapabilityEnabled,
  toolUsageLabel,
  workspaceRootLabel,
} from "../src/workspace-evidence.js";

const option = (name) => CAPABILITY_OPTIONS.find((item) => item.name === name);

test("sends the granted root as a plain scope instead of a glob", () => {
  for (const name of ["workspace.read", "workspace.write"]) {
    assert.equal(option(name).scope, ".", `${name} must ask for the granted root, not a path guess`);
    assert.equal(option(name).requiresServerRoot, true);
  }

  // A scope the core cannot check is a 400 in the composer, so the payload the
  // chips can produce is validated against the core's own ingress grammar.
  const payload = capabilityPayload(CAPABILITY_OPTIONS.map((item) => ({ name: item.name, scope: item.scope })));
  assert.deepEqual(payload, [
    { name: "workspace.read", scope: "." },
    { name: "workspace.write", scope: "." },
    { name: "process.run", scope: "python3, node, git" },
    { name: "network.request", scope: "pypi.org, registry.npmjs.org, api.github.com" },
  ]);
  assert.doesNotThrow(() => assertEnforceableScopes(assertCapabilityGrants(payload)), "every default scope must be enforceable");

  assert.deepEqual(capabilityPayload([null, { name: "workspace.read" }, { scope: "." }]), [], "half-made grants are not sent");
});

test("keeps the workspace chips off until the server reports a root", () => {
  const blocked = { available: false, root: null, loaded: true };
  const loading = { available: false, root: null, loaded: false };
  const ready = { available: true, root: "A:\\Hane", loaded: true };

  for (const name of ["workspace.read", "workspace.write"]) {
    assert.equal(isCapabilityEnabled(option(name), blocked), false);
    assert.equal(isCapabilityEnabled(option(name), loading), false, "an unanswered /api/workspace is not a root");
    assert.equal(isCapabilityEnabled(option(name), undefined), false);
    assert.equal(isCapabilityEnabled(option(name), { available: "yes" }), false, "only a real true enables the chip");
    assert.equal(isCapabilityEnabled(option(name), ready), true);
  }

  // The declarative grants stay selectable and keep saying nothing is executed.
  for (const name of ["process.run", "network.request"]) {
    assert.equal(isCapabilityEnabled(option(name), blocked), true);
    assert.equal(isCapabilityEnabled(option(name), ready), true);
    assert.match(option(name).detail, /não executado/i);
  }

  assert.match(WORKSPACE_DISABLED_HINT, /hane serve --workspace <pasta>/);
  assert.match(WORKSPACE_DISABLED_HINT, /Leitura e escrita só ficam disponíveis/);
  assert.match(GATED_CAPABILITIES_NOTE, /não executados/);
});

// A snapshot shaped exactly like the audit the core appends (src/orchestrator.js,
// src/tools/workspace-read.js, src/workspace-scope.js).
const mission = {
  workspaceRoot: "A:\\Hane",
  toolCalls: 6,
  maxToolCalls: 24,
  capabilityGrants: [{ name: "workspace.read", scope: "." }],
  audit: [
    { at: "2026-10-09T12:00:00.000Z", type: "task_created", detail: {} },
    { at: "2026-10-09T12:00:01.000Z", type: "tool_read", detail: { path: "src/orchestrator.js", bytes: 61440, truncated: true, totalBytes: 78912 } },
    { at: "2026-10-09T12:00:02.000Z", type: "tool_listing", detail: { path: "", entries: 12, truncated: false } },
    { at: "2026-10-09T12:00:03.000Z", type: "tool_denied", detail: { path: "../leak.txt", reason: "escapes_workspace_root" } },
    { at: "2026-10-09T12:00:04.000Z", type: "tool_listing_denied", detail: { path: ".env", reason: "denied_by_secret_policy" } },
    { at: "2026-10-09T12:00:05.000Z", type: "workspace_unavailable", detail: { message: 'Workspace root "Z:/gone" does not exist.' } },
    { at: "2026-10-09T12:00:06.000Z", type: "tool_budget_exhausted", detail: { role: "executor", maxToolCalls: 24 } },
    { at: "2026-10-09T12:00:07.000Z", type: "provider_call_failed", detail: { role: "reviewer", message: "timeout" } },
    { at: "2026-10-09T12:00:08.000Z", type: "tool_read", detail: { path: "README.md" } },
  ],
};

test("renders the real tool audit as evidence rows", () => {
  const rows = evidenceRows(mission);
  assert.equal(rows.length, 7, "only tool entries become rows, in audit order");

  assert.deepEqual(
    rows.map((row) => `${row.label} ${row.path ?? ""}`.trim()),
    [
      "lido src/orchestrator.js",
      "listado .",
      "bloqueado ../leak.txt",
      "bloqueado .env",
      "workspace indisponível",
      "orçamento de ferramentas esgotado",
      "lido README.md",
    ],
  );

  assert.equal(rows[0].meta, "61440 bytes");
  assert.equal(rows[0].marker, "truncado");
  assert.equal(rows[1].kind, "listing");
  assert.equal(rows[1].meta, "12 itens");
  assert.equal(rows[1].marker, null, "an uncut listing carries no marker");
  assert.equal(rows[2].kind, "denied");
  assert.equal(rows[2].meta, "fora da raiz da missão");
  assert.equal(rows[3].meta, "bloqueado pela política de segredos");
  assert.equal(rows[3].marker, "listagem");
  assert.equal(rows[4].meta, 'Workspace root "Z:/gone" does not exist.');
  assert.equal(rows[5].role, "executor");
  assert.equal(rows[5].marker, "limite 24");
  assert.equal(rows[6].meta, null, "a read with no byte count is not given one");
  assert.deepEqual(evidenceRows(null), []);
  assert.deepEqual(evidenceRows({ audit: null }), []);
});

test("names the denial reasons the core actually emits", () => {
  for (const reason of [
    "absolute_path_rejected",
    "escapes_workspace_root",
    "outside_granted_scope",
    "denied_by_secret_policy",
    "not_found",
    "binary_content",
  ]) {
    assert.notEqual(denialReasonLabel(reason), reason, `${reason} needs a pt-BR phrase`);
    assert.equal(denialReasonLabel(reason).includes("_"), false, `${reason} must not leak the machine string`);
  }

  assert.equal(denialReasonLabel("absolute_path_rejected"), "caminho absoluto recusado");
  assert.equal(denialReasonLabel("outside_granted_scope"), "fora do escopo concedido");
  assert.equal(denialReasonLabel("not_found"), "não encontrado");
  assert.equal(denialReasonLabel("binary_content"), "conteúdo binário");
  // Unknown reasons stay verbatim: the UI does not invent a translation.
  assert.equal(denialReasonLabel("brand_new_reason"), "brand_new_reason");
  assert.equal(denialReasonLabel(undefined), "motivo não informado");
});

test("states the workspace of a mission exactly as the snapshot has it", () => {
  assert.equal(workspaceRootLabel(mission.workspaceRoot), "A:\\Hane");
  assert.equal(workspaceRootLabel(null), "não configurado");
  assert.equal(workspaceRootLabel("  "), "não configurado");
  assert.equal(grantDisplay(mission.capabilityGrants[0]), "workspace.read(.)");
  assert.equal(toolUsageLabel(mission), "6/24");
  assert.equal(toolUsageLabel({ toolCalls: 2 }), null, "no max means no claim about the budget");
  assert.equal(toolUsageLabel({ maxToolCalls: 24 }), "?/24", "an absent counter stays unknown instead of reading as zero");
});

test("hands the API refusal to the UI and treats a missing root route as unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const reply = (body, status) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (url) => {
    if (url === "/api/workspace") return reply({ error: "No route for GET /api/workspace." }, 404);
    return reply({ error: "workspace capabilities require a workspaceRoot." }, 400);
  };

  try {
    // The 400 text is the API's own, kept verbatim so the inline notice says what
    // really happened instead of a generic "failed".
    await assert.rejects(
      () => createMission("ler o código", null, [{ name: "workspace.read", scope: "." }]),
      (error) => error.status === 400 && error.message === "workspace capabilities require a workspaceRoot.",
    );
    assert.deepEqual(await fetchWorkspace(), { available: false, root: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
