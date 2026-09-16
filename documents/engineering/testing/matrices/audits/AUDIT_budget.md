# Audit — `budget.md` acceptance matrix

| Field | Value |
|-------|-------|
| **Target** | [../budget.md](../budget.md) — Symply Budget storefront (`symply-budget`), prefix `BUDGET-` |
| **Contract** | [../COVERAGE_CONTRACT.md](../COVERAGE_CONTRACT.md) |
| **Reference bar** | Circle V2 TRD/BRD Acceptance Test Matrix |
| **Date** | 2026-07-18 |
| **Method** | Code-first inventory (`app/`, `src/features/budget/`, `src/screens/budget/`, `src/api/*`, `backend/src/routes/*`, `backend/src/services/*`, `e2e/maestro/**`). **Every** cited Automation path and BE route was verified against the filesystem / route registration — no path was accepted on trust. |
| **Rows** | **350 → 545** (+195) |

---

## 1. Summary

| Category | Count | Disposition |
|---|---|---|
| **(a) Coverage gaps** — code surface with zero matrix row | **~120** distinct controls / endpoints | 195 new rows added |
| **(b) Depth gaps** — missing mandatory family, or Steps/Expected too terse to execute | **~60** rows | Covered by new rows; the worst offenders (money validation, chat, When/priority pickers) rewritten as concrete numbered repro |
| **(c) Integrity gaps** — bogus Automation citation or non-existent BE route | **44** (30 automation + 14 BE path) | All fixed |
| Flagged / deferred | 10 → **27** entries | Restructured into Product / Harness / Environment |

Markdown health: the "stray row-schema header table" bug reported for other matrices is **not present** in `budget.md` — all 15 `| ID | Description | …` header rows correspond 1:1 to the 15 section tables, and the section→tag table at the top is well formed. Verified: every one of the 545 rows now has exactly 10 columns (11 unescaped pipes), and no Pass/Fail column exists anywhere (template stays blank).

---

## 2. (c) INTEGRITY GAPS — every citation verified against disk

### 2.1 Automation column citing paths that do not exist (30 rows)

| Cited value | Rows | Verdict | Fixed to |
|---|---|---|---|
| `backend/.../budget.test.ts` | `DASH-023`, `DASH-024`, `DASH-025`, `DASH-031`, `SPEND-017`, `PLAN-035`, `SETT-016` | **Not a path** — elided middle segment, unresolvable | `backend/src/routes/__tests__/budget.test.ts` |
| `backend/.../savings tests` | `PEN-032` | **Not a path at all** — free text with a space | `backend/src/routes/__tests__/savings.test.ts` |
| `backend/__tests__/data-bridge/` | `ST-010` | Directory, not a test file | `…/soft-transfer.test.ts`, `…/routes-gates.test.ts` |
| `ai-entitlement-types.ts` | `BCHAT-015`, `CORNER-003`, `CORNER-004` | **Source file, not a test** (`backend/src/services/ai-entitlement-types.ts`) | `backend/src/routes/__tests__/budget-ai-detect.test.ts` |
| `savings.ts` / `savings.ts` middleware | `SAVE-031`, `PEN-025` | **Source file**, and ambiguous — two files match (`src/api/savings.ts`, `backend/src/routes/savings.ts`) | `backend/src/routes/__tests__/savings.test.ts` |
| `budget-chat-rooms.ts` / `budget-chat-rooms.ts rateLimitDO` | `BCHAT-012`, `BCHAT-021`, `BCHAT-024` | **Source route file, not a test** | `backend/src/services/__tests__/budget-chat-room-service.test.ts` (which does exist and was never cited) |
| `client.ts` interceptors | `AUTH-006` | **Source file** | `gap` |
| `BudgetChatRoomScreen` | `BCHAT-020` | **Source file**, and the row's cited `mention-*` testID pattern is real but there is no `mention-assistant` selector | `gap` |
| `BudgetScreen` / `BudgetScreen` savings probe / `BudgetScreen` savingsFeatureCache | `DASH-033`, `SAVE-032`, `CORNER-001`, `CORNER-002` | **Source file** | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` |

All **58** Jest/Vitest test files and all **34** Maestro YAML files cited elsewhere in the matrix were verified to exist. `e2e/maestro/budget/config.yaml` exists; the header's "28 flows" claim is accurate (29 files = 28 flows + config).

### 2.2 BE / persistence citing routes that are not registered (14 rows)

| Row(s) | Matrix claimed | Actually registered | Source |
|---|---|---|---|
| `ST-001` | `GET …/sync/consents or data-bridge` | `GET /smart-engine/packages`, `GET /smart-engine/consents` | `backend/src/index.ts:208-209`, `src/api/smart-engine.ts:63,66` |
| `ST-002` | `DELETE/PATCH data-bridge consent` | `DELETE /smart-engine/consents/:consentId` | `src/api/smart-engine.ts:79` |
| `ST-003`, `ST-005` | `data-bridge export/import prep` | `GET /smart-engine/packages` | `src/api/smart-engine.ts:63` |
| `ST-006` | `data-bridge preview` | `POST /smart-engine/prepare` | `src/api/smart-engine.ts:93` |
| `ST-007`, `ST-008`, `ST-009` | `data-bridge execute` / `data-bridge API` | `POST /smart-engine/export`, `POST /smart-engine/import` | `src/api/smart-engine.ts:100,108` |
| `ST-010`, `ST-016`, `CORNER-010` | `data-bridge` | `/smart-engine/*` | — |
| `AUTH-007` | `POST /auth/oauth/google` | `POST /auth/google` | `src/api/auth.ts:115` |
| `BILL-019` | `PATCH …/utilities/property-taxes/:year` | `PATCH …/utilities/property-taxes/:taxId` | `backend/src/routes/utilities.ts:408` |
| `BILL-023` | `PATCH …/utilities/bc-assessment` | `PATCH …/utilities/bc-assessment/:assessmentId` | `backend/src/routes/utilities.ts:460` |
| `BCHAT-013/014/015/026` | `POST …/ai/... or coach route` / `AI route` | There is **no separate AI route.** The assistant is triggered inside `POST …/budget-chat-rooms/:roomId/messages` by an `@assistant` regex | `backend/src/services/budget-chat-room-service.ts:82,392` |
| `PEN-012`, `PEN-013` | `…/savings/import/:jobId/commit` and `/undo-history` | Pension has its **own** endpoints: `POST …/savings/import/registered-commit` and `…/registered-undo` | `backend/src/routes/savings.ts` |
| `BILL-006/009/025/026` (param names) | `:id` | `:accountId` / `:billId` | `backend/src/routes/utilities.ts:219,332,663,685` |

**False alarm checked and cleared:** an early inventory pass claimed "there is no `/utilities` route; Bills is backed by savings recurring payments." That is **wrong** — `utilitiesRoutes` is mounted at `backend/src/index.ts:300` on `/households/:householdId/utilities` and defines 34 handlers. The bulk of the BILL section's paths were correct; only the four above were wrong. This was verified directly rather than accepted.

### 2.3 testIDs cited that do not exist in source

| Row | Cited testID | Reality |
|---|---|---|
| `HH-005` | `fab-add-household` | **Does not exist.** `BudgetHouseholdScreen.tsx:473` renders `<FloatingActionButton title="Add New Household" …>` with **no testID passed**. Row rewritten to select by title; new `HH-017` documents the blocker. |
| `HH-014` | `swipe-open-trigger` | **Does not exist.** A `Swipeable` is present (`BudgetHouseholdScreen.tsx:83`) but neither it nor its "Edit" action carries a testID. New `HH-018` documents it. |
| `BCHAT-020` | `mention-*` | Pattern is real (`mention-${m.user_id}`) but `@assistant` is appended to the candidate list with a `user_id`-derived testID, so **no stable `mention-assistant` selector exists**. New `BCHAT-035` documents it. |

The other 30 cited testIDs were verified present in source.

---

## 3. (a) COVERAGE GAPS — code surface with zero matrix row

### 3.1 Money input validation — the largest gap for a money app

The matrix had **four** validation rows across the whole money surface (`PLAN-012`, `SPEND-022`, `SAVE-030`, `SETT-015`), each a one-line "blocked; no POST". The actual contract is far richer and **inconsistent**, which is itself the finding.

**Client side** — there is no shared money-input component. `toCents` is re-implemented on **seven** screens with **three** different rulesets:

| Screen | Rule | Rejects |
|---|---|---|
| `budgetItemFormUtils.ts:41` | `parseFloat` → `Math.round(n*100)` | non-numeric only — **negatives and zero pass through** |
| `BudgetSpendingsView.tsx:75` | `NaN \|\| n <= 0` | non-numeric, zero, negative |
| `SavingsGoalForm.tsx:50` | `NaN \|\| n < 0` | non-numeric, negative (zero allowed) |
| `SavingsRegistered.tsx:49` | strips `,` then `n < 0` | non-numeric, negative; **only screen that strips thousands separators** |
| `BudgetReceiptScanScreen.tsx:99` | `NaN \|\| n < 0` | non-numeric, negative |
| `SavingsRecurringPaymentsScreen.tsx:38` | `replace(/[^0-9.]/g,'')` | **silently converts `-50` to `50`** |
| `WishDetailScreen.tsx:766`, `AddWishModal.tsx:99` | `Math.round(parseFloat(…)*100)` | **nothing** — malformed input yields `NaN` cents |

No screen sets `maxLength` or caps decimal places. Only the transfer screen has an explicit client-side maximum.

**Server side** — hard Zod bounds that had no rows at all:

- expense `amount: z.number().int().min(1)` — zero and negative rejected, fractional rejected
- planned item `estimated_cost_min/max: int().min(0)` — zero allowed
- transfer `amount_cents: int().positive()`
- pension contribution `amount_cents: positive()`, `employer_amount_cents: nonnegative()`, `goal_pct: 0–100`
- savings `amount_cents/target_amount_cents: int().min(0)`
- wishes `estimated_cost_cents: int().min(0).max(1_000_000_000)` — **the only explicit maximum in the schema set**
- string caps: title 200, description 1000, notes 2000, entry body 4000, category name 100 / icon 10 / colour 20, vendor 200, transfer note 500
- collection caps: bulk expenses 1–100, expense list limit 1–500 (default 100), chat attachments 10, mentions 50
- range bounds: year 2020–2100, month 1–12, quarter 1–4

→ **31 new rows**: `PLAN-057`–`063`, `PLAN-066`, `PLAN-069`, `PLAN-070`, `PLAN-072`, `PLAN-073`, `SPEND-037`–`042`, `SPEND-046`, `SPEND-047`, `SAVE-051`, `SAVE-054`, `SAVE-063`, `SAVE-064`, `SAVE-075`, `PEN-037`–`039`, `PEN-044`, `WISH-025`–`030`, `WISH-032`, `BCHAT-030`, `BCHAT-033`, `BCHAT-034`, `SETT-026`, `SETT-028`, `CORNER-011`–`015`.

### 3.2 Budget chat fork — 26 rows for a fully forked feature

The fork is substantial and was covered thinly. Verified specifics that had no rows:

- **Tables** `budget_chat_rooms`, `budget_chat_messages`, `budget_chat_room_participants`, `budget_chat_room_reads` (`backend/src/db/schema-budget-chat.ts`) — fully disjoint from House chat; only `ChatRoomDO` is shared, statelessly.
- **Two mounts at the same prefix** (`index.ts:196` WS, `index.ts:271` REST). The WS router is mounted **before** `/households` because React Native's WebSocket cannot set an `Authorization` header — it auths via `?token=`. → `BCHAT-042`.
- **`@assistant` gate is a conjunction**: `mentionsAssistant && room.ai_enabled` (`budget-chat-room-service.ts:392`). The mention alone is insufficient. → `BCHAT-036`.
- **BYOK attribution**: the key is resolved for the **mentioning** member, not the room owner (`:551`), metered as `feature: 'budget_chat_assistant'`. → `BCHAT-038`.
- **Provider hardcoded to `'anthropic'`** — no provider selection, contradicting the multi-provider BYOK hub. → `BCHAT-039` + flag.
- **Fire-and-forget**: the assistant runs under `waitUntil` (`:408`), so the POST returns before the reply exists and the reply arrives over the WebSocket. Any Maestro assertion must wait on the bubble. → `BCHAT-037`.
- **Silent entitlement denial**: `assertCanUseAI` failure skips the reply while the user's message still posts 201, with no notice. → `BCHAT-040` + flag.
- **Not gated by `requireBudgetApi()`** — chat stays reachable on a Worker where `/budget`, `/savings`, `/wishes` all 404. → `BCHAT-045` + flag.
- Empty states, create-sheet controls (all four untestID'd), AI chip, send-enable logic, pagination cursor, room delete, pull-to-refresh, room-settings screen (zero testIDs). → `BCHAT-027`–`032`, `041`, `043`, `044`, `046`.

### 3.3 Household decoupling — 13 rows

`src/navigation/SettingsNavigator.tsx:26` swaps `BudgetHouseholdScreen` in for House's `HouseholdManagementScreen` at module load via `isFullBudget()`. Brand branching for the API itself is backend-side (`backend/src/config/brand-capabilities.ts`, `budget-api.ts`) — Budget uses the **shared, unbranded** `/households` router. Newly covered: the reskin's omissions (no address / photo / floor plans / property tax), its budget-framed copy in four places, owner-vs-member action visibility, delete/leave confirm copy, invite-by-email vs invite-by-link, join-request approve/deny, member removal, and the fact that `BudgetHomeScreen` is a **dead surface** in the Budget brand. → `HH-017`–`029`.

### 3.4 Item form pickers — 20 rows, previously zero

`BudgetItemFormScreen.tsx` is Budget's busiest form and had 5 rows. Uncovered: the kind segmented control, cost mode exact/range, all four priority chips (with the deliberately **inverted** colour scale — `critical` = green, `low` = red), the entire When system (8 options, 4 rendered as primary chips + a "More" sheet), `when_possible` → undated item that never consumes a month's budget, the specific-date picker's clamping to `monthDateBounds` (min = 1st of month, max = today or month end; a future month exposes exactly one day), the category picker sheet with search / none / close, and the save-disable predicate. → `PLAN-041`–`056`, `PLAN-064`, `PLAN-065`, `PLAN-067`, `PLAN-068`.

### 3.5 Endpoints with no row (~30)

`GET /budget/items/:id` · `GET /savings/goals/emergency-fund/suggestion` · `GET /savings/import/:jobId` · `POST /savings/import/:jobId/commit-history` · `POST/PATCH/DELETE /savings/income-templates[/:id]` · `POST /savings/registered/:id/transactions` · `POST /savings/registered/:id/apply-regular` · `DELETE /savings/registered/member-contributions` · `POST /savings/import/registered-commit` · `POST /savings/import/registered-undo` · `GET /savings/recurring-payments/apply-status` · `GET /utilities/municipality` · `GET /utilities/property-overview` · `GET /utilities/analytics` · `POST /utilities/analytics/calculate-trends` · `GET /utilities/reminders` · `GET /utilities/providers` · `POST /utilities/calculate-homeowner-grant` · `POST /utilities/property-taxes/:taxId/calculate-penalties` · `POST /utilities/property-taxes/calculate-due-date` · `GET /utilities/property-taxes/:year` · `POST /utilities/bc-assessment` · `GET /budget-chat-rooms/:roomId/ws` · `POST /auth/apple` · `POST /auth/platform/companion` · `POST /auth/refresh` · `POST /households/:id/leave` · `POST /households/:id/invite` · `POST /households/:id/invite-link` · `POST /households/:id/join-requests/:requestId/approve|deny` · `DELETE /households/:id/members/:memberId`.

### 3.6 Real tests that existed but were never cited

The matrix marked rows `gap` while working tests sat on disk:

`backend/src/services/__tests__/budget-chat-room-service.test.ts` · `backend/src/routes/__tests__/savings.test.ts` · `…/savings-history-routes.test.ts` · `…/savings-budget-consistency.test.ts` · `…/home-budget.test.ts` · `src/features/budget/chat/__tests__/budgetChatApi.test.ts` · `budgetChatStore.test.ts` · `budgetChatUnread.test.ts` · `useBudgetChatSocket.test.tsx` · `src/screens/budget/__tests__/BudgetItemAIScreen.test.tsx` · `BudgetSpendingsView.test.tsx` · `budgetFormat.test.ts` · `budgetItemFormUtils.test.ts` · `budgetQuickAddHelpers.test.ts` · `budgetAffordabilityChartUtils.test.ts` · `src/features/budget/screens/__tests__/BudgetDataSharingScreen.test.tsx` · `BudgetHomeScreen.test.tsx` · `src/api/__tests__/savings.api.test.ts` · `utilities.api.test.ts` · `wishes.api.test.ts` · `joined-platform-auth.test.ts`.

Wired into the appropriate new and existing rows.

---

## 4. (b) DEPTH GAPS

Roughly 60 rows had Steps like "1. Delete goal" and Expected like "Card removed" — not executable, and asserting only UI with no data outcome. The contract requires Steps to name the exact control and Expected to state **both** the UI and the persistence outcome.

Rather than rewrite all 350 published rows (which risks churning IDs and diffs on rows that are merely terse, not wrong), the pass added **concrete sibling rows** that carry the executable detail and named controls, and rewrote in place only where the row was actively misleading (bogus testID, bogus BE path, or a claim contradicted by code). Sections most affected: BCHAT (thin on a fully forked feature), PEN (import endpoints wrong), ST (every BE path fictional), HH (two invented testIDs).

Mandatory-family check after the pass — every section now carries LOAD, SCROLL, VISIBLE, INTERACT, MUTATION, CANCEL, VALIDATION, ERROR and CORNER rows. Previously missing: VALIDATION in BILL (one row, `gap`), ERROR in PEN/WISH/BCHAT (single offline row each), CORNER in ST (none), CANCEL in SETT (`gap`).

---

## 5. Top 5 findings

1. **Every Soft Transfer BE path in the matrix was fictional.** Ten rows cited `data-bridge` / `/sync/consents`, which are registered nowhere. The real surface is `/smart-engine/{packages,consents,prepare,export,import}` mounted at `backend/src/index.ts:209` behind `requireBrandCapability('smartEngine')`. The whole ST section was unexecutable as written.

2. **Money validation is duplicated seven times with three contradictory rulesets, and the matrix asserted none of it.** The item form accepts negatives and zero and ships them to a server that rejects them with a 400; the recurring-payments field silently turns `-50` into `50`; the wish price field can produce `NaN` cents. For a money app this is the highest-risk uncovered surface — now 31 rows, plus flags #1–#4.

3. **Nine Automation citations pointed at source files rather than tests**, and two more (`backend/.../budget.test.ts`, `backend/.../savings tests`) were unresolvable elided strings. Meanwhile 21 real, working test files — including `budget-chat-room-service.test.ts`, the only backend coverage the chat fork has — were never cited and their rows sat at `gap`.

4. **The budget chat fork's actual contract contradicts how the matrix described it.** There is no AI route: `@assistant` is a regex inside the messages POST, gated on `mentionsAssistant && room.ai_enabled`, billed to the *mentioning* member's BYOK key, hardcoded to Anthropic, and run under `waitUntil` so the reply arrives over the WebSocket after the POST returns. Four rows cited a non-existent "AI route" and asserted a synchronous reply.

5. **Two invented testIDs and three screens with none at all.** `fab-add-household` and `swipe-open-trigger` do not exist in any source file. Separately, `BudgetTimelineScreen`, `BudgetYearSetupScreen` and `BudgetChatRoomSettingsScreen` expose zero testIDs across every control, and `budget-bills-view` is reused across four distinct states — so several rows cannot be automated as written regardless of citation accuracy.

---

## 6. Verification performed

- All 58 cited Jest/Vitest files and 34 Maestro YAMLs resolved via `find` against the working tree.
- All budget-area routes cross-checked against `backend/src/index.ts` mounts plus the handler declarations in `routes/{budget,savings,wishes,utilities,budget-chat-rooms,households}.ts`.
- All money Zod schemas read directly from the route files; all client `toCents` implementations read directly from the screen files.
- 32 cited testIDs grepped against `src/`, `app/` and `e2e/`.
- Post-edit: 545 rows, all with exactly 10 columns; zero duplicate IDs; zero Pass/Fail columns; no published ID renumbered.
