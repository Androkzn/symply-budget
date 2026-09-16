---
description: Audit the SimpleHouse test suites (Jest app + Vitest backend) against the CURRENT implementation, detect drift, and update/create tests so they match the code. Treats the current implementation as the source of truth. Use when asked to "check tests", "keep tests up to date", "sync tests with implementation", "make tests match the code", "detect test drift", "did my change break/outdate any tests", or after a feature/refactor/schema change lands. Uses recent git commits/diff as the primary drift signal.
---

<!-- fix-skill: v 1 -->
<!-- Do not place anything above the frontmatter — Claude Code's skill loader reads the `description` for auto-invocation. Version marker + body below. -->

Keep the test suites in lock-step with the current code. Find where tests have drifted from the implementation (renamed/removed symbols, changed signatures, new required fields, changed response shapes, flipped defaults, new UI elements) and where new logic has NO test (functions, branches, corner cases), then **update the outdated tests and create the missing ones** until both suites are green, type-clean, and lint-clean.

**Input:** $ARGUMENTS

Any of:
- **empty** → auto-scope to recent changes: diff the working tree + last commits against `main` (`git diff --name-only main...HEAD` + `git status`), map changed source files to their tests.
- **a git ref / range** → `HEAD~5`, `abc1234`, `main...HEAD`, or a PR number (`gh pr diff <n> --name-only`). Scope to files touched in that range.
- **a path / dir / domain** → `src/screens/budget`, `backend/src/services/budget-service.ts`, `budget`. Scope to that area + its tests.
- **`--full`** → whole-repo sweep (slow; use for a periodic audit, not a per-change check).

If `$ARGUMENTS` is empty AND `git diff` is clean AND there are no un-pushed commits, ask whether to run a `--full` sweep or target a specific area.

---

## Core principle — implementation is the source of truth

The user's intent is "tests must match the current implementation." So when a test conflicts with the code, **update the test** to match current behavior.

**BUT never silently rewrite a test to match a bug.** If a failing test looks like it caught a real regression (the impl changed in a way that seems wrong, loses data, breaks a contract, or violates a documented rule/memory), **STOP and surface it** — do not "fix" the test to make red go green. Report it as a suspected regression and let the human decide.

Likewise: **never weaken or delete a test to make the suite pass.** Deleting a test or loosening an assertion is only allowed when the tested behavior was itself intentionally removed — and you say so explicitly in the report.

---

## The two test systems (run the right tool per project)

| | **App (root)** | **Backend (`backend/`)** |
|---|---|---|
| Runner | Jest (`jest-expo` preset) | Vitest (`@cloudflare/vitest-pool-workers`) |
| Run all | `npm test` | `cd backend && npm test` |
| Run one file | `npx jest <path or pattern>` | `cd backend && npx vitest run <path>` |
| Typecheck | `npx tsc --noEmit` (root; **excludes** `backend/**`) | `cd backend && npm run typecheck` |
| Lint | `npx eslint <files>` | `cd backend && npm run lint` |
| Tests live in | `src/**/__tests__/` | `backend/src/**/__tests__/` |

`tsc` is split per project — always run it inside each project separately. The mobile `tsconfig` excludes `backend/**` and `_archive/**`.

---

## Workflow

### Phase 0 — Scope
Resolve `$ARGUMENTS` to a **change set** (list of source files) + the tests that cover them. Prefer git as the drift signal: recently changed source files are where tests most likely drifted. `git log --oneline -15` + `git diff --stat` orient you fast.

### Phase 1 — Collect drift signals (don't guess — measure)
Run, in this order, and capture output:
1. **Typecheck both projects.** Type errors *inside test files* are the highest-signal drift indicator — a fixture missing a newly-required field, a call with a changed signature, an import of a removed symbol. (Example: adding a DB column made `BudgetItem` fixtures fail `tsc` until `horizon` was added.)
2. **Run the in-scope suites.** Failing assertions reveal behavior drift (changed defaults, response shapes, copy).
3. **Static scans** over the change set:
   - Tests importing/naming a symbol that no longer exists (renamed/removed export) → `grep` the old name across `**/__tests__/`.
   - Source exports / React components / Hono routes / Zustand actions / service methods with **no** referencing test.
   - Schema/DDL changes: a new/renamed column in `backend/src/db/schema*.ts` → every test fixture object literal AND every inline `CREATE TABLE` DDL in tests must be updated (see conventions).
   - Flipped defaults / new branches (e.g. a new default that changes what a component renders) → tests asserting the old default.

### Phase 2 — Classify each finding
- **Drift-to-fix** — impl changed, test asserts the old world → update the test to match current impl.
- **Coverage gap** — new function/branch/UI element/corner case with no test → create a test.
- **Suspected regression** — impl change looks wrong/unsafe → STOP, report, do not touch the test.

### Phase 3 — Fix
Update outdated tests and add missing ones, following the conventions below. Then **re-run until green**: typecheck clean (both projects if touched) → suites pass → `eslint` clean on every file you created/edited. Iterate; don't declare done on an unverified change.

### Phase 4 — Report
See Output format.

---

## SimpleHouse test conventions (generated tests MUST match these)

**App (Jest):**
- Render with **`react-test-renderer`**, NOT `@testing-library/react-native` (not installed). `import ReactTestRenderer, { act } from 'react-test-renderer';`.
- Global native-module mocks live in `jest.setup.js` (MMKV, expo-router, safe-area, notifications, gesture-handler, charts…). Reuse them; add a new global mock there only if a native module is unmocked.
- Wrap renders that trigger effects/state in `act(...)`. When tests share a global Zustand store, **track created renderers and `unmount()` them in `afterEach`** — otherwise a `beforeEach` store update re-renders a mounted tree and emits "not wrapped in act(...)" warnings.
- Device/layout tests use `src/test-utils/deviceRender` (`setDevice`, `treeText`, `IPADS`, `ALL_DEVICES`).
- Respect path aliases (`@components`, `@theme`, `@stores`, …) and ESLint `import/order` (alphabetized, newline-separated groups).

**Backend (Vitest + Workers pool):**
- `import { env } from 'cloudflare:test';` for D1/KV/R2 bindings; `drizzle(env.DB, { schema })`.
- Many D1 tests **bootstrap tables with inline `CREATE TABLE IF NOT EXISTS ...` DDL** (e.g. `budget-test-helpers.ts`, `task-budget-item.test.ts`) rather than applying migrations. **When a schema column is added/renamed, update BOTH the fixture object literals AND every inline DDL** — otherwise inserts fail with `table X has no column named …`. This is the single most common backend drift.
- Run a single file with `npx vitest run <path>` (secrets load from `.dev.vars`).

**Both:** TypeScript strict (`noUnusedLocals/Parameters`, `noImplicitReturns`). New tests must pass `tsc --noEmit` and `eslint`. A pre-existing lint/type error in an untouched file is NOT yours — verify with a baseline (`git stash` the source edits, lint, `stash pop`) before attributing it.

---

## Drift patterns → action (cheat sheet)

| Signal | Fix |
|---|---|
| Test imports a removed/renamed export | Repoint or delete the assertion; update to the new symbol. |
| `tsc` error: fixture missing a field | Add the new required field to the fixture (and inline DDL if it's a DB row). |
| New DB column | Update object-literal fixtures + inline `CREATE TABLE` DDLs + any `INSERT` shape. |
| Assertion checks an old default/response shape | Update to the current default/shape; if the change added a *mode/variant*, add coverage for BOTH branches (e.g. old-default test + new-default test). |
| New exported fn / route / store action / component with no test | Create a focused test (happy path + the obvious corner case). |
| New branch / boundary (null, empty, over-limit, timezone) | Add a case per branch. |
| Failing test looks like a real bug in impl | STOP → report as suspected regression. |

---

## Output format

```
## Test sync — <scope>

Scanned: <N source files>, <M test files>   |   Signals: tsc <x>, failing <y>, gaps <z>

### Updated (drift → matched to impl)
- <test file> — <what drifted> → <how updated>

### Created (coverage gaps closed)
- <test file> — <new fn/branch/UI covered>

### ⚠️ Suspected regressions (NOT auto-fixed — needs your call)
- <impl file:line> — <why it looks like a real bug, not a test problem>

### Verification
- App:     tsc ✅  jest <passed>/<total> ✅  eslint ✅
- Backend: tsc ✅  vitest <passed>/<total> ✅  eslint ✅

### Still uncovered (flagged, not done)
- <area> — <why skipped / needs product decision>
```

---

## Guardrails
- Measure, don't assume — run the actual tools; never claim green without a run.
- Never weaken/delete a test to force a pass unless the behavior was intentionally removed (and say so).
- Never touch a test to hide a suspected regression — escalate it.
- Keep coverage ≥ where you found it.
- Match existing file placement + naming (`__tests__/<Name>.test.ts[x]`) and the conventions above.
- Backend changes still follow the repo's deploy rules — this skill does **not** deploy; it only syncs tests.
- For a `--full` sweep over many domains, you MAY fan out read-only `Explore` agents to map source↔test coverage per domain first, then fix sequentially. Only reach for a Workflow if the user has opted into multi-agent orchestration.
