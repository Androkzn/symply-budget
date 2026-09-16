# Coverage Audit — `health.md`

| Field | Value |
|-------|-------|
| **Target** | [../health.md](../health.md) — Symply Health P1 shell, prefix `HEALTH-` |
| **Contract** | [../COVERAGE_CONTRACT.md](../COVERAGE_CONTRACT.md) |
| **Reference bar** | Circle V2 TRD/BRD Acceptance Test Matrix (~139 scored rows for one feature) |
| **Audited** | 2026-07-18 |
| **Method** | Code-first inventory (screens, storage module, Maestro flows, Jest suites, Worker config, live API suite), then row-by-row diff. Every cited path verified on disk. |
| **Rows** | **105 → 163** (+58) |

---

## 1. Verified surface (from code, not docs)

Symply Health P1 is genuinely small — **two screens, zero health-domain endpoints**. The matrix's scope claim is accurate.

### Screens

| Screen | File | Interactive controls with a user-visible effect |
|--------|------|---|
| `HealthHomeScreen` | `src/features/health/screens/HealthHomeScreen.tsx` | weight `TextInput` (+ `onSubmitEditing` commit path), kg/lb toggle (2), **Log weight** button, per-row **Delete entry** (×≤3), water **−** / **+**, note `TextInput` (save-on-blur), header bell → `/notifications`, header avatar → `/profile` |
| `HealthMoreScreen` | `src/features/health/screens/HealthMoreScreen.tsx` | **Profile** → `/profile`, **Weight units** → kg/lb/Cancel Alert, **On-device storage** → info Alert, **Apple Health** → info Alert, **AI assistance** → `/ai-access`, **Sign out** → confirm Alert. 2 inert COMING SOON rows |

Non-interactive by design: Home PRIVACY rows (3), Home COMING SOON rows (3), More COMING SOON rows (2).

### Persistence — `src/features/health/healthLocalStorage.ts`

Four MMKV keys, **all global (not per-user, not per-household)**: `health.weightLog.v1` (cap 100), `health.water.v1` (cups clamped 0–30, target 1–30, day-rollover), `health.notes.v1` (cap 60), `health.prefs.v1` (`healthKitEnabled`/`aiEnabled` forced `false` on every read).

### Backend — corrected

Health owns **`symply-health-api`** (`backend/wrangler.health.toml`) with isolated D1 (`symply-health-db-*`), R2, KV and queues; `APP_BRAND`/`JWT_ISSUER`=`symply-health`, `JWT_AUDIENCE`=`symply-health-app`. It is an `isJoinedPlatformBrand()` brand, so it shares the *route contract* (`/auth/*`, `/users/me`, `/households`) but never the House data plane. **No `/health/*` domain route exists** — every health log is MMKV-only.

### Existing automation (all paths confirmed present)

- **Maestro** — 5 flows + 4 subflows under `e2e/maestro/health/`
- **Jest** — 70 tests across 5 files under `src/features/health/`
- **Live API** — `backend/__tests__/live/health-live-api.mjs` (node, real staging + prod)

---

## 2. Gap list

### a. COVERAGE GAPS — surface with zero matrix row (before)

Contrary to the brief's expectation, Health was **not** grossly under-covered at the screen level: at 105 rows for 2 screens it was already the fleet's *densest per screen*. The real gaps were **whole layers and behaviours**, not missing screens.

| # | Gap | Evidence | New rows |
|---|-----|----------|----------|
| 1 | **Entire live API suite unmapped.** `backend/__tests__/live/health-live-api.mjs` exercises 8 real Worker behaviours; **no matrix row cited it**. The most runnable signal in the app was invisible to the matrix | file exists, 6 asserted paths | `API-001…009` |
| 2 | **Second weight-commit path untested in the matrix.** `onSubmitEditing` (keyboard done key) calls `handleLog` — a full mutation path with no row | `HealthHomeScreen.tsx:210`; Jest covers it | `HOME-049` |
| 3 | **Tablet/iPad rendering.** Both screens have Jest iPad tests and distinct tablet layout code; zero rows | `useDeviceType`, `AdaptiveContainer maxWidth:1000` | `HOME-056`, `MORE-024`, `SCROLL-004` |
| 4 | **Greeting branches.** 3 time-of-day branches + null-display-name branch; one generic row | `greetingForNow()` | `HOME-050…052` |
| 5 | **Store functions with no row.** `setWaterTarget`/`clampTarget`, `sortEntriesDesc` immutability, `saveHealthPrefs` round-trip, `loadNotes` corruption, `dateKeyOf` padding, sanity-bound edges | `healthLocalStorage.ts` + Jest | `STORE-011…016` |
| 6 | **Delta-chip direction + single-entry fallback.** Jest tests up/down/none separately; matrix had one row | `weightDelta()` | `HOME-054…055` |
| 7 | **Malformed stored water day.** Jest-covered fallback; no row | `HealthHomeScreen.test.tsx` | `HOME-053` |
| 8 | **Tab-bar completeness.** No row asserting *only* 2 tabs — donor icons exist in the kit and could leak a tab | `brand.cjs` tabs | `TAB-004` |

### b. DEPTH GAPS — missing mandatory families / unexecutable rows

| # | Gap | Detail | New rows |
|---|-----|--------|----------|
| 9 | **CANCEL family entirely absent for HOME.** Contract §3 requires it per screen. No row proved an abandoned weight or note draft does not persist | | `HOME-065…066` |
| 10 | **ERROR family effectively absent.** Every row assumed storage succeeds. `hydrate`, `handleLog`, `handleDelete`, `handleWater`, `handleSaveNote` and the More prefs load have **no `catch`** — a read failure pins the spinner forever; write failures lose data silently | real robustness defect | `HOME-058…061`, `MORE-026` |
| 11 | **PRIVACY family far below the contract's "mandatory" bar.** 10 rows, all *copy assertions* — they checked that the UI **says** data is private, never that it **is**. No cross-user, export/delete, on-the-wire, analytics, crash-report, or app-group rows | contract §5 "privacy rows mandatory" | `PRIV-011…021` |
| 12 | **AUTH lacked VALIDATION/ERROR.** No offline row, no malformed-email row (though the live suite already asserts the 400) | | `AUTH-009…010` |
| 13 | **Terse steps.** `HOME-048`, `MORE-022`, `TAB-003`, `AUTH-007` named no control or stated only a UI outcome. Deepened with numbered steps + both UI and persistence outcomes | | rewritten in place |
| 14 | **Duplicate-submit / race corners missing.** Double-tap **Log weight**, rapid water taps (read-modify-write with no queue) | | `HOME-062…063` |
| 15 | **Execution-groups table understated the blocker.** Claimed "Groups 1–9 skip gracefully", implying runnability. A skip is not a pass — and `scroll-all-screens.yaml` *hard-fails* rather than skipping | | table rebuilt with a Runnable-today column + ⚠ blocker section |

### c. INTEGRITY GAPS — bogus citations

**Automation column: clean.** All 14 distinct repo paths cited across the original 105 rows exist on disk (9 Maestro files, 5 Jest files). No fabricated automation paths — a good result versus the brief's expectation.

**BE / persistence + Console verify: two provable falsehoods.**

| Row | Bogus citation | Verified reality | Fix |
|-----|---------------|------------------|-----|
| `HEALTH-MORE-022` | BE `POST /auth/logout` + Console `Metro: POST …/auth/logout 2xx` | `useAuthStore.logout()` (`src/stores/authStore.ts:162`) makes **no network call**. `authApi.logout` (`src/api/auth.ts:71`) is the only `/auth/logout` caller and has **zero call sites** fleet-wide. Sign-out emits nothing | Rewrote BE to the real local teardown; Console → "No network call"; added `MORE-028` documenting the un-revoked refresh token |
| `HEALTH-PRIV-008` + §0 | "auth uses shared Worker only" / "Health joined-platform Worker" | Health runs its **own** `symply-health-api` with isolated D1/R2/KV (`backend/wrangler.health.toml`). "Shared Worker" is wrong and undermines the isolation the privacy story rests on | Corrected §0 with the real Worker/bindings/base URLs; corrected PRIV-008; added `API-009` asserting isolation |

**Harness integrity defect (new).** `subflows/health-login-if-needed.yaml` gates on `visible: 'Welcome Back'` and drives shared `auth-sign-in-email` / `auth-email-input` / `auth-sign-in-submit` testIDs — but `login-screen-controls.yaml` documents that Health ships its **own** branded LoginScreen (`Symply Health` / `Health, Simplified`) with **no** `auth-*` testIDs. The gate can never match, so the subflow is a permanent no-op **independent of** the seeding blocker. Captured as `AUTH-008`; both blockers must be fixed for login to work.

**Malformed-markdown bug: not present.** The brief anticipated a stray row-schema table injected near the section→tag table. `health.md` had no such corruption — the 8 schema header rows are all legitimate per-section headers. (This bug may exist in a sibling matrix.) Post-edit validation: 163 rows, all 12 pipe-fields, no duplicate IDs, no Pass/Fail columns.

---

## 3. Code defects surfaced (fix, don't just test)

Ordered by severity. These are **product/code** issues found while auditing, not documentation issues.

1. **Health data survives sign-out → cross-user leak.** `health.*` MMKV keys are global and per-user-agnostic. `logout()` resets 14 Zustand stores and clears 9 AsyncStorage keys — **none of them Health's**. On a shared device, user B opening the Health tab sees user A's weight history, water count and daily notes. Sensitive health data crossing an account boundary with no consent, in the app whose entire pitch is on-device privacy. → `PRIV-011`, `PRIV-012`, `MORE-029`
2. **Refresh token never revoked on sign-out.** `POST /auth/logout` is implemented on both client and Worker but never invoked; the token is only dropped locally and stays valid server-side until expiry. **Fleet-wide** — affects every brand, not just Health. → `MORE-028`
3. **Unhandled storage failures.** Six `await`ed storage calls with no `catch`. Read failure ⇒ permanent spinner, no retry. Write failure ⇒ unhandled rejection and silent data loss with the UI still showing the value. → `HOME-058…061`, `MORE-026`
4. **Weight entry id collision.** `addWeightEntry` sets `id = loggedAt` (ISO, ms precision). Two entries in the same millisecond share an id, so `deleteWeightEntry` removes **both**; `sortEntriesDesc` also has no stable tiebreak. → `STORE-017`
5. **No way to clear health data.** Only per-entry weight deletion exists — water, notes and prefs cannot be cleared from the UI at all. Compounds defect 1: a user cannot wipe their data before handing over a device. → `PRIV-015`
6. **Dead store surface.** `setWaterTarget`/`clampTarget` are implemented and unit-tested, but no UI reaches them; the target is permanently the default 8. → `STORE-011`, flagged as deferred

---

## 4. Result

| Section | Before | After | Δ |
|---------|-------:|------:|--:|
| HOME | 48 | 66 | +18 |
| SCROLL | 2 | 4 | +2 |
| MORE | 23 | 29 | +6 |
| PRIV | 10 | 21 | +11 |
| AUTH | 7 | 10 | +3 |
| **API** *(new)* | 0 | 9 | +9 |
| STORE | 10 | 17 | +7 |
| WIDGET | 2 | 3 | +1 |
| TAB | 3 | 4 | +1 |
| **Total** | **105** | **163** | **+58** |

No published ID was renumbered. No feature was invented — every new row traces to shipped code, an existing test, or an explicit **absence** assertion (`PRIV-014`/`015`, `TAB-004`) that guards a documented non-goal.

**Honest coverage position:** 163 rows now describe the surface accurately, but only **Groups 0 and 10–13 (~39 rows: API, STORE, WIDGET, unit-level HOME/MORE, and the unsigned auth boundary) are runnable today**. Every simulator row that needs a session is **BLOCKED** by the unseeded Health D1 account, compounded by the login-subflow defect (`AUTH-008`). Seeding a Health user *and* rewriting the login subflow are the two highest-leverage unblocks; fixing the sign-out data-retention defect is the highest-leverage **product** fix.
