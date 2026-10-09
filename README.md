# Hane — local agent orchestrator

Hane (`local-agent-orchestrator`) is a zero-dependency, local-first core that
runs a user objective through three accountable roles — **planner**, **executor**
and **reviewer** — under a hard call budget, and records everything it did in an
append-only audit trail. Inference comes from a provider the user configures;
control plane and data stay on the machine.

Nothing here reads, writes, or executes workspace files. A model response alone
never becomes a shell command.

## What is in the box

| Path | Role |
| --- | --- |
| `src/contracts.js`, `task-run.js`, `orchestrator.js`, `verdict.js` | the lifecycle core: statuses, budget, audit, verdict parsing |
| `src/providers/` | provider configuration, the credential → provider factory, the OpenAI-compatible adapter |
| `src/storage/` | SQLite handle, numbered migrations, task repository, provider-config store |
| `src/credentials/` | Windows Credential Manager bridge (PowerShell, stdin-only payload) |
| `src/cli/`, `bin/hane.js` | the `hane` command |
| `src/server/mission-server.js` | loopback HTTP API + SSE events for a UI |
| `work/mission-ui-prototype/` | UI prototype that consumes the HTTP API |
| `docs/mvp-contract.md` | the boundary this codebase refuses to cross |

Requires Node **22.13.0 or newer** (`node:sqlite` is used without a flag).
Credential storage requires **Windows**; everything else runs anywhere.

## Quickstart

```powershell
# 1. Register an OpenAI-compatible provider. No key is involved yet.
node bin/hane.js provider add --label openrouter --base-url https://openrouter.ai/api/v1 --model meta-llama/llama-3.1-8b-instruct:free

# 2. Put the key in the Windows Credential Manager. Paste or pipe it; it is never an argument.
node bin/hane.js provider set-secret openrouter

# 3. Run a real, audited, persisted mission.
node bin/hane.js run "Summarize the risks of migrating to ESM" --provider openrouter

# 4. Inspect, resume, or approve recorded missions.
node bin/hane.js missions
node bin/hane.js mission <id>
node bin/hane.js retry <id> --max-calls 5
node bin/hane.js approve <id>

# 5. Serve the mission API and the UI on loopback.
node bin/hane.js serve --port 7788
```

## Commands

```powershell
npm test        # node:test suite, no dependencies
npm run check   # node --check over every source, bin and test file
npm run verify  # check + test
```

## CLI reference

```text
hane provider add --label <name> --base-url <url> --model <id> [--max-tokens N]
hane provider list
hane provider remove <label>
hane provider set-secret <label>          # reads the secret from stdin, no echo
hane run "<objective>" [--provider <label>] [--max-calls N] [--db <path>] [--json]
hane missions [--db <path>]
hane mission <id> [--db <path>] [--json]
hane retry <id> [--provider <label>] [--max-calls N] [--db <path>] [--json]
hane approve <id> [--provider <label>] [--max-calls N] [--db <path>] [--json]
hane serve [--port N] [--host <addr>] [--db <path>] [--provider <label>]
```

The default database is `outputs/hane.sqlite`, resolved from the package root so
the cwd never matters. `--json` prints only the task snapshot, which makes the
CLI pipeable.

Exit codes: `0` completed · `1` usage, configuration or credential error ·
`2` `needs_attention` or `awaiting_approval` · `3` `failed` · `130` interrupted.

## Lifecycle

```text
draft -> planned -> executing -> reviewing -> completed
                                        |-> awaiting_approval (verdict: revise)
                                        |-> needs_attention   (verdict: needs_attention, or unparseable)
any role -> failed
budget exhausted -> needs_attention
```

The reviewer's verdict closes the cycle. `revise` parks the run in
`awaiting_approval` rather than spending more calls, because rework is a budget
decision that belongs to a human — `hane approve <id>` is that decision. A
verdict that cannot be parsed never completes a task.

Interrupted states are resumable. A resume re-runs only the roles with no saved
output, and each role is persisted as it finishes, so `Ctrl+C` mid-mission leaves
a real, resumable record behind.

## Budget, calls and retries

`--max-calls` is the number of **logical role calls**, checked before every
provider request; a reserved call that fails is still spent.

Transport flakiness is handled one level down. A request that hits a rate limit,
a server error, a timeout or a dropped connection is retried inside a single
logical call, with bounded attempts, exponential backoff plus jitter, and respect
for `Retry-After`. Each retry is written to the audit trail as `provider_retry`
and does not consume budget: it is the same call delivered again, not an extra
call.

## Secrets

- A provider configuration is declarative metadata: label, base URL, model,
  optional `max_tokens`, credential *reference*. There is no secret column in
  SQLite, and any object carrying `apiKey`, `secret` or `token` is rejected.
- The value lives only in the Windows Credential Manager, addressed as
  `local-agent-orchestrator/<provider>`, reached through a PowerShell bridge
  that takes its payload over stdin. Keys are never read from disk or from
  environment variables.
- Each mission resolves the secret exactly once, in memory, for the lifetime of
  one provider instance. It is never returned, logged, persisted, or sent over
  the HTTP API — `hane provider set-secret` is CLI-only by design.
- Off Windows, credential operations fail loudly instead of silently falling
  back to a weaker store.

## Storage and migrations

`src/storage/migrations.js` owns the schema as a numbered, append-only list;
`openHaneDatabase()` applies whatever the file has not recorded yet, one
transaction per migration, and older databases are adopted by an idempotent
baseline. Changing applied migrations is not an option — a new schema change is
a new number.

Audit entries are append-only as well: a save never rewrites history, and a save
that would move the provider-call counter backwards is refused.

## HTTP API

`hane serve` binds `127.0.0.1` and exposes the mission store so the UI reads real
data instead of mocks:

```text
GET  /api/missions              # list, most recently active first
GET  /api/missions/:id          # full record with outputs and audit
POST /api/missions              # { objective, maxProviderCalls?, provider? }
POST /api/missions/:id/approve  # spend the revision budget a human approved
POST /api/missions/:id/retry    # resume needs_attention or failed
GET  /api/events                # SSE: role_saved, role_failed, run_finished, …
GET  /api/providers             # configured providers, never their keys
```

## Scope

This is a core package plus a thin CLI and a loopback API. The desktop shell is
still ahead of it, and any future tool must declare its scope and require an
explicit human approval for writes, commands, external requests, or irreversible
actions.
