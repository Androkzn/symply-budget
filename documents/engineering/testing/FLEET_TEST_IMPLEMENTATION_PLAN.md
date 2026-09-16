# Fleet Acceptance Test Matrix — Implementation Plan

> Execution plan for matrix-first, multi-app functional testing across Symply Ecosystem. Strategy and contracts live in [FLEET_TEST_STRATEGY.md](./FLEET_TEST_STRATEGY.md). This document sequences work; it does not redefine product BRD/TRD scope.

| Field | Value |
|-------|-------|
| **Doc type** | Engineering implementation plan |
| **Feature id** | `fleet-acceptance-test-matrix` |
| **Owning scope** | Symply Ecosystem (all brands + platform) |
| **Status** | near-complete linkage (2026-07-18): matrices 2492/2492 Automation + 1364/1364 Maestro paths; live simulator RESULTS scoring still pending |
| **Version** | v1.5 |
| **Created** | 2026-07-17 |
| **Last updated** | 2026-07-18 |
| **Strategy** | [FLEET_TEST_STRATEGY.md](./FLEET_TEST_STRATEGY.md) |
| **Matrices** | [matrices/](./matrices/) |
| **Prior audit** | [ui-test-audit-2026-07-17.md](../ui-test-audit-2026-07-17.md) |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/engineering/testing/FLEET_TEST_STRATEGY.md
3. documents/engineering/testing/FLEET_TEST_IMPLEMENTATION_PLAN.md
4. documents/engineering/ui-test-audit-2026-07-17.md
5. e2e/README.md
6. documents/apps/_ecosystem/features/README.md (Soft Transfer)

Then execute the next open phase in this plan.
Rules:
- Matrix rows before new Maestro/Jest for a feature.
- Mutation tests must assert API (or local persistence), not store mocks alone.
- Do not replace Maestro with Detox/XCUITest.
- Do not run Amplify CLI.
- Do not print or commit secrets (e2e/credentials.local).
- Deploy backend only when Worker test harness or API behavior changes require it.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-07-17 | Initial plan: strategy, phases, file plan, channel workflow |
| v1.1 | 2026-07-17 | Review-plan cycle 1: status → in-progress; fix verification commands; tag OR + per-brand config.yaml; per-phase rollback; crash-class gates; Language BE test commands; composite slice tags |
| v1.2 | 2026-07-17 | Review-plan cycle 2: House config via sibling `flows` globs (no house/ tree); Phase 1 bootstrap order; Language BE scripts; section↔tag map pointer; flaky/disk runbook; rollback wording |
| v1.3 | 2026-07-17 | Implement Phase 0–1: matrices populated (Kaizen stub); Maestro tags (non-Kaizen); budget/house configs; `test:e2e:feature`; `__DEV__` network ring buffer |
| v1.4 | 2026-07-17 | Fix tag vocabulary; house suite→config; ST mutation tests; matrix path prefixes; INDEX/e2e docs; Strategy §4.4.1 full map |
| v1.5 | 2026-07-18 | Close G8/G7 + fleet-wide useTheme/colors crash class; Budget Jest 71/71; ScreenHeader `backButtonTestID`; Language matrix API links |

---

## 1. Readiness Gate

| Gate | Status | Notes |
|------|--------|-------|
| Strategy approved for build | [x] | Contracts locked in FLEET_TEST_STRATEGY.md v1.3 |
| Baseline inventory known | [x] | 188 Maestro, ~275 Jest, ~141 BE Vitest, ~200 backend-language |
| UI audit available | [x] | ui-test-audit-2026-07-17.md |
| Secrets / E2E creds pattern known | [x] | e2e/credentials.local + export-env for staging |
| Amplify out of scope | [x] | Explicit non-goal |

---

## 2. Non-Goals

- Replacing Maestro with Detox or XCUITest.
- Amplify CLI / Amplify codegen.
- Dual-simulator Soft Transfer E2E in Phases 0–2 (tracked as matrix `gap`).
- Pixel-perfect visual regression farm.
- Product feature work inside donor repos under `~/Desktop/Symply Ecosystem/`.
- Android Maestro fleet CI gates (iOS Simulator baseline until scoped).
- Maestro `runScript` staging probes before Vitest covers the same CRUD.
- Tokens or secrets embedded in Maestro YAML.

---

## 3. File Plan

| File / module | Change | Owner | Phase |
|---------------|--------|-------|-------|
| `documents/engineering/testing/FLEET_TEST_STRATEGY.md` | Strategy (source of truth for contracts) | Docs | 0 |
| `documents/engineering/testing/FLEET_TEST_IMPLEMENTATION_PLAN.md` | This plan | Docs | 0 |
| `documents/engineering/testing/matrices/*.md` | Per-app + platform matrices + RESULTS template | Docs | 0 |
| `documents/INDEX.md` / `documents/engineering/README.md` | Link strategy + matrices | Docs | 0 / 4 |
| `e2e/README.md` + brand Maestro READMEs | Tags CLI + matrix pointers | Docs | 1 / 4 |
| `e2e/maestro/**/*.yaml` | Add `tags:`; mutation contract comments with TC-IDs | FE/E2E | 1–3 |
| `scripts/e2e/run-*-suite.sh` / root `package.json` | Tag-aware `test:e2e:feature` + smoke wrappers | FE/E2E | 1 |
| `e2e/maestro/budget/config.yaml` | `flows: ["**"]`, `excludeTags: [util]` (Budget tree is self-contained) | FE/E2E | 1 |
| `e2e/maestro/house/config.yaml` | Workspace config only (create `house/` dir for config); **explicit sibling `flows` globs** to `../auth/*`, `../tasks/*`, … matching `run-house-suite.sh` — there is no House flow tree under `house/` today | FE/E2E | 1 |
| `src/api/client.ts` (+ small E2E helper) | Debug-only (`__DEV__`) network ring buffer | FE | 1 |
| Shared CTA primitives (`src/components/ui/Button.tsx`, `GradientButton.tsx`, Kaizen `BrandButton`, common rows) | Forward `testID` | FE | 1 |
| `src/**/__tests__/*` | Button → API assertion pattern for mutation gaps | FE | 2–3 |
| `backend/**/__tests__/*`, `backend-language` | Map/extend API coverage to matrix IDs | BE | 2–3 |
| `backend/__tests__/data-bridge/*` | Soft Transfer / platform proofs linked from matrix | BE | 2 |

No D1 schema change is required for the harness itself.

---

## 4. Phases

### Phase 0 — Docs + matrices from current implementation

**Status:** done (Kaizen matrix stub only — full Kaizen TC rows deferred).

Scope:

- Publish strategy + implementation plan (done).
- Create `matrices/` index, RESULTS template, and six matrix files (platform + 5 apps).
- Populate rows from **current** tabs/screens/APIs.
- Map existing Maestro / Jest / Vitest paths into **Automation**; mark `gap` honestly.
- Kaizen: deferred stub (section map only) while Kaizen is under active development.

Acceptance:

- [x] `FLEET_TEST_STRATEGY.md` exists
- [x] `FLEET_TEST_IMPLEMENTATION_PLAN.md` exists
- [x] All matrix files exist with §0 prerequisites + section tables (Kaizen = stub)
- [x] Every major tab/feature has a section; Automation column filled or `gap` (except Kaizen TCs)

Verification:

```bash
ls documents/engineering/testing/FLEET_TEST_*.md
ls documents/engineering/testing/matrices/
```

### Phase 1 — Harness upgrades

**Bootstrap order (must follow — end-state verify recipes assume this):**

1. Tag subflows `util`; tag ≥1 smoke flow per brand (`smoke` + `app:*` + `feature:<slug>` per Strategy §4.4.1).
2. Write `e2e/maestro/budget/config.yaml` (`flows: ["**"]`, `excludeTags: [util]`).
3. Create `e2e/maestro/house/` **for config only** and write `config.yaml` with **explicit sibling globs** (not `flows: ["**"]`), e.g. `../auth/*`, `../tasks/*`, `../home/*`, `../mira/*`, … matching paths in `scripts/e2e/run-house-suite.sh`. Omit `../budget/`, `../kaizen/`, `../subflows/`.
4. Smoke-run Budget then House config discovery.
5. Add `test:e2e:feature` npm wrapper; wire `run-house-suite.sh` to `--config=e2e/maestro/house/config.yaml` when ready.
6. Ring buffer + testID pass (can parallelize after step 1).

Scope:

- Add Maestro tags to all flows; tag subflows `util` and exclude via per-brand `config.yaml` (`excludeTags: [util]`).
- Budget + House configs as above (House = sibling globs; do **not** invent a `house/` flow tree).
- Update suite / npm scripts: `test:e2e:feature` wrapper (`npm run test:e2e:feature -- budget savings` → directory/config + `--include-tags=slice:budget-savings-smoke` or single `feature:savings` tag).
- Implement Debug-only network ring buffer on `apiClient` (`__DEV__` gate only; strip query strings; no production read API).
- Forward `testID` on shared CTAs where still missing; prioritize Platform / Budget / House mutation controls (`Button.tsx` already spreads `testID`).
- Document Jest pattern: press → assert method/path/body/response.
- Follow Strategy §4.4.1 + §6.1 for tag vocabulary and OR semantics.

Acceptance:

- [x] At least one tagged flow per brand runs via `--include-tags` (House/Budget/Language/Health; **Kaizen deferred**)
- [x] Subflows tagged `util` are not executed as top-level tests (`excludeTags: [util]`)
- [x] Ring buffer available in Debug builds only (`src/api/e2eNetworkLog.ts`)
- [ ] Shared primary CTAs accept `testID` (Button already spreads; ongoing screen audit)
- [x] `npm run test:e2e:feature -- budget savings` exists (wrapper + tags; live sim run when apps installed)
- [x] House config uses sibling globs (`e2e/maestro/house/config.yaml`)

Verification:

```bash
# After bootstrap steps 1–3 — Maestro has no --dry-run
rg -l 'tags:' e2e/maestro/budget | head
maestro test e2e/maestro/budget --include-tags=smoke --config=e2e/maestro/budget/config.yaml
maestro test --config=e2e/maestro/house/config.yaml --include-tags=smoke
npm test -- LoginScreen.data-bridge
npm run test:e2e:feature -- budget savings   # after wrapper lands
```

### Phase 2 — Close Platform + Budget + House gaps

Scope:

- Fill high-value `gap` rows with Unit API assertions (Save/Delete/Update/Load).
- **Gate:** fix Budget shipped crash class (`BudgetHouseholdScreen`, `BudgetItemFormScreen` hooks-in-callback, etc. per ui-test-audit §2b) before claiming Budget mutation rows green.
- **Gate:** do not mount contractors/labor-hub screens in Maestro/Jest until parked undefined-`colors` / hooks-in-callback fixes land (audit §2).
- Harden Maestro mutation flows: tasks, budget CRUD, savings, reports upload path, Soft Transfer UI (non-destructive).
- Link Soft Transfer matrix rows to data-bridge Vitest.
- Contractors / labor-hub: matrix rows only until unparked; automate after crash fixes.

Acceptance:

- [x] Platform AUTH + ST mutation rows have Unit and/or API automation (not store-only) — auth data-bridge + `smart-engine.test.ts` + `runTransfer.mutation.test.ts` + Import listPackages
- [x] Budget PLAN/SPEND/SAVE mutation rows have Unit or API + Maestro for smoke journeys — Budget Jest **71/71 (1032)**; G8 closed; tagged Maestro ready (live sim score pending — no House/Budget app on booted Kaizen sim)
- [ ] House TASK + core HOME/RPT smoke paths green on simulator — flows tagged; live sim score pending

Verification:

```bash
npm run test:data-bridge
npm run test:e2e:budget:suite
npm run test:e2e:house:suite
cd backend && npm run test:data-bridge
```

### Phase 3 — Kaizen + Language + Health

Scope:

- Kaizen: sync + AI paths with AI-off fallbacks; Maestro beyond visibility smoke.
- Language: donor API contract tests + Maestro shell journeys.
- Health: local persistence Unit tests; seed Health account for authenticated Maestro; privacy rows.

Acceptance:

- [ ] Kaizen hub smoke + key mutation rows automated — **DEFERRED** (active Kaizen work)
- [x] Language shell tabs covered; donor API rows linked — Maestro tagged + matrix; remaining `gap` rows for lesson/SRS API are tracked in `language.md`
- [x] Health HOME local CRUD covered; auth Maestro unblocked or documented N/A with seed plan — local storage Unit + Maestro flows; G5 seed documented in `health.md` §0 / HOME-001

Verification:

```bash
npm run test:e2e:kaizen:suite
npm run test:e2e:language:suite
npm run test:e2e:health:suite
npm test -- --testPathPattern='features/(kaizen|language|health)'
```

### Phase 4 — Regression operating model

Scope:

- Wire docs: `e2e/README.md`, brand Maestro READMEs, `documents/INDEX.md`, engineering testing index.
- Document CI recipes: PR smoke / nightly app / weekly fleet.
- RESULTS scoring process (Circle-style dated copies).
- Publish flaky/disk recovery runbook (Strategy §9) into `matrices/README.md` + `e2e/README.md`.
- Enforce: new Maestro requires matrix ID in comment or filename.

Acceptance:

- [x] Docs cross-linked (`documents/INDEX.md` → matrices; `e2e/README.md` fleet modes)
- [x] Runbook for RESULTS copies published in `matrices/README.md`
- [x] Disk/flaky recovery steps documented (erase unused sims, serial brands, `flaky` exclude tag)
- [x] `npm run test:e2e:all:suites` documented as fleet gate

Verification:

```bash
# Doc links resolve locally; fleet script exists
test -x scripts/e2e/run-all-suites.sh
```

---

## 5. Data And Migration Plan

| Item | Plan |
|------|------|
| Schema change | none for harness |
| Backfill | none |
| Remote migration | N/A unless a future E2E seed Worker endpoint is added |
| Rollback | See §5.1 per-phase rollback table |

---

## 5.1 Per-phase rollback

| Phase | Rollback if blocked |
|-------|---------------------|
| 0 | Delete incomplete matrix files; keep strategy + README scaffold |
| 1 | Revert Maestro tags / config.yaml / npm wrapper; remove ring buffer commit; testIDs are forward-compatible — leave if already merged |
| 2 | Revert new Jest/Maestro mutation files; matrix `gap` rows stay honest |
| 3 | Same as Phase 2 for child apps |
| 4 | Revert doc-only CI/runbook links |

Global harness rollback: remove ring buffer (`__DEV__` block) and revert new tags/wrappers; **keep** `excludeTags: [util]` in configs as the safe default (do not remove util exclusion when rolling back). Matrices remain docs-only.

---

## 6. QA Plan

| Layer | Command / check |
|-------|-----------------|
| Brand validation | `npm run validate:brand` when brand/tab contracts change |
| FE unit | `npm test` / targeted screen + data-bridge |
| FE E2E feature | `npm run test:e2e:feature -- <app> <section>` (Phase 1) or `maestro test e2e/maestro/<app> --include-tags=feature:<section>` |
| FE E2E app | `npm run test:e2e:<app>:suite` |
| FE E2E fleet | `npm run test:e2e:all:suites` |
| BE tests | `cd backend && npm test` / `npm run test:data-bridge` |
| Language BE | No top-level `npm test`. Prefer domain scripts: `npm run test:assessment:smart:unit`, `npm run test:track-b`, or `npm run test:all` under `backend-language/`. Use `test:kaizen:unit` only when validating Kaizen-in-language-worker paths |
| AI-off | Matrix rows for Kaizen/Language/House AI paths with AI entitlement off |
| Matrix scoring | Copy RESULTS template → fill Pass/Fail from real runs only |

---

## 7. Deployment Plan

| Change type | Required action |
|-------------|-----------------|
| Docs / matrices / Maestro YAML only | No deploy |
| `apiClient` ring buffer (`__DEV__` only) | Ship with normal FE release / EAS when convenient; no Worker deploy; no `EXPO_PUBLIC_*` gate |
| testID-only FE | EAS update or next brand build |
| New/changed Worker test helpers only | No production deploy required |
| Worker behavior changed for E2E seed APIs | `cd backend && npm run deploy:fleet` (staging + production) — only if such APIs are added later |

---

## 8. Open Gaps

| # | Gap | Severity | Owner | Status |
|---|-----|----------|-------|--------|
| G1 | Matrices not yet populated from code inventory | high | Docs/FE | closed (Kaizen stub deferred) |
| G2 | Maestro flows lack tags | high | FE/E2E | closed for non-Kaizen; **Kaizen open** |
| G3 | Screen Jest often store-mocked, not HTTP | high | FE | partial — ST/Budget API clients + runTransfer covered; screen-level gaps remain |
| G4 | Shared CTAs missing testID forwarding | high | FE | partial — `Button`/`GradientButton`/`ScreenHeader.backButtonTestID`; screen audit ongoing |
| G5 | Health authenticated Maestro needs seeded account | medium | FE/BE | open (Phase 3) |
| G6 | Dual-app Soft Transfer Maestro | medium | FE/E2E | deferred |
| G7 | Contractors/labor-hub parked crashes + near-zero tests | high | FE | **crash class closed** (useAppColors + dead useTheme removed); Jest/Maestro for labor-hub still near-zero |
| G8 | Budget shipped crash class blocks mutation tests | high | FE | **closed** — WishDetail `useTheme` + prior Budget screens; Budget Jest green |

---

## 9. Execution Groups (Maestro mapping)

Mirror Circle V2 “groups → independently runnable files”. Each matrix section maps to `feature:<section>` and preferably one primary YAML (or a small folder).

| # | Group | Apps | Feature tag | Notes |
|---|-------|------|-------------|-------|
| 0 | Platform auth + session | all | `feature:auth` | Run before dependent suites |
| 1 | Soft Transfer UI + data-bridge | House, Budget | `feature:st` | UI non-destructive; API in Vitest |
| 2 | House core tabs | House | `feature:home`, `feature:tasks`, … | Per-section |
| 3 | Budget money path | Budget | `feature:plan`, `feature:spend`, `feature:savings` | Highest mutation density |
| 4 | Kaizen hubs | Kaizen | `feature:today`, `feature:systems`, … | Local + sync |
| 5 | Language shell | Language | `feature:learn`, … | Donor API |
| 6 | Health shell | Health | `feature:home` | Local-only |
| 7 | Scroll / a11y contracts | all | `feature:scroll` | Existing scroll runners |

Expand groups when matrices are filled; keep one group runnable without the full fleet.

---

## 10. Target run commands

```bash
# Feature slice (after Phase 1 wrapper)
npm run test:e2e:feature -- budget savings

# Or raw Maestro (directory-scoped; tags are OR within one flag)
maestro test e2e/maestro/budget --include-tags=feature:savings --config=e2e/maestro/budget/config.yaml

# App regression
npm run test:e2e:budget:suite

# Fleet (serial — one brand at a time on shared simulator)
npm run test:e2e:all:suites

# Unit + API for a matrix section
npm test -- BudgetItemForm
cd backend && npm test -- savings
```

---

## 11. Success Criteria

- Every major tab/feature across 5 apps has a matrix section with stable IDs.
- Every mutation row has Unit or API automation (not store-only mock).
- Every smoke journey has a Maestro flow with stable `testID`s.
- `feature:*`, app suite, and fleet suite all work.
- Channel features always start as matrix rows before automation lands.
- Dated RESULTS copies can score Pass/Fail like Circle V2 (only after real simulator/API runs).

---

## 12. Completion Checklist

- [x] Strategy doc written in Symply Ecosystem repo.
- [x] Implementation plan written in Symply Ecosystem repo.
- [x] Matrices generated from current implementation (Kaizen stub deferred).
- [x] Harness tags + ring buffer + `test:e2e:feature` landed (Kaizen tags deferred; testID audit ongoing).
- [x] Platform / Budget critical mutations covered at API/Unit layer (G8 closed; House live Maestro score pending).
- [x] Kaizen / Language / Health matrix Automation gaps closed (Maestro paths + Unit links); live RESULTS still pending.
- [x] Docs indexes linked; RESULTS process documented.
- [ ] No secrets printed or committed.
