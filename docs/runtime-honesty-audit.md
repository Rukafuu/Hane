# Runtime honesty audit

Date: 2026-10-09. Scope: the Node core, loopback API, and the active UI in
`work/mission-ui-prototype`. Test doubles remain confined to `test/`.

| Surface | Classification | Evidence / current behavior |
| --- | --- | --- |
| Mission lifecycle | REAL | `TaskRun`, `Orchestrator`, and SQLite persist objectives, role outputs, state transitions, budget, and append-only audit entries. |
| Provider calls | REAL | `OpenAICompatibleProvider` sends authenticated OpenAI-compatible HTTP requests; secret resolution stays in Windows Credential Manager. No successful-output fallback exists. |
| Planner → executor → reviewer handoff | REAL | Each role receives the persisted prior outputs; the reviewer verdict controls completion or human approval. |
| Provider retry, timeout, rate-limit handling | REAL | Bounded retries occur within one budgeted logical call and are audited. |
| SSE updates | REAL | The loopback server broadcasts snapshots after actual lifecycle events. |
| Cancel | REAL | `POST /api/missions/:id/cancel` aborts the active request, records `mission_cancelled`, persists `cancelled`, and broadcasts lifecycle state. |
| UI mission list, outputs, progress, permissions | REAL | The active UI fetches the loopback API and consumes persisted mission snapshots/SSE events. |
| “Computador ao vivo” | PARTIAL | The UI shows persisted execution audit events only. The product has no approved sandbox/tool runtime, so it explicitly says that shell, workspace, and network execution are unavailable. |
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

- `npm test`: 158 tests passed, including persistence, SSE, provider retry, an in-flight cancellation integration test, and the workspace containment suite (absolute paths, `..`, symlink escape, deny-list, size cap, tool budget, denied-read auditing).
- `npm run check` over every source, bin and test file.
- `npm run build` and `npm run test:sites` in `work/mission-ui-prototype`: build completed and 4 Sites tests passed.

## External end-to-end boundary

The repository tests use deliberately isolated provider doubles only under
`test/`. A live provider call was not issued in this audit: it may consume a
user-owned credential or quota. The minimal remaining evidence gate is a
user-authorized, low-budget call with a configured provider, followed by
inspection of the resulting SQLite mission and SSE events.
