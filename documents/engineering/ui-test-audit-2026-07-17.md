# UI / M2M Test Audit & Remediation Plan — 2026-07-17

Scope: exhaustive audit of every screen across all 5 ecosystem apps (Kaizen, Health,
Language, House, Budget), mapping **screen → interactive element → backend API call →
existing test coverage**, plus live-simulator UI-alignment review. Goal: 100% element +
action (M2M) coverage, modular by feature/screen, with screenshot/alignment checks.

Full per-cluster audit tables live in the session scratchpad (`scratchpad/audit/*.md`,
`scratchpad/audit/parts/*.md`). This doc is the durable summary + execution plan.

---

## 1. Bugs already found & FIXED (verified green)

| # | Bug | File | Class | Verify |
|---|-----|------|-------|--------|
| 1 | "Administration" tile label overflows container (`Administratio` / `n`) — the reported visual bug | `src/features/kaizen/screens/OnboardingScreen.tsx` | `numberOfLines={2}`+`adjustsFontSizeToFit` never shrinks a long single word → switched to `numberOfLines={1}` + `minimumFontScale={0.7}` + `ellipsizeMode` | OnboardingScreen tests 5/5 pass (visual re-verify pending rebuild) |
| 2 | **Health "More" tab crashes on render** — `useTheme()` unimported, `colors` undefined | `src/features/health/screens/HealthMoreScreen.tsx:65` | undefined-`colors` → `useAppColors()` | `src/features/health/` 70/70 pass (was 62/70) |
| 3 | **Language "Plan" screen crashes on load** — `Metric` uses undefined `theme`/`colors` | `src/features/language/screens/LanguagePlanScreen.tsx` | dropped dead `theme` prop, gave `Metric` its own `useAppColors()` | LanguagePlanScreen 13/13 pass (was 7/13) |

Repo-wide `tsc` sweep for `Cannot find name 'colors|theme|useTheme'` = clean for all
**typechecked** files.

## 2. Latent crash class (parked screens — NOT in typecheck path, not mounted, zero tests)

House labor-hub / contractor sub-components reference `colors` without an in-scope
`useAppColors()` (e.g. `AppointmentDetailScreen.tsx` `InfoRow` L62-80; `AppointmentsScreen`
sub-components L189/217; `ChecklistEditorScreen` L124; `AddEditProjectScreen` L141). These
would `ReferenceError` on render but are unreachable today. **Fix in Phase A** alongside the
tests that will mount them (so the fix is verified, not blind). Also flagged: conditional
`useAppColors()` calls inside callbacks (Rules-of-Hooks) in contractor screens.

## 2b. VERIFIED SHIPPED crashes — CLOSED (2026-07-18)

Originally open (undefined `colors` / unimported `useTheme`). Remediation:

- **Budget:** prior screens already had `useAppColors()`; remaining shipped crash was
  `WishDetailScreen` `AddLinkModal` (`useTheme` unimported) — removed. ScreenHeader migration
  left several Budget Jest suites mocking only `BackButton`; mocks + `backButtonTestID` fixed
  → Budget Jest **71/71**.
- **House labor-hub/contractors** (parked): nested sub-components now call `useAppColors()`;
  unused `useTheme()` removed. Automation still near-zero (mount + tests = follow-up).
- **Fleet follow-on (same class):** Settings/Appearance/Garden/Utilities/AI Housekeeper/
  Soft Transfer cards — missing `useTheme` import or nested `colors` without `useAppColors()`
  fixed in the same pass (2026-07-18).

## 2c. Concurrent-writer note (2026-07-17)

`main` was being committed to by another process during the audit (commits `59a7c501`,
`5c3e3be5`, `7d5dcf81`, `7922dd42` — Health-brand/AI-access/design-token work). That refactor
made QuestionBanks/BookDetail/CareerHub read questions via React Query `useQuery` but left
their tests without a `QueryClientProvider` (63 failures). Structural fix applied (provider
added to the 4 render helpers → `scrollableScreens` green, 63→29). Residual 29 are data-seeding
coupled to the in-flight query-hook refactor — finish once that refactor settles (seed the
query cache or mock the hook, not the store).

## 3. Systemic findings (root causes, ecosystem-wide)

1. **No stable selectors.** `BrandButton` (primary CTA everywhere) and `common.tsx`
   `kaizenStyles.row` do not forward `testID`/`accessibilityLabel`. Almost every interactive
   element is reachable only by visible text → Jest fragile, Maestro often can't target,
   icon-only controls (↑/↓, delete, record dot, ✓/✕) invisible to screen readers. **Highest
   leverage fix: add forwarding to the shared primitives, then plumb IDs per screen.**
2. **No `numberOfLines` on user/AI text** next to fixed trailing controls → the
   "Administration overflow" class recurs (SystemConfig header, SystemsHub rows, Insights
   skill name vs %, Coach `nextSuggestion` clips, memory facts, notification bodies, Settings
   timezone value). Needs per-screen truncation + live-sim screenshot verification.
3. **Store-boundary tests, not endpoint tests.** Screen Jest suites mock the store and assert
   store-action args — the actual `store → /api/v1/*` HTTP mapping (multipart, endpoint
   choice) is unverified at screen level. Real API regressions pass. Covered only by
   store/live-API suites.
4. **Error/rejection paths largely untested** for fire-and-forget `void` store calls
   (confirmWake, pull-to-refresh, setSystemActivation, materializeSystemTasks, upsert/delete
   habit stack, saveWeeklyRotation, etc.).
5. **React Query invalidation-after-mutation unasserted** (Reviews, Memory, InterviewPipeline
   — hooks mocked static).
6. **Correctness smell:** `AttemptHistoryScreen` renders `{overall_score}/5` while AI-judged
   attempts store 0-100 → can show `87/5`.

## 4. Per-app coverage snapshot

| App | Jest screens | Maestro flows | Biggest gap |
|-----|--------------|---------------|-------------|
| **Kaizen** | deep (~40 screens) | 22 flows, mostly visibility+scroll (few real taps) | testIDs; Maestro interaction taps; error paths; stack screens no E2E |
| **Health** | 2 (now green) | **0** | MoreScreen crash (fixed); 16/16 controls no testID; on-device login blocked (unseeded acct) |
| **Language** | 8 (now green) | **0** | PlanScreen crash (fixed); ~50/54 controls no a11y; hits live donor `/api/v1` |
| **House** | strong on core; **contractors/visits/labor-hub = 0 Jest, ~0 Maestro** | most flows | huge untested surface (~250 elements, ~90 API-firing, ~2 testIDs) + parked crashes |
| **Budget** | forked household/chat | 8 flows | brand-branched behavior + budget-chat M2M |

## 5. Environment constraints

- **Disk:** Data volume 95% full (408/460 GB used). Reclaimable sims moved to APFS purgeable
  (~27 GB container free). Cannot hit 30 GB without touching off-limits data (music/Step/source).
  → Live-sim runs must be **serial, one brand at a time**, disk-monitored.
- **Unblock:** all 5 brand apps are already installed on `Kaizen-A` — screenshot/alignment
  audit can run against installed builds at **zero build cost**; one rebuild per brand only to
  verify fixes.
- **Login:** autologin deep link is Debug-only; installed builds are Release → Maestro must
  type shared creds (`a.tekhtelev@gmail.com`, works across apps; Health acct unseeded).

## 5b. Emulator E2E suite — DELIVERED (2026-07-17)

Modular Maestro UI suites authored for all 5 apps, organized to run by screen/feature:
`e2e/maestro/{kaizen(53), budget(27), language(17), health(10), + House flows across
onboarding/reports/profile/tasks/contractors/notifications/mira/aihousekeeper/households/
spaces/garden/utilities}` — **184 total flows (~110 new)**. Runners: `scripts/e2e/run-<app>-suite.sh`
+ umbrella `run-all-suites.sh`; npm: `test:e2e:<app>:suite` and `test:e2e:all:suites`.
Stale/phantom selectors fixed (auth `'Welcome Back'`→`auth-sign-in-email`, `home-add-task-fab`→
`home-up-next-add-task`, budget `*-cancel`→`nav-back-button`).

**Runnable status (verified on Kaizen-A):** the harness RUNS on the emulator — the Kaizen
`settings` flow drove login (deep-link) → navigation → section assertions → sync tap successfully;
remaining failures are per-flow selector/scroll tuning (e.g. a `scrollUntilVisible` that needs
`waitToSettleTimeoutMs`). This is the normal E2E bring-up loop: every new flow needs 1–3 selector
tweaks re-verified against the live app (~2 min/iteration due to ~120s driver startup + OTA wait).

**Gates to 100% green:** (1) per-flow stabilization pass (serial sim time); (2) Health auth flows
blocked until its login buttons get testIDs AND a Health account is seeded; (3) onboarding funnel
flows need a fresh un-onboarded account (shared account is already onboarded); (4) ~missing testIDs
make many taps text-matched (fragile) — a testID pass hardens them.

## 6. Execution plan (sequenced; A→D)

- **Phase A — Harden primitives & kill latent crashes.** testID/a11y forwarding on
  `BrandButton` + a shared accessible `Row`/`LinkRow` primitive in `common.tsx`; add
  `numberOfLines`/`flexShrink` where trailing controls exist; fix parked-screen undefined-`colors`.
- **Phase B — Modular M2M tests.** Per screen/feature: assert every element renders +
  accessible, every action fires the correct API/store call with correct args, error/loading
  paths, and RQ invalidation. Fan out by feature (parallel agents editing disjoint files).
- **Phase C — Maestro E2E.** Author Health & Language flows (currently zero); add real
  interaction taps to Kaizen/House hub flows; keep modular (per screen/feature dir).
- **Phase D — Serial live-sim UI+alignment audit.** Per brand (Kaizen→Health→Language→
  House+Budget): drive installed app, screenshot every screen, inspect for alignment/overflow,
  verify os_log backend wiring, fix, then one rebuild to verify. Disk-gated, serial.
