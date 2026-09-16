# Fleet Acceptance Matrices

| Field | Value |
|-------|-------|
| **Status** | Near-100% Automation linkage — 2026-07-18: **~2,501** rows, **0 `gap`**, **100%** Maestro-layer → `e2e/maestro/**/*.yaml`. Live RESULTS: [Kaizen](./RESULTS_2026-07-18_kaizen.md) suite scored; [Budget](./RESULTS_2026-07-18_budget.md) smoke scored (**36 pass / 12 fail / 512 N/A**, 75% excl. N/A) — full suite pending quieter Maestro (House/Kaizen contention). |
| **Coverage contract** | [COVERAGE_CONTRACT.md](./COVERAGE_CONTRACT.md) |
| **Strategy** | [../FLEET_TEST_STRATEGY.md](../FLEET_TEST_STRATEGY.md) |
| **Implementation plan** | [../FLEET_TEST_IMPLEMENTATION_PLAN.md](../FLEET_TEST_IMPLEMENTATION_PLAN.md) |

---

## Purpose

Circle V2–style acceptance tables for every Symply app plus shared platform. The matrix is the source of truth for functional coverage: every screen, control, scroll contract, and real BE/local mutation (with `__DEV__` console verify). Jest, Vitest, and Maestro link from the **Automation** column. How to grep Metro, map **Console verify** cells, and run Maestro before/after subflows: [../E2E_CONSOLE_VERIFY.md](../E2E_CONSOLE_VERIFY.md).

Row schema (locked): **ID · Description · Steps · Expected · UI elements · BE / persistence · Console verify · Layer · Automation · Notes** (Pass/Fail/N/A only in dated RESULTS copies).

---

## Files

| File | Scope | Status |
|------|-------|--------|
| [COVERAGE_CONTRACT.md](./COVERAGE_CONTRACT.md) | Density bar + mandatory row families | Locked 2026-07-18 |
| [platform.md](./platform.md) | Auth, onboarding, subscriptions, AI access, notifications, settings, Soft Transfer, widget | 378 rows (was 278) |
| [house.md](./house.md) | Symply House | 681 rows (was 448) |
| [budget.md](./budget.md) | Symply Budget | 545 rows (was 350) |
| [kaizen.md](./kaizen.md) | Symply Kaizen | 479 rows (was 383); prior RESULTS: [RESULTS_2026-07-18_kaizen.md](./RESULTS_2026-07-18_kaizen.md) — **stale, incompatible ID scheme; regenerate before use** |
| [language.md](./language.md) | Symply Language | 271 rows (was 193) |
| [health.md](./health.md) | Symply Health P1 shell | 163 rows (was 105) |
| [audits/](./audits/) | Per-matrix gap reports from the 2026-07-18 audit | 6 reports |
| [RESULTS_TEMPLATE.md](./RESULTS_TEMPLATE.md) | Blank Pass/Fail template for dated runs | Template |

Dated execution copies (create when scoring a real run):

```text
RESULTS_YYYY-MM-DD_<app>.md
```

Rules for RESULTS copies (same spirit as Circle V2):

- Check Pass/Fail only after an observed run on a real simulator/API.
- Use **N/A** + Notes when a row is conditional or blocked (missing harness, deferred IMP).
- Do not invent passes from code reading alone.

---

## Row schema

Locked in [COVERAGE_CONTRACT.md](./COVERAGE_CONTRACT.md); section codes in [FLEET_TEST_STRATEGY.md §4](../FLEET_TEST_STRATEGY.md).

| Column | Content |
|--------|---------|
| **ID** | `<PREFIX>-<SECTION>-<NNN>` e.g. `BUDGET-SAVE-003`, `PLAT-ST-001` |
| **UI elements** | btn / field / DD / toggle / checkbox / sheet under test |
| **BE / persistence** | HTTP method+path or local store; `none` if pure UI |
| **Console verify** | `[E2E-NET]` / `[E2E-DB]` expectation, or `n/a (local)` / `n/a (UI-only)` — see [../E2E_CONSOLE_VERIFY.md](../E2E_CONSOLE_VERIFY.md) |
| **Layer** | `Unit` / `API` / `Maestro` / `Live` (comma-separated when multi) |
| **Automation** | Repo path or `gap` |

Section codes and Maestro `feature:*` tags: [FLEET_TEST_STRATEGY.md §4.4](../FLEET_TEST_STRATEGY.md).

---

## How to add a channel feature

1. Add rows to the owning matrix file with new stable IDs.
2. Implement Unit → API → Maestro (mutation rows must assert API or local persistence).
3. Fill **Automation** paths; use `gap` when unknown.
4. Run `feature:<section>` slice, then app suite (`npm run test:e2e:<app>:suite` or brand runner script).
5. Optional: copy [RESULTS_TEMPLATE.md](./RESULTS_TEMPLATE.md) for release sign-off.

---

## Disk / flaky recovery

See [FLEET_TEST_STRATEGY.md §9](../FLEET_TEST_STRATEGY.md) and [e2e/README.md](../../../e2e/README.md). Serial fleet runs; quarantine with `flaky` tag + `excludeTags`; mark RESULTS **N/A** when blocked.

## Related

| Doc | Role |
|-----|------|
| [FLEET_TEST_STRATEGY.md](../FLEET_TEST_STRATEGY.md) | Contract, tags, accounts |
| [FLEET_TEST_IMPLEMENTATION_PLAN.md](../FLEET_TEST_IMPLEMENTATION_PLAN.md) | Phased execution |
| [e2e/README.md](../../../e2e/README.md) | Maestro runners |
| [e2e/maestro/kaizen/README.md](../../../e2e/maestro/kaizen/README.md) | Kaizen flow inventory |
| [../E2E_CONSOLE_VERIFY.md](../E2E_CONSOLE_VERIFY.md) | Console prefixes, deep links, matrix verify workflow |
