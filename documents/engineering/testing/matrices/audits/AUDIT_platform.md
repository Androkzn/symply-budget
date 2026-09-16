# Audit — `platform.md` acceptance matrix

| Field | Value |
|-------|-------|
| **Target** | [../platform.md](../platform.md) — prefix `PLAT-` |
| **Scope** | Shared platform: auth, onboarding, households, subscriptions, AI access/BYOK, notifications, settings, Soft Transfer, widget/watch, analytics |
| **Bar** | Circle V2 TRD/BRD Acceptance Test Matrix |
| **Contract** | [../COVERAGE_CONTRACT.md](../COVERAGE_CONTRACT.md) |
| **Date** | 2026-07-18 |
| **Rows before → after** | **272 → 378** scored rows (+106) |
| **Method** | Code-first inventory: `app/**` (expo-router), `src/screens/**`, `src/components/ai/**`, `src/api/**`, `src/stores/**`, `backend/src/index.ts` route mounts + `backend/src/routes/*.ts` handler paths. Every cited automation path checked against `git ls-files` / `os.path.exists`. |

---

## 0. Summary of findings

| Category | Count | Resolution |
|----------|------:|------------|
| **A. Coverage gaps** — code surface with zero matrix row | **41** distinct surfaces/endpoints | 106 new rows added |
| **B. Depth gaps** — screens missing mandatory families or too terse to execute | **9** screen groups | families backfilled; new rows written to full density |
| **C. Integrity gaps** — bogus automation path or wrong BE path | **31** rows (18 automation + 13 BE) | all corrected or downgraded to `gap` |

Post-pass verification (scripted): 378 scored rows, **0** duplicate IDs, **0** rows with a non-conforming column count, **0** unresolved automation paths.

**Markdown health:** the stray row-schema header table injected into the section→tag table (the known bug in this matrix family) is **not present** in `platform.md` — its section→tag table is clean. It *is* present in `health.md` (a `| ID | Description | Steps | … |` header at line 86 sitting outside a row table); flagged here, not fixed, as it is out of scope for this file.

---

## A. Coverage gaps — in code, zero matrix row

### A1. `app/ai-access/**` — the entire BYOK hub (largest gap)

Six shipped route screens with real controls had **no** per-screen rows. The old AIACC section covered only the gate/hook abstractions and the raw credential endpoints.

| Screen | Controls found in code | Rows added |
|--------|------------------------|-----------:|
| `app/ai-access/index.tsx` | 3 navigation cards (paywall / providers / manage) | `PLAT-AIACC-017`…`020` |
| `app/ai-access/providers.tsx` | provider rows from `src/components/ai/providerMeta.ts` → `connect?provider=<id>` | `021` |
| `app/ai-access/connect.tsx` | key `TextInput` (placeholder = `meta.keyFormat`), acknowledgement toggle, `testID=ai-connect-button`, `ProviderKeyGuide` | `022`…`027` |
| `app/ai-access/models.tsx` | model list select, **Done** footer, `router.back()` | `028`…`030` |
| `app/ai-access/manage.tsx` | Activate, Re-validate, Disconnect (+`Alert.alert` confirm), Edit key, per-provider models | `031`…`039` |
| `app/ai-access/paywall.tsx` | Subscribe, Restore purchases, Manage-subscription `Linking` link, BYOK link, `subscriptionsEnabled` flag gate | `PLAT-SUB-017`…`023` |
| cross-cutting | `GET /ai-access`, `GET /ai-models`, `PATCH /ai-preferences`, profile entry point, scroll, offline | `040`…`043` |

### A2. Backend routes with no matrix row

Verified against `backend/src/index.ts` mounts + handler definitions.

| Route | Row added |
|-------|-----------|
| `POST /invitations/validate` | `PLAT-AUTH-079`, `080` |
| `POST /invite-links/validate` | `PLAT-AUTH-081` |
| `POST /invite-links/request` | `PLAT-AUTH-082`, `083` |
| `GET /invite-links/owner-pending` | `PLAT-AUTH-084` |
| `GET /invite-links/my-requests` | `PLAT-AUTH-085` |
| `GET /users/me/sessions` | `PLAT-AUTH-086` |
| `DELETE /users/me/sessions/:sessionId` | `PLAT-AUTH-087` |
| `DELETE /users/me/sessions` | `PLAT-AUTH-088` |
| `GET /users/:id` | `PLAT-AUTH-089` |
| `/shared-user/*` alias of `/auth/platform/*` | `PLAT-AUTH-090` |
| `POST /auth/test` (dev token minter) | `PLAT-AUTH-091` — prod security negative |
| `GET /users/me/onboarding` | `PLAT-ONB-023` |
| `POST /users/me/onboarding/:step` | `PLAT-ONB-024`, `025` |
| `POST /households/:id/photo/upload-url` | `PLAT-HH-039` |
| `POST /subscriptions/reactivate` | `PLAT-SUB-015` |
| `POST /subscriptions/resume` | `PLAT-SUB-016` |
| `GET /ai-access` · `GET /ai-models` · `PATCH /ai-preferences` | `PLAT-AIACC-017`, `028`, `029`, `040` |
| `GET /notifications/overrides` | `PLAT-NOTIF-026` |
| `POST /notifications/overrides` | `PLAT-NOTIF-027` |
| `GET /notifications/overrides/:id` | `PLAT-NOTIF-028` |
| `PATCH /notifications/overrides/:id` | `PLAT-NOTIF-029` |
| `DELETE /notifications/overrides/:id` | `PLAT-NOTIF-030` |
| `GET /api/settings` | `PLAT-SETT-033` |
| `PUT /api/settings/:key` | `PLAT-SETT-034` |
| `PUT /api/settings/bulk` | `PLAT-SETT-035` |
| `DELETE /api/settings/:key` | `PLAT-SETT-036` |
| `POST /api/settings/sync` | `PLAT-SETT-037` |
| `POST /api/settings/reset` | `PLAT-SETT-038` |
| `GET /companion/v1/tasks` | `PLAT-WIDGET-009`, `011`, `012` |
| `GET /companion/v1/home-insight` | `PLAT-WIDGET-010` |

### A3. UI controls with no matrix row

| Control (file) | Row added |
|----------------|-----------|
| Push-permission banner + `handleEnablePush` / `handleDismissBanner` (`src/screens/notifications/NotificationsScreen.tsx`) | `PLAT-NOTIF-023`…`025` |
| Avatar pick / crop / upload / remove, incl. `E_PICKER_CANCELLED` path (`src/screens/main/ProfileScreen.tsx`) | `PLAT-SETT-041`…`044` |
| `testID=profile-display-name-input` validation | `PLAT-SETT-045`, `046` |
| `CalendarSyncScreen` | `PLAT-SETT-039` |
| `TabCustomizationScreen` | `PLAT-SETT-040` |
| `PropertyDetailScreen` | `PLAT-HH-046` |
| Profile → AI access entry (`router.push('/ai-access')`) | `PLAT-AIACC-041` |
| `subscriptionsEnabled` feature-flag deferred state | `PLAT-SUB-017` |

---

## B. Depth gaps — rows present but not executable / missing mandatory families

Per COVERAGE_CONTRACT §3, every screen needs LOAD · SCROLL · VISIBLE · INTERACT · MUTATION · CANCEL · VALIDATION · ERROR · CORNER.

| Screen / area | Families that were absent | Backfilled by |
|---------------|---------------------------|---------------|
| AI access hub (all 6 screens) | *all nine* — the surface had no per-screen rows at all | `PLAT-AIACC-017`…`043` |
| Paywall | CANCEL, ERROR, CORNER, VALIDATION | `PLAT-SUB-017`…`023` |
| Notifications inbox | CANCEL (clear-all confirm), ERROR (delete/mark-all failure), VISIBLE (push banner) | `PLAT-NOTIF-023`…`025`, `031`…`034` |
| Profile | VALIDATION, ERROR, CANCEL (avatar picker dismiss) | `PLAT-SETT-041`…`046` |
| Households create/edit | VALIDATION, ERROR, SCROLL, CORNER (privilege escalation) | `PLAT-HH-043`…`047` |
| Onboarding funnel | CANCEL, VALIDATION, SCROLL, CORNER (resume / already-onboarded) | `PLAT-ONB-026`…`029` |
| Soft Transfer | VALIDATION, CANCEL, SCROLL, CORNER (idempotent replay, revoke-then-export) | `PLAT-ST-025`…`030` |
| Companion / widget | CORNER security negatives (token class, scope, revocation) | `PLAT-WIDGET-011`…`013` |
| Analytics | CORNER (missing-key gate, single-integration-point guard) | `PLAT-ANALYTICS-007`, `008` |

**Terseness:** the pre-existing rows overwhelmingly used one-clause Steps (`1. Tap submit`) and Expected values that stated a UI outcome with no data outcome (`Error banner; stay on login`). All **106 new rows** are written to the Circle V2 bar — numbered multi-step repro naming the exact control (testID or visible label), and an Expected that asserts **both** the UI result and the persistence/data result (list refresh, re-read value, unchanged count, absence of a network call). Pre-existing rows were left at their published wording except where an integrity fix touched the cell; deepening the remaining ~272 legacy rows is the recommended next pass.

---

## C. Integrity gaps

### C1. Wrong BE / persistence paths — 13 rows

These cited endpoints that **do not exist** at the stated path. Verified against `app.route(...)` mounts in `backend/src/index.ts` and the handler definitions in each route file.

| Rows | Matrix said | Actual (verified) |
|------|-------------|-------------------|
| `PLAT-AUTH-060` | `GET /platform/me` | `GET /auth/platform/me` (mount line 204; also aliased `/shared-user`) |
| `PLAT-AUTH-061`, `PLAT-WIDGET-006` | `POST /platform/companion` | `POST /auth/platform/companion` |
| `PLAT-AUTH-062` | `POST /platform/revoke-session` | `POST /auth/platform/revoke-session` |
| `PLAT-AUTH-071` | `POST /platform/deletion` | `POST /auth/platform/deletion` |
| `PLAT-AUTH-072` | `POST /platform/deletion-status` | `POST /auth/platform/deletion-status` |
| `PLAT-AIACC-004` | `GET /users/ai-credentials` | `GET /ai-credentials` — `aiCredentialsRoutes` is mounted at `/` (line 333), not under `/users` |
| `PLAT-AIACC-005` | `POST /users/ai-credentials/:provider` | `POST /ai-credentials/:provider` |
| `PLAT-AIACC-006` | `POST /users/ai-credentials/:provider/validate` | `POST /ai-credentials/:provider/validate` |
| `PLAT-AIACC-007` | `DELETE /users/ai-credentials/:provider` | `DELETE /ai-credentials/:provider` |
| `PLAT-SETT-022` | `PATCH /users/settings` or sync service | `PUT /api/settings/:key` — settings router is mounted at `/api/settings` (line 352); confirmed by `src/api/settings.ts` |

All Console-verify cells for the above were corrected in step with the path.

### C2. Bogus `Automation` citations — 18 rows

Contract §2 requires **a repo path or `gap`**. These cited a source module, a testID, or another matrix row. All were replaced with a real test path, an explicit "route only, no test — `gap`" annotation, or plain `gap`.

| Row | Cited | Verdict |
|-----|-------|---------|
| `PLAT-AUTH-032` | `AcceptInviteScreen` logic | source file, no test → `gap` |
| `PLAT-AUTH-048`, `PLAT-ONB-016`, `PLAT-ONB-017` | `ChildWelcomeScreen` | source file, no test → `gap` |
| `PLAT-AUTH-066`, `070`, `075` | `LoginScreen` (redirect params / layout) | source file, no test → `gap` |
| `PLAT-AUTH-053` | `api/client.ts` interceptor | source file → replaced with `src/stores/__tests__/authStore.data-bridge.test.ts` |
| `PLAT-AUTH-055` | `api/client.ts` | source file → `gap` |
| `PLAT-HH-033`, `PLAT-SETT-030` | `householdStore` / `householdStore` tests | **no such test file exists** → `gap` |
| `PLAT-AIACC-003` | `useAIAccessErrorNavigation` | hook source, no test → `gap` |
| `PLAT-AIACC-014` | `useRequireAIAccess` | hook source, no test → `gap` |
| `PLAT-AIACC-016` | `backend-language/platformAiAccess.ts` | **wrong path** — real file is `backend-language/src/routes/platformAiAccess.ts`; route only, no test → `gap` |
| `PLAT-NOTIF-014` | `settings-row-notification-settings` | a **testID**, not a path → replaced with the real test path |
| `PLAT-NOTIF-021` | `PLAT-HH-029` | a **matrix row reference**, not a path → `gap` + cross-ref note |
| `PLAT-SETT-007`, `PLAT-SETT-029` | `settingsNavigationStore` | store source, no test → `gap` |
| `PLAT-SETT-023` | `settingsStore` | store source, no test → `gap` |
| `PLAT-SUB-010` | "indirect via feature gates" | prose, not a path → `gap` |
| `PLAT-WIDGET-005` | `watch-sync.ts` | service source, no test → `gap` |
| `PLAT-WIDGET-008` | `HEALTH-WIDGET-*` | a **matrix row glob** → `gap` + cross-ref to `health.md` |
| `PLAT-ANALYTICS-001`, `003`, `004` | `analytics.ts` | service source, no test → `gap` |

### C3. Basename-only citations normalised

~40 rows cited test files by basename only (`LoginScreen.data-bridge.test.tsx`, `soft-transfer.test.ts`, `settings-screen.yaml`, …). Each was resolved to its unique full repo path. Ambiguous Maestro basenames existing under both `e2e/maestro/auth/` and `e2e/maestro/kaizen/` (`login-screen-controls.yaml`, `biometric-*.yaml`) were pinned to the `auth/` copies, since the AUTH section is House/platform-scoped.

**All 42 test files cited by the original matrix were confirmed to exist.** The integrity problem was never phantom tests — it was source modules and identifiers being passed off as automation coverage, which overstated how much of the platform is actually automated.

---

## D. Top 5 most serious findings

1. **The entire BYOK AI-access hub was untested and unlisted.** Six shipped screens (`app/ai-access/**`) implementing the platform's *only* working AI entitlement path — connect key, pick model, activate, re-validate, disconnect — had zero rows. This is the highest-risk surface in the matrix because it handles user API-key material.
2. **`/platform/*` does not exist.** Six rows (`PLAT-AUTH-060`/`061`/`062`/`071`/`072`, `PLAT-WIDGET-006`) targeted paths the Worker never serves; the real mount is `/auth/platform/*` (aliased `/shared-user/*`). Anyone executing these rows would have recorded a 404 as an app defect.
3. **`/users/ai-credentials` does not exist either** — the router mounts at `/`, so all four credential rows (`PLAT-AIACC-004`…`007`) pointed at the wrong path. Same false-failure risk.
4. **18 rows claimed automation coverage they do not have**, citing source modules, a testID, and even other matrix row IDs in the `Automation` column. Real automated coverage of the platform scope is materially lower than the file implied.
5. **Subscriptions are gated off in shipping builds** (`subscriptionsEnabled` feature flag → "Apple subscriptions are not configured in this build yet"), yet 4 SUB rows described a live purchase flow as though it were testable. Those are now explicitly `deferred`, with the real entitlement path (BYOK) covered instead.

---

## E. Recommended next passes

1. **Deepen the ~272 legacy rows** to the same Steps/Expected density as the new ones (one-clause Steps and UI-only Expected values remain throughout AUTH-001…078, HH-001…038, SETT-001…032).
2. **Add testIDs** to `app/ai-access/**`, the household create/invite forms, and the profile AI row — without them, 43 AIACC rows and most HH mutations can never leave the Unit/API layer.
3. **Provision a second staging account** (or an API fixture seeder). Roughly 20 rows across invites, join requests, session revocation and Soft Transfer are unexecutable until one exists.
4. **Fix the malformed section→tag table in `health.md`** (stray row-schema header at line 86).

---

# 2026-07-18 depth pass

Follow-on to §E.1 above. Scope: bring the ~272 pre-existing rows to the Circle V2 bar, and verify every bulk-linked Maestro citation against the flow it names.

## A. Rows deepened

**272 legacy rows rewritten** (Steps + Expected), covering every section: `PLAT-SMOKE-001`…`006`, `PLAT-SCROLL-001`…`006`, `PLAT-AUTH-001`…`078`, `PLAT-ONB-001`…`022`, `PLAT-HH-001`…`038`, `PLAT-SUB-001`…`014`, `PLAT-AIACC-001`…`016`, `PLAT-NOTIF-001`…`022`, `PLAT-SETT-001`…`032`, `PLAT-ST-001`…`024`, `PLAT-WIDGET-001`…`008`, `PLAT-ANALYTICS-001`…`006`.

What changed per row:

- **Steps** — numbered, multi-step where the journey has steps, naming the exact control by testID or exact visible label **read from source**, not invented. testIDs were harvested from `src/screens/auth/LoginScreen.tsx`, `RegisterScreen.tsx`, `ForgotPasswordScreen.tsx`, `AcceptInviteScreen.tsx`, `src/screens/main/SettingsScreen.tsx`, `ProfileScreen.tsx`, `src/screens/notifications/NotificationsScreen.tsx`, `src/screens/households/*.tsx`, and `app/ai-access/**` + `src/components/ai/AIFlowScaffold.tsx`.
- **Expected** — now states the UI outcome **and** the data outcome: which store key is written, which field the server holds afterwards, which list refreshes, and — for CANCEL/VALIDATION rows — that the call is explicitly **absent** from the network log.

No row ID, Description, or criterion was changed. Template remains blank (no Pass/Fail columns). All 378 rows verified to hold exactly 10 columns with no empty cells; the ID sequence is byte-identical to the committed version.

### Factual corrections made while deepening

| Row(s) | Was | Is |
|--------|-----|-----|
| `PLAT-AUTH-015`, `016` | "tokens in MMKV" / "MMKV auth keys" | Product tokens live in **SecureStore** under `{brand.id}.{staging\|production}.1.access` / `.refresh` (`src/services/secure-token-storage.ts`); MMKV/AsyncStorage holds only the `auth-storage` user envelope |
| `PLAT-AUTH-039`, `044`, `045`, `074` | "SecureStore creds" / "MMKV settings store" | Brand-scoped `{brand}.{env}.1.biometric.enabled` / `.credentials` / `.email` (`src/services/biometric/index.ts`), mirrored to the `auth.biometricEnabled` setting |
| `PLAT-AUTH-049` | "tokens cleared" | SecureStore access/refresh/companion + biometric keys deleted **and** the enumerated domain stores (`household-storage`, `project-storage`, …) purged |
| `PLAT-AIACC-011` | "Provider rows render", BE `GET /ai-credentials` | `AihousekeeperConnectedAccountsScreen` is the **Google Calendar** connected-accounts screen (`oauthGoogleApi`), not the BYOK provider list — see Flagged #18 |
| `PLAT-SETT-004`, `023` | "MMKV settings store" | `settings-storage` persisted Zustand store |

## B. Maestro citations downgraded to `gap`

**155 rows** ended the pass at `gap` with a recorded reason: 130 from the section-level bulk-link sweep below, plus 25 caught in a first review sweep. Two further rows (`PLAT-AUTH-012`, `PLAT-AUTH-023`) were *partially* downgraded — the false Maestro citation was stripped and the genuine Unit test kept. Every row citing one of the section-level bulk-linked flows was checked by opening the flow YAML and reading its assertions.

A **second, broader** run of `scripts/e2e/bulk-link-fleet-maestro.py` had occurred beyond the one described in the task: it overwrote honest `gap` markers on rows whose Layer is `API`, `Unit` or `Live` — rows with no UI at all. `PLAT-AUTH-087` (revoke a session by id), `PLAT-HH-047` (privilege-escalation negative), `PLAT-SUB-020` (external App Store link) and `PLAT-AUTH-091` (`/auth/test` unreachable in production) were all pointed at `login-screen-controls.yaml` / `household-management.yaml` / `settings-screen.yaml`.

**Downgraded (130):**

- **AUTH (37):** `025`, `026`, `027`, `028`, `029`, `030`, `031`, `032`, `034`, `036`, `038`, `046`, `047`, `048`, `052`, `055`, `063`, `064`, `066`, `070`, `071`, `072`, `073`, `075`, `079`…`089`, `091`, `092`
- **ONB (7):** `005`, `016`, `017`, `021`, `023`, `024`, `025`
- **HH (34):** `004`, `007`…`013`, `015`…`030`, `033`, `034`, `036`, `038`…`044`, `047`
- **SUB (16):** `002`, `003`, `005`, `006`, `007`, `009`, `013`, `015`…`023`
- **NOTIF (11):** `003`, `006`, `022`, `024`, `026`…`030`, `032`, `033`
- **SETT (18):** `007`, `008`, `020`, `021`, `023`, `024`, `029`, `030`, `032`, `039`, `040`, `042`…`047`
- **WIDGET (7):** `001`, `003`, `004`, `007`, `009`, `010`, `013`

Additionally downgraded during the first review sweep (rows that *were* `Layer: Maestro` but whose criterion the cited flow does not exercise): `PLAT-SCROLL-004`, `PLAT-SCROLL-005`, `PLAT-AUTH-009`, `PLAT-AUTH-010`, `PLAT-AUTH-012` (Maestro half), `PLAT-AUTH-019`, `PLAT-AUTH-023` (Maestro half), `PLAT-AUTH-024`, `PLAT-AUTH-069`, `PLAT-HH-006`, `PLAT-NOTIF-002`, `PLAT-NOTIF-004`, `PLAT-NOTIF-007`, `PLAT-SETT-005`, `PLAT-SETT-009`, `PLAT-SETT-010`, `PLAT-SETT-011`, `PLAT-SETT-013`, `PLAT-SETT-014`, `PLAT-SETT-015`, `PLAT-SETT-017`, `PLAT-SETT-018`, `PLAT-SUB-004`, `PLAT-AIACC-010`, `PLAT-ST-002`, `PLAT-ST-017`, `PLAT-ST-018`.

**Re-cited (1):** `PLAT-SETT-019` (sign-out row visible) moved from `profile/profile-screen.yaml` — which never scrolls that far — to `profile/profile-destructive-actions.yaml`, which does `scrollUntilVisible: profile-sign-out`.

### Citations verified as TRUE and kept (27)

`login-screen-controls.yaml` → `PLAT-SMOKE-005`, `PLAT-AUTH-001`…`008` (the flow asserts `auth-sign-in-email`, taps it, then `auth-email-input`, `auth-password-input`, `auth-sign-in-submit`, "Sign Up", "Forgot Password?").
`register-screen-controls.yaml` → `PLAT-AUTH-008` (nav half), `017`, `018`.
`household-management.yaml` → `PLAT-SCROLL-006`, `PLAT-HH-001`, `002`, `005` (`005` marked partial — the flow taps `household-add-property` inside a `when: visible` block and asserts nothing afterwards).
`notifications-screen.yaml` → `PLAT-SMOKE-003`, `PLAT-SCROLL-002`, `PLAT-NOTIF-001`, `020`.
`settings-screen.yaml` → `PLAT-SMOKE-002`, `PLAT-SCROLL-001`, `PLAT-SETT-001`, `002`, `012`, `031`.
`welcome.yaml` → `PLAT-ONB-001`, `002`.

Row-targeted flows under `e2e/maestro/platform/` (`ai-access-profile-entry`, `ai-access-scroll`, `profile-avatar-upload`, `auth-accept-invite`, `subscription-pro-tier`, `notifications-push-banner`, `household-members`, `property-detail`) carry a `# Matrix: PLAT-…` header and were confirmed to exercise the rows they name — those citations were left alone. `src/services/__tests__/analytics.test.ts` names its rows in the `it()` titles (`PLAT-ANALYTICS-001/007` etc.) and is likewise genuine.

All Automation citations in the file still resolve to a real path on disk or `gap`. Gap count: 155 rows. For reference the committed version had 157 gaps; the two linker runs cut that to 25 by asserting coverage that does not exist.

## C. Controls found with no testID (blocks Maestro)

| Surface | Missing | Blocks |
|---------|---------|--------|
| `RegisterScreen` | name / email / password / confirm inputs are placeholder-only (`auth-register-back`, `auth-register-submit`, `auth-sign-up-google` do exist) | `PLAT-AUTH-020`…`023`, `069` |
| `CreateHouseholdScreen` (onboarding) | **zero** testIDs — Home Name / City / Postal and the Create Home button; `onboarding/create-household.yaml` documents this in-flow and types positionally | `PLAT-ONB-003`…`005`, `020` |
| `SpaceSetupScreen`, `GarbageSetupScreen`, `JoinHouseholdScreen` | no testIDs; text-only cards and Skip/Continue buttons | `PLAT-ONB-006`…`009`, `014` |
| Household create / edit / invite forms + role picker | no testIDs past `household-add-property` | `PLAT-HH-006`, `008`, `015`, `022`, `043` |
| Notification list rows | no testID and data-dependent text (`notifications-actions.yaml` states this) | `PLAT-NOTIF-004`, `006`, `008`, `009` |
| `app/ai-access/**` interior controls | provider rows, model rows, Activate / Re-validate / Disconnect / Edit-key | `PLAT-AIACC-021`, `028`…`039` |
| Sessions UI | screen does not exist at all | `PLAT-AUTH-086`…`088` |

**Corrections to earlier Flagged entries:** `ForgotPasswordScreen` **does** have testIDs (`auth-forgot-email-input`, `auth-forgot-submit`) and `LoginScreen` exposes `auth-forgot-password` and `auth-password-toggle` — Flagged #5 was wrong. The AI-access hub **does** have scaffold-level testIDs (`ai-access-screen`, `ai-access-manage-screen`, `ai-flow-scaffold-scroll-end`) — Flagged #3 was overstated. Both entries were corrected in `platform.md`.

## D. Top 5 findings

1. **The bulk linker fabricated coverage on 130 rows, most of them API-only.** Pointing `PLAT-AUTH-087` (session revoke) at a login-screen YAML does not just misinform — it converts an honest, visible gap into apparent coverage. This is the single most damaging integrity problem in the file and it recurred *during* this pass, so Flagged #19 now names the script and forbids re-running it here.
2. **The AUTH section documented the wrong token store.** Rows said tokens land in MMKV; `secure-token-storage.ts` puts them in SecureStore under a brand+env+authority-version prefix, and `authStore` explicitly keeps product tokens out of Zustand persist. A tester following the old Expected would have looked in the wrong place to verify a login.
3. **`PLAT-AIACC-011` tested the wrong screen.** It asserted BYOK provider rows and `GET /ai-credentials` against a screen that actually drives Google Calendar OAuth. The row would have failed for a reason unrelated to its criterion.
4. **`settings-screen.yaml` covers 6 of the 18 settings rows the matrix asserts.** It walks household-members / floor-plans / garden / appearance only. Customization, notification-settings, calendar-sync, spaces, AI-housekeeper, AI-insights, persona, AI-providers, connect-Budget and both Language/Health Soft-Transfer rows have *no* Maestro coverage despite each having a stable testID in `SettingsScreen.tsx` — this is the cheapest, highest-yield flow to extend.
5. **Two profile rows were covered by a flow that deliberately refuses to complete them.** `profile-destructive-actions.yaml` edits the display name only to prove the **Save** affordance appears, then stops, to avoid mutating the shared account. `PLAT-SETT-017` (save persists) and `PLAT-SETT-018` (cancel discards) are therefore unautomated until a throwaway account exists — the same second-account blocker as Flagged #1.
