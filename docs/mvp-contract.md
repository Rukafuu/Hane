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
```

The orchestrator owns the lifecycle. Agents return structured evidence only;
they cannot change the lifecycle, run tools, or spend beyond the task budget.

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

`maxProviderCalls` bounds logical role calls: planner, executor, reviewer. A
provider request that fails at the HTTP level (rate limit, server error,
timeout, dropped connection) may be retried inside a single logical call, with a
bounded number of attempts, exponential backoff and jitter, and respect for
`Retry-After`. Each retry is written to the audit trail as `provider_retry`; it
does not consume budget, because it is the same call being delivered again, not
an additional call. A reserved call that finally fails still counts against the
budget.

## Initial roles

| Role | Output |
| --- | --- |
| Planner | a concise, bounded plan |
| Executor | a proposed result and evidence |
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
  names a path is a plain path relative to the mission's workspace root, not a
  glob.
- `workspace.read` is executed by the orchestrator, not by the model. The
  mission carries a workspace root, and every path is resolved through a
  containment check before any file is opened: absolute paths, drive letters,
  UNC and device prefixes, `..` segments, anything outside a granted scope, and
  anything matching the secret deny-list (`.env*`, key material, credential
  files, `.git`, `node_modules`, `outputs`, SQLite databases) are refused.
  Reads are byte-capped, line-aligned, and binary content is refused. Each read
  and each refusal is an append-only audit entry
  (`tool_read`, `tool_listing`, `tool_denied`, `tool_listing_denied`), and the
  separate `maxToolCalls` budget bounds them independently of
  `maxProviderCalls`.
- Grants for `workspace.write`, `process.run`, and `network.request` remain
  declarative: they are persisted and audited, but no tool executes them. They
  additionally require a human approval checkpoint at the action level, even
  when a mission declares the capability.
- File content handed to a model is evidence, never instruction. The provider
  request labels workspace evidence as untrusted data, and evidence is not
  persisted with the task — a resume re-reads from disk under the same checks.

## Definition of done for this slice

- A provider adapter can be injected into the orchestrator.
- The three roles run in order with minimal shared context.
- Exhausting the budget stops further provider calls and produces
  `needs_attention`.
- When a mission grants `workspace.read` and carries a root, the executor's
  request carries the file contents the model asked for; when either is
  missing, the run proceeds without evidence rather than reading
  opportunistically.
- Automated tests cover the successful run and budget stop.
