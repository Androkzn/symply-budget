# Fleet Test Strategy — Symply Ecosystem

| Field | Value |
|-------|-------|
| **Doc type** | Engineering test strategy |
| **Status** | in-progress (Phase 1 landed; Kaizen deferred) |
| **Version** | v1.5 |
| **Created** | 2026-07-17 |
| **Last updated** | 2026-07-18 |
| **Companion plan** | [FLEET_TEST_IMPLEMENTATION_PLAN.md](./FLEET_TEST_IMPLEMENTATION_PLAN.md) |
| **Matrices** | [matrices/](./matrices/) |
| **Related audit** | [ui-test-audit-2026-07-17.md](../ui-test-audit-2026-07-17.md) |

---

## 1. Purpose

Operate testing across **five storefront apps** (House, Budget, Kaizen, Language, Health) plus **shared platform** surfaces (auth, Soft Transfer, subscriptions) with:

1. A **Circle V2–style acceptance matrix** as the source of truth for functional coverage.
2. A **test pyramid** so Save/Delete/Update/Load prove real API (or local-store) behavior, not only that a button exists.
3. **Independent run slices** (feature → app → fleet) so channel work and full regression are both easy.

### 1.1 What “100% functional” means

Every user-visible create / read / update / delete and every critical navigation or entitlement gate has a **matrix row** with at least one owning verification layer (`Unit`, `API`, `Maestro`, or `Live`).

- Not every row must be Maestro.
- Maestro owns journeys + UI contracts.
- Unit + Worker API tests own request/response correctness.
- Local-first apps (Health; much of Kaizen) assert persistence contracts instead of HTTP when no backend call exists.

---

## 2. Current baseline (2026-07-17)

| Layer | Tool | Approximate size | Primary location |
|-------|------|------------------|------------------|
| Mobile unit / screen | Jest | ~275 files | `src/`, `app/`, `__tests__/` |
| Mobile E2E | Maestro | 188 YAML | `e2e/maestro/` |
| House Worker | Vitest (workerd) | ~141 files | `backend/` |
| Language Worker | granular `test:*` scripts | ~200 files | `backend-language/` (no top-level `npm test`) |
| Contracts | Vitest | packages | `packages/contracts/` |

**Known gaps** (see also the UI audit):

- Maestro flows largely lack `tags`; filtering is directory / script based.
- Many screen Jest suites mock **Zustand stores**, not HTTP — button → API mapping is unverified.
- Selectors often use visible text; shared CTAs do not always forward `testID`.
- Soft Transfer Maestro stays inside Budget UI (non-destructive); no dual-app simulator harness yet.
- Matrices populated under `matrices/` for platform/house/budget/language/health; **Kaizen matrix TC rows deferred** (stub only while Kaizen is under active development).
- Kaizen Maestro flows are **not** tagged yet (`INCLUDE_KAIZEN=1` reserved for later).

---

## 3. Architecture

```text
Acceptance matrix row (TC-ID)
        │
        ├─► Unit (Jest)     button → mocked API method/path/body + response handling
        ├─► API (Vitest)    endpoint status + response shape (+ data-bridge)
        └─► Maestro         visible + clickable + UI success (+ optional staging probe)
                │
                ├─ feature tag   → quick slice
                ├─ app suite     → full app regression
                └─ fleet suite   → all apps serial
```

### 3.1 Keep Maestro (locked)

Do **not** switch the fleet E2E stack to Detox or XCUITest. Maestro already covers all five brands on iOS Simulator. Improve organization (tags, testIDs, mutation contracts), do not replace the framework.

Industry practices applied here:

- Feature folders + Maestro metadata tags + `config.yaml` include/exclude.
- Pyramid: many Unit/API tests, fewer E2E journeys.
- Maestro is black-box — API body proofs live in Jest/Vitest; Maestro asserts UI postconditions and, for critical CRUD only, may probe staging via `runScript`.

---

## 4. Acceptance matrix contract

### 4.1 File layout

| Path | Role |
|------|------|
| [matrices/README.md](./matrices/README.md) | How to score, TOC, RESULTS convention |
| [matrices/platform.md](./matrices/platform.md) | Auth, Shared User, Soft Transfer, subscriptions, notifications |
| [matrices/house.md](./matrices/house.md) | Symply House |
| [matrices/budget.md](./matrices/budget.md) | Symply Budget |
| [matrices/kaizen.md](./matrices/kaizen.md) | Symply Kaizen |
| [matrices/language.md](./matrices/language.md) | Symply Language |
| [matrices/health.md](./matrices/health.md) | Symply Health |
| [matrices/RESULTS_TEMPLATE.md](./matrices/RESULTS_TEMPLATE.md) | Blank Pass/Fail template |
| `matrices/RESULTS_YYYY-MM-DD_<app>.md` | Dated live scoring copies |

### 4.2 Row schema

| Column | Content |
|--------|---------|
| **ID** | Stable id, e.g. `HOUSE-TASK-012`, `BUDGET-SAVE-003`, `PLAT-ST-001` |
| **Description** | One acceptance criterion |
| **Steps** | Numbered repro |
| **Expected** | UI + data outcome |
| **Layer** | `Unit` / `API` / `Maestro` / `Live` (comma-separated when multi) |
| **Automation** | Repo path to test(s), or `gap` |
| **Pass / Fail / N/A** | Only in RESULTS copies |
| **Notes** | Deferred, flaky, account topology, IMP notes |

### 4.3 ID prefixes

| Prefix | Scope |
|--------|-------|
| `PLAT-` | Shared platform (auth, Soft Transfer, subscriptions, …) |
| `HOUSE-` | Symply House |
| `BUDGET-` | Symply Budget |
| `KAIZEN-` | Symply Kaizen |
| `LANG-` | Symply Language |
| `HEALTH-` | Symply Health |

Section codes (examples): `AUTH`, `ONB`, `ST`, `TASK`, `SAVE`, `TODAY`, `LEARN`, `HOME`.

Full id form: `<PREFIX>-<SECTION>-<NNN>` (three-digit, stable once published).

### 4.4 Section map (initial)

| App | Sections |
|-----|----------|
| Platform | AUTH, ONB, SUB, AIACC, NOTIF, SETT, ST, WIDGET |
| House | HOME, TASK, RPT, CONT, UTIL, GARD, FP, HPROJ, CHAT, MIRA, AIHK, SPACE, HH |
| Budget | DASH, PLAN, SPEND, SAVE, PEN, BILL, WISH, BCHAT, ST |
| Kaizen | TODAY, GUIDE, SYS, CAREER, ASSESS, LEARN, MEM, PROF |
| Language | LEARN, TUTOR, PLAN, REVIEW, ASSESS, DIAL, MORE |
| Health | HOME, MORE, PRIV |

### 4.4.1 Section code → Maestro `feature:*` tag (locked)

Matrix IDs use the **section code**. Maestro tags use the **feature tag**. Never invent a third spelling. Tag script: `scripts/e2e/apply-maestro-tags.mjs`.

| Section code | Maestro tag | App |
|--------------|-------------|-----|
| AUTH | `feature:auth` | Platform / Health login |
| ONB | `feature:onboarding` | Platform / Language |
| SUB | `feature:subscriptions` | Platform |
| AIACC | `feature:ai-access` | Platform |
| NOTIF | `feature:notifications` | Platform / House |
| SETT | `feature:settings` | Platform / House / Budget |
| ST | `feature:st` | Soft Transfer |
| WIDGET | `feature:widget` | Platform |
| HOME | `feature:home` | House / Health |
| TASK | `feature:tasks` | House |
| RPT | `feature:reports` | House |
| CONT | `feature:contractors` | House |
| UTIL | `feature:utilities` | House |
| GARD | `feature:garden` | House |
| FP | `feature:floorplan` | House |
| HPROJ | `feature:home-projects` | House |
| CHAT | `feature:chat` | House |
| MIRA | `feature:mira` | House |
| AIHK | `feature:aihousekeeper` | House |
| SPACE | `feature:spaces` | House |
| HH | `feature:households` | House |
| DASH | `feature:dashboard` | Budget |
| PLAN | `feature:plan` | Budget / Language |
| SPEND | `feature:spend` | Budget |
| SAVE | `feature:savings` | Budget |
| PEN | `feature:pension` | Budget |
| BILL | `feature:bills` | Budget |
| WISH | `feature:wishes` | Budget |
| BCHAT | `feature:budget-chat` | Budget |
| LEARN | `feature:learn` | Language / Kaizen |
| TUTOR | `feature:tutor` | Language |
| REVIEW | `feature:review` | Language |
| ASSESS | `feature:assessment` | Language (Kaizen uses `feature:assess` when tagged) |
| DIAL | `feature:dialogue` | Language |
| MORE | `feature:more` | Language / Health |
| PRIV | `feature:privacy` | Health |
| SCROLL | `feature:scroll` | Cross-app scroll contracts |
| TODAY / GUIDE / SYS / CAREER / MEM / PROF | `feature:today` … | Kaizen (tagging deferred) |

Composite CI tags: `slice:<brand>-<feature-slug>-<tier>` (e.g. `slice:budget-savings-smoke`).

### 4.5 Matrix generation rules

Rows come from **current implementation**, not wishlist:

1. Tabs from `src/navigation/tabRegistry.ts` + `brands/*/brand.cjs`.
2. Screens from navigators / `app/` routes.
3. Interactive controls → `src/api/*`, feature APIs, or local storage.
4. Overlay existing Maestro / Jest / Vitest paths into **Automation**.
5. Mark `gap` when UI exists without an owning test, or when Jest mocks only the store.

Priority for depth: **Platform → Budget → House → Kaizen → Language → Health**.

---

## 5. Verification layers

### 5.1 Unit (mobile Jest) — “button owns API”

For every **mutation** matrix row:

1. Render the screen (with `QueryClientProvider` when React Query is used).
2. Mock the domain API module or `@api/client` — **not only** Zustand.
3. Press Save / Delete / Update.
4. Assert HTTP **method**, **path**, **body**, and success/error UI/state from the mocked response.

Reference patterns: `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx` and related data-bridge suites.

Local-first rows (Health weight/water/note; Kaizen SQLite paths): assert persistence APIs / storage helpers instead of HTTP.

### 5.2 API (Worker Vitest / language tests)

- Critical endpoint families assert status + response shape in `backend/` or `backend-language/`.
- Soft Transfer / Shared User: `backend/__tests__/data-bridge/` remains the contract source; matrix **API** cells link those files.
- Live staging probes are optional (`Live` layer) and must never print secrets.

### 5.3 Maestro (real simulators)

**Per mutation flow contract:**

1. Assert control exists (`testID` preferred).
2. Interact (tap / type / submit).
3. Assert UI success (toast, refreshed list, detail fields).
4. Critical CRUD only: optional `runScript` GET against staging with E2E token to confirm persistence.

**E2E console observability (implemented):** gated on **`__DEV__` only** — in-memory ring buffers with Metro prefixes `[E2E-NET]`, `[E2E-DB]`, `[E2E-UI]`, `[E2E-DUMP]`, `[E2E-TAG]`, `[E2E-VERIFY]`. Wired in `src/api/e2eTestObservability.ts`, axios `apiClient`, Language `languageClient`, Kaizen sync persist, Health MMKV, and dev deep links (`{scheme}://e2e-clear-log`, `e2e-tag-matrix`, `e2e-verify-network`, `e2e-dump-log`). Maestro pattern: clear + tag → interact → verify + dump. Programmatic probe: `global.__SYMPLY_E2E__`. Full guide: [E2E_CONSOLE_VERIFY.md](./E2E_CONSOLE_VERIFY.md). No `EXPO_PUBLIC_*` flag; Release builds are no-ops. Prefer Vitest for body proofs; use console verify for Debug Maestro `{method, path, status}` checks only.

### 5.4 Selectors

- Prefer `testID` over visible text.
- Shared primitives must forward `testID` / accessibility labels: fleet-wide `src/components/ui/Button.tsx` and `GradientButton.tsx`; Kaizen uses `@features/kaizen/brand` `BrandButton` (already forwards). Audit `common.tsx` row helpers separately.
- Icon-only controls without IDs stay matrix `gap` until IDs land.

---

## 6. Maestro tags and run modes

### 6.1 Locked tag set

| Tag | Meaning |
|-----|---------|
| `app:house` \| `app:budget` \| `app:kaizen` \| `app:language` \| `app:health` \| `app:platform` | Brand / platform ownership |
| `smoke` | PR / fast confidence |
| `regression` | Full feature coverage |
| `feature:<section>` | e.g. `feature:tasks`, `feature:savings` — maps to matrix section |
| `mutation` | Creates / updates / deletes data |
| `readonly` | Navigation / visibility only |
| `util` | Subflows — always exclude from discovery |
| `slice:<brand>-<section>-<tier>` | Composite tag for CI when AND is needed (see below) |

**Tag filter semantics (Maestro CLI):** multiple values in one `--include-tags` flag are **OR**, not AND. Example: `--include-tags=smoke,feature:savings` runs flows tagged `smoke` **or** `feature:savings`. To run Budget savings smoke only, either (a) scope the directory (`maestro test e2e/maestro/budget --include-tags=smoke`) or (b) add a composite tag such as `slice:budget-savings-smoke` on the flow and filter on that single tag.

Example flow header:

```yaml
appId: com.symply.budget
tags:
  - app:budget
  - feature:savings
  - mutation
  - regression
```

### 6.2 Run modes

| Mode | How |
|------|-----|
| Feature slice | Budget/Kaizen/Language/Health: `maestro test e2e/maestro/<app> --config=e2e/maestro/<app>/config.yaml --include-tags=feature:<slug>`. House: use `npm run test:e2e:feature -- house tasks` or `maestro test --config=e2e/maestro/house/config.yaml` (workspace config with sibling `flows` globs — see IP Phase 1; there is **no** `e2e/maestro/house/` flow tree today) |
| App regression | `npm run test:e2e:<app>:suite` |
| Fleet | `npm run test:e2e:all:suites` |
| PR smoke | Directory-scoped `--include-tags smoke` or composite `slice:*` tag for touched apps |
| Feature npm wrapper | `npm run test:e2e:feature -- budget savings` (Phase 1 — wraps Maestro CLI) |
| Unit slice | `npm test -- <ScreenOrApiName>` |
| API slice | `cd backend && npm test -- <domain>` |

Existing runners (baseline):

- `scripts/e2e/run-house-suite.sh`
- `scripts/e2e/run-budget-suite.sh`
- `scripts/e2e/run-kaizen-suite.sh`
- `scripts/e2e/run-language-suite.sh`
- `scripts/e2e/run-health-suite.sh`
- `scripts/e2e/run-all-suites.sh`

---

## 7. Accounts, fixtures, Soft Transfer

| Need | Approach |
|------|----------|
| Credentials | `e2e/credentials.local` (gitignored) — never commit or print |
| Media fixtures | `scripts/e2e/seed-fixtures.sh` + `e2e/fixtures/` |
| House / Budget | Pre-onboarded household on staging |
| Health | Seeded Health account required for authenticated Maestro |
| Language | Donor Language API token path documented in matrix §0 |
| Destructive tests | Throwaway entities; reconnect/cleanup in the same flow when topology matters |
| Soft Transfer UI | Non-destructive Maestro (list/consent chrome) |
| Soft Transfer data | Vitest / data-bridge proofs; dual-sim E2E deferred (`gap` / future group) |
| Autologin deep link | **Debug builds only** — Release/standalone Maestro must type creds from `e2e/credentials.local` |
| Kaizen / Language | Standalone/Release paths may not use Metro deep-link autologin; follow brand subflows (`kaizen-login-if-needed.yaml`, `language-login-if-needed.yaml`) |
| Disk / simulators | Fleet runs **serial, one brand at a time** on a shared simulator when disk is constrained (see ui-test-audit §5); `run-all-suites.sh` enforces serial order |

**`runScript` / Live probe secret contract:** tokens only via runner env (`E2E_*`), never literals in YAML; never log `Authorization` or full URLs in Maestro artifacts; prefer Vitest/data-bridge over Maestro HTTP probes; defer `runScript` staging GET until composite tags + env wiring exist.

Each matrix file’s **§0 Test account prerequisite** documents topology (Circle-style).

---

## 8. Channel → new feature workflow

When a feature arrives from a channel or PR:

1. Add matrix section + rows in the owning app (or `platform.md`) — IDs stable.
2. Unit tests: every mutation button asserts API (or local persistence).
3. Backend/API tests for new endpoints.
4. Maestro flow(s) with tags; update app `config.yaml` if discovery needs it.
5. Fill **Automation** column with file paths.
6. Run `feature:*` → app smoke → app regression before ship.
7. Optional dated RESULTS copy for release sign-off.

**Rule:** no new Maestro flow without a matrix ID referenced in the YAML comment or filename.

---

## 9. CI / regression operating model (target)

| Cadence | Scope |
|---------|--------|
| PR | Smoke tags for apps touched by the diff (directory-scoped or `slice:*`) |
| Nightly | Full app regression per brand — **serial** on shared simulator; monitor disk |
| Weekly / release | Fleet suite (`run-all-suites.sh`) + RESULTS scoring for apps in the release |

**Ops recovery (disk / flaky E2E):** if disk pressure or purgeable Simulator data blocks runs — free Simulator data (`xcrun simctl delete unavailable` / erase one unused device), run **one brand at a time**, quarantine flaky flows with `tags: [flaky]` + `excludeTags: [flaky]` in that brand’s config (do not delete). Prefer continue-on-failure suite scripts already used by Kaizen. Document RESULTS as N/A + Notes when a row cannot run due to disk.

Do not require dual-sim Soft Transfer for CI gates until a harness exists.

---

## 10. Non-goals

- Replacing Maestro with Detox or XCUITest.
- Amplify CLI / Amplify codegen.
- Android Maestro fleet gates until explicitly scoped (iOS Simulator is the baseline harness today).
- Pixel-perfect visual regression farm (optional later).
- Claiming Maestro-only coverage of API response bodies.
- Production ring-buffer or token-in-YAML E2E probes.
- Implementing product features inside donor repos.

---

## 11. Related docs

| Doc | Role |
|-----|------|
| [FLEET_TEST_IMPLEMENTATION_PLAN.md](./FLEET_TEST_IMPLEMENTATION_PLAN.md) | Phased execution |
| [ui-test-audit-2026-07-17.md](../ui-test-audit-2026-07-17.md) | Screen/element audit snapshot |
| [e2e-fixtures.md](../e2e-fixtures.md) | Fixture seeding |
| [e2e/README.md](../../../e2e/README.md) | House-oriented Maestro runner notes |
| [E2E_CONSOLE_VERIFY.md](./E2E_CONSOLE_VERIFY.md) | Debug console prefixes, deep links, Maestro verify workflow |
| [documents/apps/_ecosystem/features/README.md](../../apps/_ecosystem/features/README.md) | Soft Transfer packages |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-07-17 | Initial strategy |
| v1.1 | 2026-07-17 | Review-plan cycle 1: status → in-progress; fix test counts; tag OR + composite `slice:*`; ring buffer `__DEV__`-only; runScript secret contract; autologin/disk constraints; fleet Button path; Android non-goal |
| v1.2 | 2026-07-17 | Review-plan cycle 2: section→feature tag map; Budget `SAVE` (was SAV); House Maestro workspace (no `house/` flow tree); ops disk/flaky recovery; feature-slice CLI notes |
| v1.3 | 2026-07-17 | Phase 0–1 implementation: matrices live; non-Kaizen Maestro tags; budget/house configs; `test:e2e:feature`; `__DEV__` ring buffer |
| v1.4 | 2026-07-17 | Full feature:* map; tag abbreviations fixed; house suite uses config; ST mutation tests; matrix path prefixes |
| v1.5 | 2026-07-18 | G7/G8 crash class closed; Budget Jest green; Language matrix API links |
| v1.6 | 2026-07-18 | E2E console observability implemented; link E2E_CONSOLE_VERIFY.md |
