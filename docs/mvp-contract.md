# MVP contract

## Product boundary

The future desktop application coordinates temporary specialist agents for a
user-owned task. It is local-first in control plane and data ownership, while
inference is supplied by a provider selected by the user.

## First supported task lifecycle

```text
draft -> planned -> executing -> reviewing -> completed
                                        |-> awaiting_approval (verdict: revise)
                                        |-> needs_attention   (verdict: needs_attention, or unparseable)
any role -> failed                      (provider call failed)
budget exhausted -> needs_attention
tool loop stopped (no calls left) -> needs_attention
```

The orchestrator owns the lifecycle. Agents return text and tool requests only:
a tool request is a question asked of the sandbox, never a syscall, and it can
not change the lifecycle or spend beyond the task budget.

The reviewer's verdict decides how a run ends. `revise` parks the run in
`awaiting_approval` instead of spending more calls: rework is a budget
decision, so it belongs to the user, who resumes it with `hane approve <id>`.
A verdict that cannot be parsed never completes a task — it produces
`needs_attention`. Interrupted states (`needs_attention`, `failed`,
`awaiting_approval`) are resumable: a resume re-runs only the roles that have
no saved output, and the audit trail keeps every extension of the budget as an
append-only record.

## Provider boundary

Each provider configuration declares a label, OpenAI-compatible base URL,
model id, an optional `max_tokens` ceiling, and a credential reference. A
credential value is never stored in task data or SQLite; on Windows the value
belongs in Credential Manager, reached only through the PowerShell bridge, and
the bridge refuses credential operations on any other platform. OpenRouter with
a `:free` model is a supported configuration, not a guarantee of availability or
capacity.

A mission records the label of the provider it ran on, so `hane retry` and
`hane approve` resume it on the same provider without a `--provider` flag.

## Call budget versus transport retries

`maxProviderCalls` bounds every request that asks a model for something: one per
role, and one per turn of a role that runs tools. The default is ten, not three,
because an executor that reads four files spends eight calls doing it — a budget
that counted only roles would be a number with no relation to the spend. A
provider request that fails at the HTTP level (rate limit, server error,
timeout, dropped connection) may be retried inside a single logical call, with a
bounded number of attempts, exponential backoff and jitter, and respect for
`Retry-After`. Each retry is written to the audit trail as `provider_retry`; it
does not consume budget, because it is the same call being delivered again, not
an additional call. A reserved call that finally fails still counts against the
budget.

`maxToolCalls` bounds the actions instead, so a mission cannot gather an
unbounded amount of the workspace on a fixed number of calls. A loop also stops
at eight turns whether or not either budget is left, and the reason it stopped is
audited as `tool_loop_stopped` (`tool_budget`, `provider_budget`, `turn_guard`):
a role that ran out of calls is parked for a human to raise the budget rather
than saved as half an answer.

## Initial roles

| Role | Output |
| --- | --- |
| Planner | a concise, bounded plan |
| Executor | a proposed result, from tools it asked for |
| Reviewer | verdict: approved, revise, or needs_attention |

## Non-negotiable guardrails

- Explicit task call budget, checked before every model request.
- Immutable audit entries for every state transition and provider call.
- Schema changes land as new numbered migrations; applied migrations are never
  edited, and an existing database is adopted by the baseline.
- Capabilities are attached to a mission only when the user explicitly grants
  a known name plus a bounded scope. The initial registry is `workspace.read`,
  `workspace.write`, `process.run`, and `network.request`; no capability is
  implicit, and unknown or duplicate grants are rejected. A grant whose scope
  names a path is a plain path relative to the mission's workspace root: a glob,
  an absolute path, or a `..` climb out is refused at ingress.
- The workspace root is a launch-time decision of the machine, never a value a
  browser invents: `hane serve --workspace <dir>` sets the default a mission
  falls back to, and a workspace grant with neither an explicit `workspaceRoot`
  nor that default is refused at ingress. Path scopes stay plain relative paths
  and a `*`, an absolute path, or a `..` in one is rejected before the run
  starts, so a grant can never widen itself into a pattern or reach a place the
  root does not cover.
- `workspace.read` is executed by the sandbox, not by the model. The executor is
  offered `read_file` and `list_dir` and asks for the paths itself; the
  orchestrator never opens a file on a hunch about what the plan wanted. Every
  path is resolved through a containment check before any file is opened:
  absolute paths, drive letters,
  UNC and device prefixes, `..` segments, anything outside a granted scope, and
  anything matching the secret deny-list (`.env*`, key material, credential
  files, cloud and container config directories, `.git`, `node_modules`,
  `outputs`, SQLite and Terraform state) are refused. The deny-list ignores
  case and is applied to the resolved path as well as to the requested one, so
  a link that lands on a secret is a refusal rather than a read. A scope whose
  own real target sits outside the root — a link to somewhere else, or a `..`
  that reached the resolver by another route — grants nothing at all, so the
  root stays the ceiling even when the link itself lives inside it.
  Reads are byte-capped, line-aligned, and binary content is refused. Each read,
  listing, refusal and call that never reached the sandbox is an append-only
  audit entry (`tool_read`, `tool_listing`, `tool_denied`,
  `tool_listing_denied`, `tool_call_refused`) persisted and broadcast as it
  happens, and the separate `maxToolCalls` budget bounds them independently of
  `maxProviderCalls`.
- The `maxToolCalls` ceiling is settable at both ingresses — `--max-tool-calls`
  on `hane run`, `retry` and `approve`, and `maxToolCalls` on
  `POST /api/missions` and its `approve`/`retry` routes — and it is a
  per-mission counter that survives resumes: cumulative across `retry` and
  `approve`, never reset by either. Over HTTP a resume value may only raise
  it; a non-positive value is refused as `400` with `maxToolCalls must be a
  positive integer.`, and on the CLI as a usage error that exits 1 before any
  provider call. A resume arriving with no budget left is announced rather
  than silent — the CLI warns that the budget is spent and that this resume can
  run no tools, and every call past the limit is answered with
  `tool_budget_exhausted`; a raise is audited as `tool_budget_extended`.
- Grants for `workspace.write`, `process.run`, and `network.request` remain
  declarative: they are persisted and audited, but no tool executes them. They
  additionally require a human approval checkpoint at the action level, even
  when a mission declares the capability. `workspace.write` carries a path
  scope, so it demands a workspace root at ingress even though nothing
  executes the grant yet — a scope means nothing without a root to enforce it
  against, and the runtime refuses to store a write grant that could not be
  enforced, with the contract already in place for the day a real write
  executor lands. `process.run` and `network.request` scopes are machine-checkable
  policies, not prose, because a scope nothing can parse is a scope nothing can
  enforce later: `process.run` lists command prefixes (`python3`, `git status`,
  `npm run *`) built from bare program names and refuses anything a shell would
  read as syntax, and `network.request` lists lowercase hosts
  (`docs.example.com`, `*.registry.npmjs.org`) with no scheme, port, path,
  credentials, literal address or machine-local name. Both are refused where a
  grant is authored — a CLI usage error exiting 1, a `400` over HTTP, always
  before the first provider call. A mission already stored keeps the scope it
  was granted with: re-parsing on resume could only strand a running task, and
  a stranded task is worse than an unfinished policy.
- File content handed to a model is data, never instruction. Every turn of a
  tool loop is opened with that label, a call that cannot be parsed is refused
  rather than guessed at, and nothing read from disk is persisted with the task —
  a resume re-reads under the same checks instead of replaying bytes it saw once.
- Capability execution goes through one seam. `src/sandbox/interface.js` names
  the six verbs a mission may ask of a machine and the tokens a refusal may
  carry; `src/sandbox/workspace-dir.js` is the only backend and implements
  `read` and `list` over the containment resolver the tools used directly. The
  rest answer `{ ok: false, reason: 'capability_not_available' }` — a value the
  caller can audit and print, never a throw and never a silent success. A
  refusal is data because a model asking past its grant is expected traffic.

## Definition of done for this slice

- A provider adapter can be injected into the orchestrator.
- The three roles run in order with minimal shared context.
- Exhausting the budget stops further provider calls and produces
  `needs_attention`.
- When a mission grants `workspace.read` and carries a root, the executor runs a
  tool loop and the files it names itself are what it reads; when either is
  missing, the run proceeds with no tools at all rather than reading
  opportunistically.
- Automated tests cover the successful run and budget stop.
