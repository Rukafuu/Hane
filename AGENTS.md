# Hane — repository instructions

Hane is a local-first agent orchestrator for Windows. The remote
`https://github.com/Rukafuu/Hane` is **public**: treat every file, every commit
message and every test fixture as world-visible. Credentials live only in the
Windows Credential Manager — never in SQLite, HTTP bodies, git, or a screenshot.

## Run and verify

- Node **22.13.0 or newer** is the floor because `node:sqlite` is unflagged from
  that version; `.github/workflows/verify.yml` measures both the floor and the
  LTS the team runs.
- `npm run verify` is `node --check` over `src/`, `bin/`, `test/` plus `node --test`.
- The root suite also discovers `work/mission-ui-prototype/tests/*.test.mjs`, and
  one of them asserts the Sites packaging files exist under
  `work/mission-ui-prototype/dist/`, which is gitignored. In a clean clone, run
  `npm run build` in that directory first or expect exactly that one failure.
- Several agents work in the **same working tree** at the same time. Before
  committing, read `git status --porcelain -uall` and `git diff --cached`: stage
  only your own functional unit, never a whole file that carries someone else's
  unstaged edit, and never `git commit --only`, `git stash`, `git reset` or
  `git clean`. A commit that depends on a file left untracked is not finished.
- If a verification run overlaps with someone else's edits, its result is
  inconclusive; say so instead of reporting a green or red number.

## Contracts that are easy to break

- **Migrations are append-only.** Never reuse an id. Measure the highest id in
  `git show HEAD:src/storage/migrations.js` *and* in the working tree before
  choosing the next one — in-flight sessions claim ids before they commit.
  Id **16** is reserved for the per-execution backend choice.
- **One browser boundary.** `src/server/request-guard.js` is mounted
  unconditionally before every route, including profile and teams. Every mutation
  that arrives with a browser identity requires `x-hane-request: 1`, and with a
  local profile active the server asks for the same header even from a native
  client that carries none. A page-origin JSON body must be exactly
  `application/json` (parameters allowed, `application/json-foo` is 415); the
  only image exception is `POST /api/profile/avatar`. Guard messages are in
  English, and `DEFAULT_UI_ORIGINS` has no localhost wildcard.
- **Budgets belong to the backend.** `DEFAULT_MAX_PROVIDER_CALLS = 10`
  (`src/task-run.js`), `maxToolCalls` default 24, ceilings 64/24 in
  `src/server/mission-server.js`. Transport retries (429/5xx/backoff) do not
  spend a mission's provider budget; they are audited as `provider_retry`.
- **Avatar size is decided in bytes** by `src/image-data-url.js`, pinned against
  `AVATAR_LIMITS.maxBytes` by `test/avatar-data-url.test.js`. Do not re-add a
  character-length gate.
- **Nothing executes unless a backend was chosen and a grant was enforced.**
  `network.request` is a valid capability name with no executor, so the UI must
  not offer it. Keep the selectable lists equal to what the runtime enforces.

## Where truth lives

- `docs/decisions.md` owns the ADRs (0001–0010) — including ADR-0007 (the box is
  its own `.wsl` distro) and ADR-0010 (Conversa and Missão are two modes sharing
  agents, permissions and orchestration). Read it before reopening a decision.
- `docs/mvp-contract.md` is the external contract; `docs/runtime-honesty-audit.md`
  classifies every surface as REAL / PARTIAL / NOT IMPLEMENTED. When a frontend
  becomes more capable than the runtime, the audit is the file that has to change
  with it — or the UI is lying.
- `Frontend/` is an unpacked Figma Make export: design reference, not product code.
  The real frontends are `work/mission-ui-prototype` (which carries its own
  `AGENTS.md`) and `work/hane-landing`.
- Licensing: code Apache-2.0, Hane Sans SIL OFL 1.1 with the RFN "Hane Sans",
  brand outside the license (`TRADEMARKS.md`, `docs/licensing.md`).
