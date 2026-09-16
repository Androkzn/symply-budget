# Symply Health V2 local-first — two-device sync E2E (He12(partial))

**Scope:** Symply Health (`com.symply.health`) V2 local-first **personal**
household sync, driven as **one user on two real simulators**.
**Runner:** [`scripts/e2e/run-health-two-device-sync-live-report.sh`](../../../scripts/e2e/run-health-two-device-sync-live-report.sh)
**Flows:** `e2e/maestro/health-two-device/td-*.yaml`, plus the existing
`e2e/maestro/health/privacy-cross-user-leak.yaml`
**Stage:** He12(partial) — see
[health-local-first-implementation-plan.md](../../requirements/Health%20v2/health-local-first-implementation-plan.md)
§0 (DoD) and §14 (deployment order).
**Ported from:** [BUDGET_MULTI_MEMBER_SYNC_E2E.md](./BUDGET_MULTI_MEMBER_SYNC_E2E.md)

> **⚠️ NOT YET RUN.** These flows and this runner were authored against the He3
> cutover landing in parallel. Until He3 merges, Health's screens still read and
> write D1 — `src/api/health.ts` has no Proxy and `local*Api` does not exist — so
> a run would exercise the remote path and prove nothing about the ledger.
> Everything here is syntax-checked (`maestro check-syntax`, `bash -n`) and
> unexecuted. See §9.

---

## 1. The one thing that is different from Budget

Budget's multi-member suite is **two different people**: an owner and an invitee,
two Symply accounts, one shared household ledger. Its runner refuses to start if
`E2E_EMAIL` and `E2E_EMAIL_SECONDARY` are the same account.

Health is the opposite, and it is a product decision, not a shortcut:

> A Health household is **one user with N devices** (plan §1.2). He5 mints a
> single personal household and **refuses a second member `user_id`** outright.
> The second device enrols over `simplehealth://lf-invite`, and every string in
> the flow is about a **device**, never a person.

So this runner **refuses to start if `E2E_EMAIL_SECONDARY` is set to a different
account**, and both simulators sign in with the same `E2E_LOGIN_URL`.

Three concrete consequences, each of which shaped a flow:

| Budget | Health |
|---|---|
| Owner + invitee, symmetric parallel phases (A works in Spending while B works in Planning, each polling for the other) | One user's two devices cannot each own half of the data — phases are a **sequential A-writes → B-observes handoff** |
| "Invite a member", "Join household" is correct copy | Any such string is a **defect** — [`td-40`](#6-flow--dod-map) asserts its absence app-wide |
| Push wake means "everyone except me", and `excludeUserId` works | `excludeUserId` matches **zero rows** in a one-user household, so the wake is silently never sent — the §2 item 4c defect that phase 5 exists for |
| Every table uses random ids | Two Health tables (`habit_logs`, `health_goals`) use **deterministic** ids, so a delete and its replacement collide on one key — [`td-17`](#6-flow--dod-map) is written around that |

---

## 2. Topology and devices

| | Device | Simulator | Account | Role |
|---|---|---|---|---|
| A | A | `Health-A` | `E2E_EMAIL` | the device that mints the enrolment code |
| B | B | `Health-B` | **the same** `E2E_EMAIL` | the device that scans it |

**Device names come from the registry, never from the runner.**
[`scripts/e2e/maestro-fleet-brand.sh`](../../../scripts/e2e/maestro-fleet-brand.sh)
already carries the pair under brand `health`:

```sh
maestro_fleet_brand_field health device     # Health-A
maestro_fleet_brand_field health device_b   # Health-B
```

Override per run with `E2E_DEVICE_A` / `E2E_DEVICE_B` (or `E2E_DEVICE` for A
alone). A missing device is **created**, not reported — `maestro_fleet_ensure_iphone_sim`
picks an iPhone device type and the newest installed iOS runtime — so the
registry and the machine cannot drift into a confusing "device not found".

**One pair per app.** Per the global device policy this is Symply Health's only
pair, shared with `run-health-suite.sh`. The accepted consequence: **no other
Health suite may run while this one is in flight**, in this or any other clone of
the repo. Run a different app in parallel instead.

Before boot, each device is size-guarded by
[`sim-disk-guard.sh`](../../../scripts/e2e/sim-disk-guard.sh) (`sim_guard_pair`)
— erased only above the ~800 MB cap, never while `maestro test` /
`maestro-driver-ios` is running, and never while booted.

---

## 3. What the runner gates before it runs anything

Three checks, all of them DoD lines rather than conveniences. Each fails the run
loudly with the fix printed.

### 3.1 Worker Version ID vs the client's `backend/src` commit (plan §14 step 13)

> "…against a Worker whose Version ID is built from the **same `backend/src`
> commit as the client binary under test, and postdates it**."

That is **two** claims, so the runner makes two comparisons:

| | Where the number comes from |
|---|---|
| **client commit** | `git log -1 --format=%H -- backend/src` — the newest commit reachable from HEAD that touches `backend/src`. The binary under test is built from this checkout, so that is the backend it was compiled against. Override: `HEALTH_CLIENT_BACKEND_COMMIT`. |
| **worker version** | `npx wrangler versions list -c wrangler.health.toml --env <env> --json`, newest by `metadata.created_on`. Override: `HEALTH_WORKER_VERSION_ID` / `HEALTH_WORKER_VERSION_CREATED_ON` / `HEALTH_WORKER_SRC_COMMIT`. |

Then:

0. **`backend/src` must be clean.** Uncommitted backend changes mean the deployed
   Worker cannot be the same code as the client, whatever the ids say.
1. **Same commit.** The version must record its source commit — either in an
   annotation (`workers/tag` / `workers/message` containing a 7–40 char sha) or
   via `HEALTH_WORKER_SRC_COMMIT`. The runner matches by prefix in either
   direction so a short sha is fine.
2. **Postdates.** `Date.parse(created_on)` must be **strictly greater** than the
   commit's committer date.

**If the source commit is not recorded anywhere, the gate FAILS.** It deliberately
does not fall back to the timestamp alone: *"the Worker is newer"* and *"the
Worker is the same code"* are different claims, and only the second one keeps a
two-device run meaningful.

Two supported ways to satisfy it:

```sh
# a) record the commit on the version at deploy time (from the main checkout)
cd backend && npx wrangler deploy -c wrangler.health.toml --env staging \
  --message "$(git rev-parse HEAD)"

# b) or record §14 step 5's Version ID in a local file the runner sources
cat > e2e/health-worker-version.local <<'EOF'
HEALTH_WORKER_VERSION_ID=...
HEALTH_WORKER_VERSION_CREATED_ON=2026-08-14T09:12:33.000Z
HEALTH_WORKER_SRC_COMMIT=...
EOF
```

`HEALTH_VERSION_GATE=warn` downgrades the gate to a banner and writes a `SKIP`
verdict into the report — **a run with that set cannot certify He12(partial)**,
and the report says so.

### 3.2 Brand default asserted **off**

`isHealthLocalFirst()` ([`src/features/health/local/flag.ts`](../../../src/features/health/local/flag.ts))
brand-defaults local-first **on** for `symply-health` when
`EXPO_PUBLIC_HEALTH_LOCAL_FIRST` is unset. Until He12 (full) that default must
never reach a real build — a Health binary without an explicit `=0` opens a
ledger nothing writes to while its screens still hit D1.

The runner resolves every `eas.json` build profile (following `extends`, because
`symply-health-testflight` carries no `env` of its own), selects the ones whose
`APP_BRAND` is `symply-health`, and requires
`EXPO_PUBLIC_HEALTH_LOCAL_FIRST === "0"` on each. Offenders are named and the run
stops. `eas.json` is owned by another agent — the gate **reports**, it never
edits. `HEALTH_BRAND_DEFAULT_GATE=warn` downgrades it.

### 3.3 The lab flag actually reached the bundle

This suite runs its own Metro started with `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1`
(internal/lab only — plan §14 step 7; the plan forbids brand-default-on before
He12 (full)). `EXPO_PUBLIC_*` is inlined by Babel at bundle time, so the runner
fetches the served bundle once and fails if a literal
`process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST` survives in it — which is exactly
what an env that never reached the inline plugin looks like, and would otherwise
silently fall through to the brand default.

**Known limit, stated plainly:** §3.2 proves the *shipped* default is off and
§3.3 proves the *lab* flag is on. Neither can read a flag out of a running
binary. If a future build embeds its flag state in an on-screen diagnostic, add
an assertion for it and delete this paragraph.

---

## 4. What the harness fakes — and what it does not

**The enrolment payload.** In life a person holds two phones and scans a QR. Here
device A mints the code through the real "Add your other device" button, the
runner scrapes the dev-only `[E2E-INVITE] code=… secret=… oob=…` line off the
Metro log, and device B **opens the real `simplehealth://lf-invite?…` deep link**
— which is what a camera scan does, minus the camera. The approval phrase travels
the same way and is tapped by its real label; a wrong phrase is rejected by the
Worker.

`td-03` asserts the link's scheme before opening it. That is deliberate: the
shared Worker returns a **Budget** scheme in the enrolment payload today
(`local-first-v2.ts:506`, plan §2 item 5 / §6). If that regresses, the Health app
never sees the link at all and the failure must land in `td-03` rather than three
steps downstream. **Do not "fix" a failure there by making the runner rewrite the
scheme.**

**The push wake.** A simulator has no APNs connection, so the Worker's push cannot
arrive on `Health-B` by itself. Phase 5 therefore proves the bullet in three
legs, none of which is a proof alone — see §6, `td-32` / `td-33`.

**Everything else is a real touch on a real device.** Rows are entered through
the real forms, deletes go through the real confirmation alerts, and the Weight
tab's `LOG A WEIGHT` gate is normalised the same bounded-delete way
`weight-tab-log-and-edit.yaml` does.

### The sync nudge, and why it is not a button

Budget's flows push a pending op with a deep link (`{scheme}://e2e-budget-sync`,
`subflows/budget-sync-pulse.yaml`) — they used to tap `budget-sync-status`, a
dashboard strip removed 2026-08-16. **Health has no
sync affordance at all** — grepped 2026-08-14, there is no `health-sync-status`,
no `lf-sync-now`, nothing; the only `*sync*` testIDs in the brand are HealthKit
import progress, a different subsystem, and House's `lf-sync-card` component is
not imported by any Health screen.

So [`td-sync-nudge.yaml`](../../../e2e/maestro/health-two-device/td-sync-nudge.yaml)
performs a real **background → foreground cycle** instead. That is the lifecycle
edge convergence actually hangs off (`ensureHealthLocalSession` re-opens and
pulls on foreground; a wake is delivered on the same transition), and it is what
a person does between two devices. Inventing a tap on an id that does not exist
would have made every poll loop a silent no-op that still passed.

**When He3 lands a sync affordance, add the tap to that one file.** Every poll
loop in the suite calls it.

---

## 5. Sequence

`→` marks the sequential A-writes-then-B-observes handoff.

```
phase 1 — enrolment (ordered; nothing can approve a claim that does not exist)
  A  td-01-signin                     same account, device A     (serial: driver warm-up)
  B  td-01-signin                     same account, device B     (serial: driver warm-up)
  A  td-02-device-a-add-other-device  More → Add your other device → create
     ↓ runner scrapes code/secret/oob/household off the Metro log
  B  td-03-device-b-join              opens simplehealth://lf-invite?…
  A  td-04-device-a-approve           taps the OOB phrase
  B  td-05-device-b-enrol-sync        syncs until the household key lands

phase 2 — the 8 Wave A tables, create / modify / delete / converge
  td-10 weight      → create → modify → delete      (marker: the entry NOTE)
  td-11 water       → create → modify → delete      (marker: the ml volume)
  td-12 nutrition   → create → modify → delete      (marker: the meal NAME)
  td-13 activity    → create → modify → delete      (marker: the DURATION)
  td-14 sleep       → create → modify               (same table; no delete verb exists)
  td-15 body        → create → modify → delete      (marker: the waist VALUE)
  td-16 habits      → create → modify → delete      (marker: the habit NAME)
  td-17 habit logs  → tick → untick → RE-TICK       (deterministic id — see below)
  td-18 goals       → create → modify → delete      (deterministic id)

phase 3 — tombstone propagation, ordered so the last step cannot pass vacuously
  A  td-30 seed      logs a reading carrying the marker
  B  td-30 witness   MUST render it   ← fatal if it fails; `kill` never runs
  A  td-30 kill      deletes it
  B  td-30 verify    MUST stop rendering it

phase 4 — airplane-mode → reconnect catch-up
  B  td-31 b-offline     blocks the network, asserts the marker is absent
  A  td-31 a-write       adds a habit while B is dark
  B  td-31 b-reconnect   asserts STILL absent, unblocks, polls until it lands

phase 5 — push wake A→B in the one-user household
  B  td-32 arm           grants notifications, parks the app in the background
  A  td-31 a-write       deposits an op
     runner              greps the Metro log for B's /v2/push/register and for a
                         health_sync_wake issued AFTER the deposit
     runner              xcrun simctl push — the real { type, householdId } payload
  B  td-33 verify        the wake was CONSUMED (no empty notification) and B converged

phase 6 — td-40-no-invite-partner-copy on device A (13 screens)

cleanup  — td-99 on both devices, GREEN RUNS ONLY

phase 7 — privacy-cross-user-leak.yaml on device A, ALWAYS LAST
           (it signs out and relaunches with clearState + clearKeychain, which
            destroys the device's local session and DEK)
```

**Why `td-17`'s order is `tick → untick → re-tick`.** `habit_logs` is one of only
two Health tables with a **deterministic** id (`unique(habit_id, date)`;
`health_goals` is the other, on `unique(user_id, effective_date)` — see
[`schema.ts`](../../../src/features/health/local/schema.ts)). The re-tick
recreates the row under **the same id the tombstone carries**. If the delete op's
clock is not beaten by the re-tick, the resurrected row stays invisible on the
peer forever while looking perfectly correct on the device that ticked it. Budget
has no equivalent case — every Budget table uses random ids — so this is the one
place the ported suite had to grow a new idea rather than a translation.

**Why `td-30` exists when `td-10` already deletes a weight row.** `td-10`'s
delete phase asserts "the marker is not visible on B", which passes for two
completely different reasons: the tombstone travelled, or the row never reached B
at all. A projection that silently dropped every remote op would sail through it.
`td-30` forces B to **hold** the row first, and the runner treats a `witness`
failure as fatal.

---

## 6. Flow → DoD map

Every bullet of the He12(partial) DoD, and the file that owns it.

| DoD bullet | Flow(s) | Notes |
|---|---|---|
| Ported Budget MM suite green — **same user**, two devices | whole suite; `td-01-signin.yaml` runs on both devices with one `E2E_LOGIN_URL`; the runner rejects a secondary account | §1 |
| Worker Version ID = same `backend/src` commit as the client, and postdates it | **runner gate**, `run-health-two-device-sync-live-report.sh` | §3.1 — implemented as two comparisons, not a printout |
| Wave A table 1/8 `weightEntries` c/m/d/converge | `td-10-weight-sync.yaml` | marker is `health-weight-entry-note`; random-id table |
| Wave A table 2/8 `waterEntries` c/m/d/converge | `td-11-water-sync.yaml` | **no per-entry edit exists** — modify logs a second distinct volume; see §7 |
| Wave A table 3/8 `nutritionEntries` c/m/d/converge | `td-12-nutrition-sync.yaml` | inline manual composer, LUNCH slot |
| Wave A table 4/8 `healthEntries` — **activity** | `td-13-activity-sync.yaml` | the only half with edit + delete affordances |
| Wave A table 4/8 `healthEntries` — **sleep** | `td-14-sleep-sync.yaml` | **no edit/delete verb exists**; modify is the same-date LWW overwrite |
| Wave A table 5/8 `bodyMeasurements` c/m/d/converge | `td-15-body-sync.yaml` | **no edit exists** — modify re-logs the same metric on the same day, which replaces the day row |
| Wave A table 6/8 `userHabits` c/m/d/converge | `td-16-habits-sync.yaml` | addressed by the `Open <name>` a11y label — row ids are server-minted |
| Wave A table 7/8 `habitLogs` c/m/d/converge | `td-17-habit-logs-sync.yaml` | deterministic id; ordered `tick → untick → re-tick` |
| Wave A table 8/8 `healthGoals` c/m/d/converge | `td-18-goals-sync.yaml` | deterministic id; upsert-only screen, so the triad is built from the weight-goal card |
| Tombstone propagation | `td-30-tombstone-propagation.yaml` | non-vacuous: `witness` before `kill` |
| Airplane-mode → reconnect catch-up | `td-31-airplane-catchup.yaml` | `setAirplaneMode` **plus** `://e2e-block-network`, because the former is a no-op on the iOS simulator |
| Push wake delivered A→B in the one-user household | `td-32-push-wake-arm.yaml`, runner log-grep + `simctl push`, `td-33-push-wake-verify.yaml` | three legs; see §7 for what each can and cannot prove |
| No invite-partner copy on any screen | `td-40-no-invite-partner-copy.yaml` (negative, 13 screens) + `td-02` (positive: the screen must SAY "Add your other device") | |
| `privacy-cross-user-leak.yaml` green | `e2e/maestro/health/privacy-cross-user-leak.yaml` — **reused unmodified** | it is already Health-specific (`health.weightLog.v1` / `water.v1` / `notes.v1` / `prefs.v1` are the Health MMKV keys); no port was needed |
| Brand default asserted **off** in the binary under test | **runner gate** | §3.2 |

Supporting files: `td-launch.yaml`, `td-connect-metro.yaml`, `td-dismiss-chrome.yaml`,
`td-dismiss-stale-alerts.yaml`, `td-sync-nudge.yaml`, `td-99-cleanup.yaml`.

---

## 7. Known limitations

1. **Three Health surfaces have no edit verb, and one has no delete verb.** The
   suite says so in the flow headers rather than substituting a weaker gesture
   silently:
   - `waterEntries` — no per-entry edit (`health-water-edit-goal` is the daily
     *goal*, a different table). Modify logs a second distinct volume and
     requires the peer's projected total to move with it.
   - `bodyMeasurements` — no edit. Modify re-logs the same metric on the same
     day; the TODAY card is keyed by metric, so the row is replaced.
   - `healthGoals` — upsert-only screen with no row list at all.
   - `healthEntries` (sleep) — **no edit and no delete**. Its tombstone is
     covered by `td-13`'s workout delete and by `td-30`.

   If He3 lands any of these verbs, replace the substitute leg — do not keep both.

2. **The push-wake bullet is proven in three legs, not one.** The client cannot
   distinguish "converged because of the wake" from "converged because Maestro
   foregrounded the app" by screen content. What `td-33` asserts instead is the
   property only correct handling produces: **silence** —
   `handleHealthSyncWakeNotification` returns `true` so the payload is not also
   routed as a domain notification, and a mishandled wake therefore shows up as a
   blank notification. Combined with the runner's log-grep (B registered a token;
   a `health_sync_wake` was issued *after* A's deposit — the leg that fails if
   `excludeUserId` still excludes the only user) and the `simctl push` of the
   real payload, that is the strongest statement a simulator supports.

3. **The enrolment screen does not exist yet.** As of 2026-08-14 nothing in
   `src/features/health/screens/` renders `HEALTH_ENROLMENT_COPY` — grep for it
   returns zero `.tsx` hits. `td-02` / `td-03` / `td-04` / `td-05` are the
   acceptance test for a screen He3/He5-UI still has to land, exactly as the
   House MM enrolment phase was for H3's. Every id they use is a contract; if the
   screen ships different ids, fix them in the flows, not by loosening an
   assertion to a bare text match.

4. **`td-14`'s sleep entry survives cleanup.** There is no delete affordance for
   it. The next run's same-date log overwrites it.

5. **Row selection on nutrition uses `index: 0`.** Meal rows carry server-minted
   ids, so the overflow menu is opened at index 0. That guess is not what the
   assertion rests on — the modify leg requires the *old* marker to be gone
   afterwards, so an edit that landed on the wrong row fails rather than passing
   quietly.

6. **`(?i).*partner.*` would be the wrong assertion.** `HealthVitalityScreen`
   legitimately renders "Sex with a partner" (`health-vitality-partner-sex`) — a
   domain field about the member's own life. `td-40` asserts the specific
   forbidden phrases and walks Vitality deliberately, so the carve-out is visible
   rather than achieved by not looking.

7. **Both simulators share one Metro** (`:8095`), so their console output
   interleaves in `/tmp/metro-health-two-device.log`. The enrolment scrape is
   bounded to lines written after the run started, so an earlier run's expired
   code cannot be picked up; the push-wake grep is bounded the same way.

---

## 8. Running it

```sh
# e2e/credentials.local needs ONE account:
#   E2E_EMAIL / E2E_PASSWORD
# E2E_EMAIL_SECONDARY must be unset (or equal) — see §1.
./scripts/e2e/run-health-two-device-sync-live-report.sh
```

| Env | Default | Effect |
|---|---|---|
| `E2E_DEVICE_A` / `E2E_DEVICE_B` | registry (`Health-A` / `Health-B`) | override the pair for one run |
| `TD_METRO_PORT` | `8095` | this suite's dedicated Metro |
| `TD_FAIL_FAST` | `1` | stop at the first red flow |
| `TD_REPORT_POLL` | `30` | live-report regeneration interval, seconds |
| `HEALTH_WORKER_ENV` | `staging` | which Worker env the version gate reads |
| `HEALTH_VERSION_GATE` | `enforce` | `warn` → non-certifying run, recorded in the report |
| `HEALTH_BRAND_DEFAULT_GATE` | `enforce` | `warn` → non-certifying run |
| `E2E_SIM_MAX_MB` | `800` | per-device erase cap |

The runner opens the Simulator window, creates either device if missing,
size-guards both before boot, turns off Password AutoFill, installs A's bundle on
B when B has none (the two devices **must** run the same binary or the version
gate means nothing), starts its own Metro with the lab flag, pre-builds the
bundle once, and then **opens the live HTML report in the browser as the run
starts**.

Report: `documents/engineering/testing/reports/health-two-device/<ts>/index.html`,
with a `latest` symlink alongside. It is the project's own reporter
([`scripts/e2e/generate-report.mjs`](../../../scripts/e2e/generate-report.mjs))
with the shared header from
[`report-meta.sh`](../../../scripts/e2e/report-meta.sh) — same pill/badge styling
and the same platform · environment · build · device header row as every other
app, with the device field carrying the **pair** (`Health-A+Health-B`). Per-device
Maestro output goes to `steps-A.log` / `steps-B.log`; verdicts to `summary.log`.

> A `latest` symlink resolves at open time, so a tab opened before this run
> existed keeps showing the previous one. Open the timestamped directory the
> runner prints.

Enrolment is a chain — `td-04` cannot approve a claim `td-03` never made — so the
runner stops at the first failure rather than reporting a cascade of unrelated
ones. Cleanup runs only on a green run; markers carry the run timestamp, so
leftovers never collide with the next attempt.

---

## 9. Status

**Authored, syntax-checked, selector-checked, NOT RUN.**

| Check | Result |
|---|---|
| `maestro check-syntax` on all 25 flow files | ✅ pass |
| `bash -n scripts/e2e/run-health-two-device-sync-live-report.sh` | ✅ pass |
| Every `id:` selector resolves to a real testID | ⚠️ see §9.1 |
| Actual suite execution | ⏸ **blocked — see the checklist** |

He3 + He7-lite have now **landed and are green** (mobile 669 suites / 10688
tests, flag-on 151 / 4128), so checklist item 1 is closed. What remains is a
build, a deploy, and one screen.

### 9.1 Run the selector check BEFORE you build anything

```sh
npx jest src/features/health/__tests__/twoDeviceFlowSelectors.test.ts
```

Two seconds, no simulator, no build. It walks all 25 flows plus every subflow
they call, and fails on any `id:` the app cannot render — resolving template
testIDs (`` testID={`tab-${route}`} ``) so dynamic ids are not reported as
missing.

This exists because the alternative is discovering a dead selector on a booted
device after a 20-minute build, where "typo", "renamed testID" and "the screen
was never built" all look identical. It caught the last one for real: the suite
was authored against `health-other-device-*`, and the enrolment screen did not
exist — `HEALTH_ENROLMENT_COPY` was referenced only by a unit test, and House's
`src/screens/house-v2/enrolment/` had no Health counterpart. The whole suite
would have died at setup, in `td-02`.

It also removed a **vacuous** assertion from `td-33`: an `assertNotVisible` on
`id: notification-banner`, an element the app never renders (an iOS push banner
is OS chrome, not an app view). It could never fail, and a check that cannot
fail inside a DoD flow reads as coverage that is not there.

**First real run checklist:**

1. ~~He3 + He7-lite merged~~ — ✅ **done**; `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1` routes to the ledger.
2. The enrolment screen renders `HEALTH_ENROLMENT_COPY` with the ids `td-02` … `td-05` use.
   Verify with §9.1 — it is green only when every id resolves.
3. The Health Worker is deployed from the **`main` checkout** with its commit
   recorded (§3.1), and `e2e/health-worker-version.local` written if the
   annotation route is not used.
   ⚠️ **This is the gate that cannot be worked around.** The backend changes the
   client under test depends on — He5's second-`user_id` 403, the `/v2` secret,
   the reject-list — live on `health-v2` and are **not deployed**. Until they
   land on `main` and ship, §3.1 fails by design, and `HEALTH_VERSION_GATE=warn`
   produces a run that is **not** a He12(partial) exit. Deploying from an
   `<app>-v2` clone is forbidden (CLAUDE.md); land first.
4. Health built and installed on `Health-A`
   (`npm run prepare:xcode:health`, then the `SymplyHealth-Staging` /
   `Debug-health` scheme). The runner copies the bundle to `Health-B`.
5. No other Health suite running anywhere on the machine.
