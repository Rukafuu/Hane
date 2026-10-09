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
- No shell, filesystem, network automation, publishing, or messaging tools in
  the first slice.
- A later tool must declare scope and require a human approval checkpoint for
  any write, command, external request, or irreversible action.

## Definition of done for this slice

- A provider adapter can be injected into the orchestrator.
- The three roles run in order with minimal shared context.
- Exhausting the budget stops further provider calls and produces
  `needs_attention`.
- Automated tests cover the successful run and budget stop.
