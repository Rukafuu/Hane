# Registered agents in mission execution

This opt-in preset binds three distinct registered team members to planning, execution and review. Group conversations keep their existing participant routing. Additional team members and the optional leader are not automatically executed or assigned stages.

In the group conversation, choose **Executar preset**, then **Integrantes do grupo · três etapas** and select each member. The default **Etapas padrão** retains the legacy mission behavior. Agent providers take precedence; a mission-selected or server-default provider is a fallback only for agents without a configured provider. With neither, a single configured provider can be selected; ambiguity fails before inference.

`POST /api/missions` accepts `teamId` plus `roleAssignments: {planner, executor, reviewer}` containing member UUIDs. All three are required, distinct, and must belong to an active persisted team. Invalid assignments return 400; unavailable provider configurations/credentials return 409. A composition edited while credentials are being resolved is refused rather than partly applied.

CLI: `hane run "objective" --team <uuid> --planner <uuid> --executor <uuid> --reviewer <uuid>`. The same selection and snapshot contract applies to CLI and HTTP.

Migration 17 adds nullable `task_runs.execution_plan_json`; 16 remains reserved for sandbox selection. Old missions have no execution plan and retain their original behavior. New presets store versioned agent IDs, names, instructions, reference documents, capability ceilings, provider labels and models, without avatar blobs or credential references. This immutable historical configuration survives agent edits, membership changes and group archival. Retry/approve preserve it; provider overrides are refused. A missing provider or changed model must be restored before resuming. Provider endpoints and credentials remain centrally configured, not frozen or copied into mission data.

Only the executor can use the existing workspace read tools. Access requires the recorded agent capability, the current agent capability and the mission's explicit scoped grant. Revocation is checked before each operation, including after pending inference. Planning/review never receive tools; this preset adds no writes, process execution or network access. Instruction documents travel as untrusted reference data, separately from authored behavior. Actual provider calls, outputs, tool evidence and handoffs carry the executing agent identity and provider/model in the audit.

Budgets, cancellation and the existing human approval flow remain enforced. This is a bounded three-stage preset, not dynamic delegation among up to eight participants. Tests use synthetic credentials and local providers; no external inference credits are spent.

Worktree provenance: `outputs/interface-baseline.json` records the 12 UI files copied from the primary checkout before this slice. The branch starts at cc28c93; copied conversations/library/profile work is a baseline from the previous sessions, not newly authored runtime work.

## Verification

- `npm run verify`: syntax check passed for 90 files. The initial parallel test run passed 400/402; two existing PDF worker tests reached their 10-second deadline.
- `node --test test/instruction-files.test.js`: all four document tests passed in isolation.
- `npm test -- --test-concurrency=1`: all 402 tests passed, zero skipped, in 45.7 seconds.
- UI `npm run build`: passed; Vite reports a bundle-size advisory.
- UI `npm run test:sites`: all 43 tests passed.
- Isolated browser workflow: a synthetic local profile, a four-member team, three selected agents and three local model labels completed three missions. The fourth member/leader was not invoked. Repeated sending worked, and names, models, outputs and completed state appeared in the UI.
- QA used an in-memory SQLite database and a loopback OpenAI-compatible gateway. No real profile data, credential vault reads or paid external inference calls were involved. Temporary servers, browser tab, scripts and cache were removed.
- The browser check also exposed and repaired a prior anime.js v4 toast completion bug that left an invisible notification intercepting later sends, and a fast-response race that replaced an SSE-completed summary with a queued summary.
