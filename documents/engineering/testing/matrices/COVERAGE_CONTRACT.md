# Fleet Matrix Coverage Contract (Circle V2 bar)

| Field | Value |
|-------|-------|
| **Status** | locked — 2026-07-18 |
| **Reference bar** | Circle V2 TRD/BRD Acceptance Test Matrix (~139 scored rows for **one** social feature) |
| **Target** | Same density for **every** Symply storefront feature/screen, plus shared platform |
| **Strategy** | [../FLEET_TEST_STRATEGY.md](../FLEET_TEST_STRATEGY.md) |

---

## 1. What “done” means for a matrix file

A matrix is **not** a smoke checklist. For each app it must be detailed enough that a tester (or Maestro suite) can:

1. Visit **every tab, every screen, every sheet/modal** reachable in the current build.
2. Exercise **every** button, text field, dropdown/picker, checkbox, toggle/switch, chip, segmented control, and icon-only action that has a user-visible effect.
3. Prove **every** create / read / update / delete / enable / disable / invite / accept / decline path against **real** staging (or local persistence for local-first apps) on an **emulator/simulator**.
4. Confirm **scrollability**: each scrollable surface reaches a bottom sentinel; sticky headers/FABs do not block content; lists with many rows remain usable.
5. Confirm **visibility + interactability**: control is on-screen (or revealed by scroll), hit-target works, disabled/loading states are correct when expected.
6. Cover **main paths and corner cases**: empty, validation errors, offline/error toasts, permission denials, duplicate submit, cancel mid-flow, household role limits, entitlement gates.

Language / Health matrices mark rows **deferred** when the UI is stub-only; do not invent donor features that are not in this repo.

---

## 2. Row schema (templates stay blank; RESULTS get scores)

| Column | Required content |
|--------|------------------|
| **ID** | `<PREFIX>-<SECTION>-<NNN>` stable once published |
| **Description** | One concrete acceptance criterion (control, journey, or BE contract) |
| **Steps** | Numbered repro; name the exact control (`**[ Save ]**`, `testID=…`) |
| **Expected** | UI outcome **and** data outcome (list refresh, field value, empty state) |
| **UI elements** | Controls under test (btn / field / DD / toggle / checkbox / sheet) |
| **BE / persistence** | HTTP method+path **or** local store key/table; `none` if pure UI |
| **Console verify** | What must appear in Metro/`__DEV__` network log (method, path, status) — or `n/a (local)` / `n/a (UI-only)` |
| **Layer** | `Unit` / `API` / `Maestro` / `Live` (comma-separated) |
| **Automation** | Repo path(s) or `gap` |
| **Notes** | Corner case, account topology, conditional, IMP-deferred |

Pass / Fail / N/A columns exist **only** in dated `RESULTS_YYYY-MM-DD_<app>.md` copies.

---

## 3. Mandatory row families (every screen)

For **each** screen/sheet in scope, the matrix must include at least:

| Family | Example IDs | Must assert |
|--------|-------------|-------------|
| **LOAD** | `…-001` | Screen mounts; primary content or empty state; no crash |
| **SCROLL** | `…-SCROLL-001` | Scroll to bottom sentinel; all sections reachable |
| **VISIBLE** | per control group | Named controls visible (or scroll-revealed) |
| **INTERACT** | per control | Tap/type/toggle works; disabled when appropriate |
| **MUTATION** | create/edit/delete | Real persist + UI sync; console shows expected call |
| **CANCEL** | dismiss sheet / back | No partial write; prior state preserved |
| **VALIDATION** | empty required, bad format | Inline/error UI; **no** successful BE call |
| **ERROR** | forced 4xx/5xx or offline | User-visible error; no silent success |
| **CORNER** | duplicates, caps, roles, entitlement | Documented edge behavior |

Shared chrome (tab bar, header back, FAB) gets rows once per app shell, then per feature when behavior differs.

---

## 4. Backend / console verification (emulator)

Every mutation and critical load row that hits the network:

1. Run on iOS Simulator (or Android emu) against **staging**.
2. In `__DEV__`, confirm Metro shows `[E2E-NET]` / `[E2E-DB]` lines matching **Console verify** (see [../E2E_CONSOLE_VERIFY.md](../E2E_CONSOLE_VERIFY.md)).
3. Assert UI postcondition (toast, list row, detail field).
4. Prefer Unit (mocked client asserts method/path/body) + Maestro (UI) + API (Worker) over Live-only.

**Harness (implemented):** ring buffers + console prefixes in `src/api/e2eTestObservability.ts`; Maestro subflows `e2e-clear-log`, `e2e-tag-matrix`, `e2e-verify-network`, `e2e-dump-log`; dev deep links `{scheme}://e2e-*`. Map matrix cells like `POST /tasks 201` → `findE2ENetworkEntryBySpec` or `e2e-verify-network?method=POST&path=/tasks&status=201`. Workflow: **before** (clear + tag) → interact → **after** (verify + dump).

Local-first (much of Kaizen; Health logs): **Console verify** = `n/a (local)` — grep `[E2E-DB]` or Jest on the storage helper; not HTTP.

Do **not** print secrets, tokens, or full query strings with PII into matrix docs or RESULTS notes.

---

## 5. Density bar (Circle V2)

Circle V2 scored **~73 + ~66** criteria for Circle2 + SmartFeed alone, with multi-account topology, security negatives, and flagged ambiguities.

Fleet targets (implementation-backed, not wishlist):

| Matrix | Minimum density guidance |
|--------|--------------------------|
| Platform | Auth + HH + SUB + SETT + NOTIF + ST + AIACC + WIDGET — full control inventory |
| House | Every HOME/TASK/RPT/CONT/UTIL/GARD/FP/HPROJ/CHAT/MIRA/AIHK/SPACE/HH screen |
| Budget | Every DASH/PLAN/SPEND/SAVE/PEN/BILL/WISH/BCHAT/ST screen |
| Kaizen | Every hub + nested tool screen (Today → Career → Assess → …) |
| Language | Shipped tabs/screens only; stub rows marked deferred |
| Health | Shipped tabs/screens only; privacy rows mandatory; stub marked deferred |

If a feature has many controls, prefer **many small rows** (one criterion each) over one vague “screen works” row.

---

## 6. Execution groups

Mirror Circle V2’s “Automated Test Coverage — Execution Groups” table near the top of each matrix:

| # | Group | Rows (ID list) | Device / accounts | Notes |
|---|-------|----------------|-------------------|-------|
| 0 | … | … | … | Run order, fixtures, teardown |

Groups must be independently runnable where possible; destructive tests restore fixtures.

---

## 7. Part “Flagged / deferred”

Each matrix ends with a **Flagged** section (do not score as Pass/Fail):

- Product contradictions
- Missing testIDs blocking Maestro
- Donor features not yet ported
- Needs multi-sim / Soft Transfer dual-app harness

---

## 8. Generation rules

1. Inventory from **code** (`tabRegistry`, navigators, screen components, `src/api/*`).
2. Cross-check app `features/README.md` — docs do not invent UI.
3. Overlay existing Maestro / Jest / Vitest into **Automation**; else `gap`.
4. Keep section codes ↔ Maestro `feature:*` tags per [FLEET_TEST_STRATEGY.md §4.4.1](../FLEET_TEST_STRATEGY.md).
5. Templates stay unchecked; only RESULTS copies get ☑ after a real run.
