# Runtime honesty audit

Date: 2026-10-09, revised 2026-10-10 after the workspace-read UI landed. Scope:
the Node core, loopback API, and the active UI in `work/mission-ui-prototype`.
Test doubles remain confined to `test/`.

| Surface | Classification | Evidence / current behavior |
| --- | --- | --- |
| Mission lifecycle | REAL | `TaskRun`, `Orchestrator`, and SQLite persist objectives, role outputs, state transitions, budget, and append-only audit entries. |
| Provider calls | REAL | `OpenAICompatibleProvider` sends authenticated OpenAI-compatible HTTP requests; secret resolution stays in Windows Credential Manager. No successful-output fallback exists. |
| Planner → executor → reviewer handoff | REAL | Each role receives the persisted prior outputs; the reviewer verdict controls completion or human approval. |
| Provider retry, timeout, rate-limit handling | REAL | Bounded retries occur within one budgeted logical call and are audited. |
| SSE updates | REAL | The loopback server broadcasts snapshots after actual lifecycle events. |
| Cancel | REAL | `POST /api/missions/:id/cancel` aborts the active request, records `mission_cancelled`, persists `cancelled`, and broadcasts lifecycle state. |
| UI mission list, outputs, progress, permissions | REAL | The active UI fetches the loopback API and consumes persisted mission snapshots/SSE events. |
| Workspace read (`workspace.read`) | REAL | `src/workspace-scope.js` + `src/tools/workspace-read.js`: the orchestrator resolves every path the plan names against the mission root, enforces containment, a secret deny-list, symlink resolution, size caps and a separate tool budget, then passes the bytes to the executor. Grants, roots, reads and refusals are persisted on the mission and audited (`tool_read`, `tool_listing`, `tool_denied`, `tool_listing_denied`). A scope is a plain path inside the root: a glob, an absolute path or a `..` climb is refused at ingress, and a scope whose real target escapes the root — a link to elsewhere — authorizes nothing. The budget that bounds those reads is set at ingress (`--max-tool-calls`, `maxToolCalls`), is a per-mission counter that survives resumes, and a resume that returns with it spent warns instead of reading nothing in silence. |
| Workspace write / process run / network request | NOT IMPLEMENTED | Declarative only: a grant is stored and audited, and no code path executes it. `workspace.write` still demands a workspace root at ingress — a path scope the future executor could not be held to is refused rather than stored, while `process.run` and `network.request` keep free-form scopes and need no root. |
| Browser folder picker (`showDirectoryPicker`) | PARTIAL | A browser-side consent gesture in the prototype's uncommitted wiring: `showDirectoryPicker({ mode: 'read' })` plus IndexedDB exposes only the directory's display name, never its absolute path, and the Node runtime never consults it. The mission's root and grants remain the only enforcement point, which is why the root comes from `hane serve --workspace` instead. |
| UI capability chips | PARTIAL, rules committed | `work/mission-ui-prototype/src/workspace-evidence.js` defines the payload and the display rules and is unit-tested: `workspace.read` carries the plain scope `.` (the mission's granted root), never the old `workspace/**` glob, and the workspace chips only become selectable after `GET /api/workspace` answers `available: true`. The composer that consumes them is not committed yet, so the prototype as it stands in this tree still sends the glob and gets a `400`. |
| “Computador ao vivo” | PARTIAL | The timeline is meant to render only persisted audit rows — `tool_read`, `tool_listing`, `tool_denied`, `tool_listing_denied`, `workspace_unavailable`, `tool_budget_exhausted` — with paths, byte counts and refusal reasons taken from the mission snapshot, plus the `used/max` tool budget; those rows are produced and tested in `workspace-evidence.js`, not yet wired into the committed panel. Shell, writing and network have no runtime behind them and are labelled as non-executed rather than shown as terminal output. |
| Artifacts | PARTIAL | Role outputs are real persisted `task_outputs` and are shown as outputs. There is no separate file-artifact store or tool-produced file runtime yet. |
| Animated avatars | PARTIAL | Activity state derives from persisted mission status/output evidence; idle blink is decorative only. |
| Configurable agents and teams up to ten | NOT IMPLEMENTED | Runtime has the fixed, real planner/executor/reviewer contract. The visible names Orion/Byte/Cipher are presentation aliases, not separately persisted agents. |
| Provider configuration UI | PARTIAL | Provider metadata is persisted and listed read-only in the UI. Add/remove/secret assignment remain deliberately CLI-only so credentials never enter the browser. |
| Messages distinct from mission objective/output | NOT IMPLEMENTED | The mission objective and role outputs are persisted; a separate user/agent message model does not exist. |
| Streaming tokens and provider cost telemetry | NOT IMPLEMENTED | The adapter accepts completed chat responses; it does not request streaming or persist usage because reliable provider usage data is not normalized yet. |
| Original `Frontend/` Figma Make app | MOCK / DESIGN SOURCE | It is an unintegrated design implementation. The active runtime surface is `work/mission-ui-prototype`. |

## Integrity rules enforced

- Missing provider configuration or missing credentials produces an explicit API error; it never generates substitute LLM text.
- A provider failure remains a failed mission and a persisted audit event.
- Capability grants are a ceiling the runtime enforces for `workspace.read` and a promise for everything else. There is still no path from an LLM output to file writes, shell, or network execution.
- File content given to a model is labelled untrusted data in the provider request, and evidence is never stored with the mission; a resume repeats the grant-bounded reads.
- The UI must present unavailable runtime capabilities as unavailable rather than inventing terminal or tool output.

## Verification performed

- `npm test`: 192 tests passed in this tree, including persistence, SSE, provider retry, an in-flight cancellation integration test, and the workspace containment suite (absolute paths, `..`, symlink escape, scope-escaping grants, deny-list case folding, credential-store paths, size cap, tool budget, denied-read auditing). The tool budget is covered at both ingresses: a non-positive `--max-tool-calls`/`maxToolCalls` is refused before any provider call, and an `approve` that raises a spent budget is tested end-to-end over HTTP — the first round reads one file and runs out, the resume warns, and the raised budget lets the next round read again and audit the missing path as `tool_denied`.
- `npm run check` over every source, bin and test file.
- `npm run build` and `npm run test:sites` in `work/mission-ui-prototype`.
- HTTP contract probed against a live `hane serve --workspace <dir>` on loopback: `GET /api/workspace` reported the resolved root, a `workspace/**` scope returned the glob refusal, an absolute or `..` scope returned the relative-path refusal, a missing root returned `Workspace root "..." does not exist.`, and a well-formed read grant reached provider resolution — the last gate before execution.
- The UI module was exercised by its own unit tests (`npm run test:sites`: 10 passed). Its consumer wiring was then driven in headless Chrome over CDP against a persisted fixture mission, in the working tree that holds that wiring: the composer sends `scope: "."`, the chips stay disabled without a server root, the panel shows the real root, grants and `used/max` tool budget, the timeline renders the audited reads and refusals with their pt-BR reasons, and a `400` from the API appears in the composer's alert instead of being swallowed. That panel code is not in the committed tree yet, so the audit records it as wiring verified but unlanded.

## External end-to-end boundary

The repository tests use deliberately isolated provider doubles only under
`test/`. A live provider call was not issued in this audit: it may consume a
user-owned credential or quota. The minimal remaining evidence gate is a
user-authorized, low-budget call with a configured provider, followed by
inspection of the resulting SQLite mission and SSE events.
