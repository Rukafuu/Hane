# Hane — local agent orchestrator

Hane (`local-agent-orchestrator`) is a local-first core that
runs a user objective through three accountable roles — **planner**, **executor**
and **reviewer** — under a hard call budget, and records everything it did in an
append-only audit trail. Inference comes from a provider the user configures;
control plane and data stay on the machine.

Nothing writes to, or executes inside, your workspace. The one tool that runs is
`workspace.read`, and only for a mission the user explicitly gave a root and a
scope to read. A model response alone never becomes a shell command.

## What is in the box

| Path | Role |
| --- | --- |
| `src/contracts.js`, `task-run.js`, `orchestrator.js`, `verdict.js` | the lifecycle core: statuses, budget, tool loop, audit, verdict parsing |
| `src/sandbox/` | the seam between a mission's grants and the machine that carries them out |
| `src/tools/` | the tool table, the router that turns a call into a sandbox verb, the read/list implementations and the inline call protocol |
| `src/providers/` | provider configuration, the credential → provider factory, the OpenAI-compatible adapter |
| `src/storage/` | SQLite handle, numbered migrations, task repository, provider-config store |
| `src/credentials/` | Windows Credential Manager bridge (PowerShell, stdin-only payload) |
| `src/workspace-scope.js` | path containment and the secret deny-list every read runs through |
| `src/capabilities.js` | the capability registry and grant validation |
| `src/skills/`, `src/storage/sqlite-skill-store.js` | data-only local skill manifests and the installed-skill catalog |
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
npm ci --include=optional
node bin/hane.js serve --port 7788
# Optional: enables GitHub's desktop device authorization flow in onboarding.
node bin/hane.js serve --port 7788 --github-client-id <github-oauth-app-client-id>
```

## Commands

```powershell
npm test        # node:test suite
npm run check   # node --check over every source, bin and test file
npm run verify  # check + test
```

## CLI reference

```text
hane provider add --label <name> --base-url <url> --model <id> [--max-tokens N]
hane provider list
hane provider remove <label>
hane provider set-secret <label>          # reads the secret from stdin, no echo
hane skills install <directory> [--db <path>]
hane skills list [--db <path>]
hane run "<objective>" [--provider <label>] [--max-calls N] [--max-tool-calls N] [--workspace <dir>] [--capability <name>=<scope>] [--db <path>] [--json]
hane missions [--db <path>]
hane mission <id> [--db <path>] [--json]
hane retry <id> [--provider <label>] [--max-calls N] [--max-tool-calls N] [--db <path>] [--json]
hane approve <id> [--provider <label>] [--max-calls N] [--max-tool-calls N] [--db <path>] [--json]
hane serve [--port N] [--host <addr>] [--db <path>] [--provider <label>] [--workspace <dir>] [--github-client-id <id>] [--ui-origin <loopback-http-origin>]
```

The default database is `outputs/hane.sqlite`, resolved from the package root so
the cwd never matters. `--json` prints only the task snapshot, which makes the
CLI pipeable.

## Local skills

Local skills are versioned `skill.json` instruction manifests. They are static
data, never executable packages: installing one neither runs code nor grants
workspace, process, or network access. The installed catalog is available to a
local UI through `GET /api/skills`; see [`docs/local-skills.md`](docs/local-skills.md)
for the manifest and commands. Selecting a skill for a mission remains a
separate future step so that its prompt effect is explicit and auditable.

Exit codes: `0` completed · `1` usage, configuration or credential error ·
`2` `needs_attention` or `awaiting_approval` · `3` `failed` · `130` interrupted.

## Lifecycle

```text
draft -> planned -> executing -> reviewing -> completed
                                        |-> awaiting_approval (verdict: revise)
                                        |-> needs_attention   (verdict: needs_attention, or unparseable)
any role -> failed
budget exhausted -> needs_attention
tool loop out of calls -> needs_attention
```

The reviewer's verdict closes the cycle. `revise` parks the run in
`awaiting_approval` rather than spending more calls, because rework is a budget
decision that belongs to a human — `hane approve <id>` is that decision. A
verdict that cannot be parsed never completes a task.

Interrupted states are resumable. A resume re-runs only the roles with no saved
output, and each role is persisted as it finishes, so `Ctrl+C` mid-mission leaves
a real, resumable record behind.

## Budget, calls and retries

`--max-calls` is the number of **provider requests the mission may make**,
checked before each one: one per role, plus one per turn of the executor's tool
loop — ten by default, because an executor that reads four files spends eight
calls doing it. A reserved call that fails is still spent. A loop that runs out
leaves the role unsaved and the mission in `needs_attention`: half a thought is
not an output.

Transport flakiness is handled one level down. A request that hits a rate limit,
a server error, a timeout or a dropped connection is retried inside a single
logical call, with bounded attempts, exponential backoff plus jitter, and respect
for `Retry-After`. Each retry is written to the audit trail as `provider_retry`
and does not consume budget: it is the same call delivered again, not an extra
call.

## The executor's tools

`workspace.read` is the one capability that executes. The executor is offered
`read_file` and `list_dir` as tools and asks for the paths itself: one turn is
one provider call, the sandbox answers with the bytes or with a refusal, and the
answer goes back into the same message list, so what the role says is a result of
what it read rather than of what a planner happened to name. Only the executor is
offered tools — the planner plans in the dark and the reviewer reads what was
written.

A gateway that ignores the `tools` field (common on free tiers) is asked to write
its call into a ` ```hane-tool ` fence instead, and the fallback is audited as
`tool_protocol_fallback`. A call whose JSON cannot be read is refused and audited;
it is never executed by guessing.

```powershell
node bin/hane.js run "Review the error handling in src/" --provider openrouter --workspace A:/Hane --capability workspace.read=src
```

`--workspace` sets the root a mission may never leave, and `--capability` grants
one scope inside it, as `name=scope` (repeatable; `.` means the whole root). A
workspace capability without a root is refused before the run starts, and so is
a grant written without its scope. Over HTTP the same contract is carried by
`POST /api/missions`, which takes `workspaceRoot` plus `capabilities`.

The root is a decision of the machine, not of the page: `hane serve --workspace
<dir>` resolves a default at launch, so a browser that can only offer a folder's
display name never has to invent a path — a mission created without
`workspaceRoot` runs under that default, and `GET /api/workspace` reports whether
the server owns one. A scope is a plain relative path inside that root: one that
contains `*`, carries a drive letter or a leading `/`, or contains a `..` segment
is rejected at the door, because a grant names one place the root covers — never
a pattern that widens under the resolver, and never a hole punched past the
ceiling.

The two capabilities that do not name a path still have to name something an
executor could check. `process.run` lists command prefixes — `python3` allows
that program with any arguments, `git status` allows exactly that argv prefix,
`npm run *` allows that prefix and anything after it — and refuses anything a
shell would read as syntax, because commands reach the sandbox as an argument
list and never through a shell. `network.request` lists hosts, lowercased:
`docs.example.com` for one, `*.registry.npmjs.org` for its subdomains, with no
scheme, port, path, credentials, literal IP or machine-local name
(`localhost`, `.local`, `.internal`) — the last because a box that can reach the
machine running it is not a box. A scope outside these grammars is a usage error
on the CLI and a `400` over HTTP, before the first provider call. Nothing
executes either grant yet; the grammar exists so the day one runs, the policy you
wrote is the policy enforced.

What stands between a grant and your disk:

- Every path is required to be relative to the root. Absolute paths, drive
  letters, UNC and device prefixes, and any `..` segment are rejected.
- A scope is a plain path, not a glob. A scope file must match exactly; a scope
  directory must contain the candidate. A scope whose real target lands outside
  the root — climbed out with `..`, or a link to somewhere else — authorizes
  nothing at all, even though the link itself sits inside the root.
- Secret material is denied even inside a granted scope, and the deny-list
  ignores case: `OUTPUTS/x` is as refused as `outputs/x`. It covers `.env*`, key
  and certificate files, credential files and `.npmrc` / `.netrc` style configs,
  `kubeconfig`, `.git`, `.ssh`, `.aws`, `.azure`, `.gcloud`, `.gnupg`, `.docker`,
  `.kube`, `node_modules`, `outputs`, and SQLite or Terraform state files.
- Symlinks and junctions are resolved before the containment check, and the
  deny-list is applied to the path that actually opens — so a link inside a
  granted directory that lands on `.git/config` is a refusal, not a read.
- Reads are byte-capped and aligned to a line boundary, and binary content is
  refused rather than streamed into a prompt.
- Reads, listings and refusals are audit entries (`tool_read`, `tool_listing`,
  `tool_denied`, `tool_call_refused`) persisted and broadcast as they happen,
  bounded by a separate `maxToolCalls` budget so tool use can not be used to
  hide extra spend.
- That budget is a per-mission counter that survives resumes: cumulative
  across `retry` and `approve`, and independent of the provider-call budget. A
  resume arriving with it already spent can run no tools at all, and says so —
  the CLI warns `warning: tool budget is spent (N/N); this resume can run no
  tools.`, hints `pass --max-tool-calls <higher> to raise it`, and every call
  past the limit is answered with `tool_budget_exhausted`. The role still gets
  one tool-less turn to say what it saw before the wall.

That ceiling is settable at ingress, not only inside the runtime:
`hane run --max-tool-calls N` — 24 by default, and the same flag on `retry`
and `approve` — or the `maxToolCalls` field on `POST /api/missions`,
`/api/missions/:id/approve` and `/api/missions/:id/retry`. Omitting it leaves
the default; a non-positive or non-integer value is a usage error that exits 1
before any provider call, or over HTTP a `400` reading `maxToolCalls must be a
positive integer.` On a resume the field may only raise the budget — a value
that does not exceed the current one is refused — and the raise is recorded as
`tool_budget_extended`.

File content is treated as untrusted data and is labelled that way in every
request that carries it. Nothing is stored as evidence: the mission keeps its
audit and its message history, and a resume re-reads from disk under the same
checks rather than replaying bytes it saw before.

`workspace.write`, `process.run` and `network.request` are still declarative —
they are recorded and audited, nothing executes them, and each one requires a
human approval at the action level.

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
POST /api/missions              # { objective, maxProviderCalls?, provider?, workspaceRoot?, capabilities? }
POST /api/missions/:id/approve  # spend the revision budget a human approved
POST /api/missions/:id/retry    # resume needs_attention or failed
POST /api/missions/:id/cancel   # abort an in-flight provider request; preserves audit
GET  /api/events                # SSE: role_saved, role_failed, run_finished, …
GET  /api/providers             # configured providers, never their keys
```

## Scope

This is a core package plus a thin CLI and a loopback API. The desktop shell is
still ahead of it. Every tool declares the scope it needs before it runs, and
anything that writes, executes, requests out, or is irreversible still requires an
explicit human approval for that action — `workspace.read` is the only capability
with a working implementation today, and it stays inside the root you granted.

### Local personal profile

The desktop UI starts with a three-step local onboarding: a personal profile, an optional provider, and an optional first group. The profile is stored in the same SQLite database without replacing existing executions, providers, or agents. Optional password protection uses Argon2id, backend sessions and a single-use offline recovery code; photos are decoded and stored as processed WebP files beside the database. Install root dependencies with `npm ci --include=optional` before serving.

Locking protects HTTP APIs and the interface, but does not encrypt local files or restrict the CLI under the operating-system account. See [profile implementation and security decisions](docs/profile-onboarding.md) for storage, limits, origins, and validation.

## License

The code in this repository is licensed under the [Apache License 2.0](LICENSE). That covers
`src/`, `bin/`, `scripts/`, `test/`, `docs/` and the interface sources. You may use, modify and
redistribute it, commercially or not, without asking, as long as you keep the license and the
copyright notices.

Two things are not covered by that license:

- **The Hane name, logo and visual identity.** Apache-2.0 grants no trademark rights, and the
  project spells out what it treats as descriptive use and what needs written permission in
  [TRADEMARKS.md](TRADEMARKS.md). A fork keeps the code and takes its own name.
- **The Hane Sans typeface binaries**, which are under the [SIL Open Font License 1.1](src/Hane%20fonts/OFL.txt)
  with `Hane Sans` and `HaneSans` as Reserved Font Names. Use and bundling are free; a modified
  version may not keep the name.

`Frontend/` is a design reference exported from Figma Make rather than project code, and the root
license makes no claim about it — see [Frontend/README.md](Frontend/README.md).

A full breakdown of what sits under which license is in [docs/licensing.md](docs/licensing.md).
