# Symply Health V2 — Requirements Pack

| Field | Value |
|-------|-------|
| **Status** | Canonical for Health V2 (local-first cutover). Live plan **v1.8** — Wave A **engine as-built**, **cutover not started**, not `ready`. |
| **Last updated** | 2026-08-14 |
| **Owning app** | Symply Health (`simple-health` / brand `symply-health`) |
| **Programme branch** | `health-v2` |

This pack mirrors [House v2](../House%20v2/README.md) and [Buget v2](../Buget%20v2/README.md).
Product positioning stays in the app docs; this folder is the **data-plane
programme** — move Health off readable D1 onto the proven `@symply/local-first`
engine.

## Documents

| Doc | Path | Role |
|-----|------|------|
| **Local-first plan (active)** | [health-local-first-implementation-plan.md](./health-local-first-implementation-plan.md) | Live engineering plan **v1.8**. **15 dashboard rows**. Engine 🟢; He3/He10/He12 📐. **Code on the branch is source of truth where they disagree** |
| **Stages He0–He12 record** | [Symply_Health_V2_Implementation.md](./Symply_Health_V2_Implementation.md) | Execution handoff **v1.8** — same status (as-built engine, not `ready`) |

App-level product (not duplicated here):

- [documents/apps/symply-health/BRD.md](../../apps/symply-health/BRD.md)
- [documents/apps/symply-health/TRD.md](../../apps/symply-health/TRD.md)
- [documents/apps/symply-health/migration.md](../../apps/symply-health/migration.md)
- [documents/apps/symply-health/PARITY_PLAN.md](../../apps/symply-health/PARITY_PLAN.md)
- [documents/apps/symply-health/features/README.md](../../apps/symply-health/features/README.md)

Proven engine this pack reuses:

- [budget-local-first-implementation-plan-v2.md](../Buget%20v2/budget-local-first-implementation-plan-v2.md)
- [house-local-first-implementation-plan.md](../House%20v2/house-local-first-implementation-plan.md)
- [BUDGET_MULTI_MEMBER_SYNC_E2E.md](../../engineering/testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md)

## Locked product stance (one paragraph)

Health data is **personal**, never household-shared, never silently sent to a
sibling app. Today the Worker D1 is the system of record and MMKV is a
read-through cache plus outbox. V2 flips that: **the device holds the encrypted
ledger**; Cloudflare stores identity, device keys, signaling, and a transit-only
zero-knowledge mailbox. Multi-device means **the same user’s** phone, tablet, and
watch — not a family ledger. Shared User stays. Soft Transfer stays
deny-by-default for the full ledger. RELATIONSHIPS **lists**
`health.summary.v1` / `profile.core.health.v1` — **listed ≠ enabled**; later
builds would use **local projections** only. UI stays on today’s Health screens;
swap `healthRepository` / storage modules underneath. **Q1 wipe is not
pre-authorized** — product must countersign before any Health D1 truncate.
HealthKit, FatSecret lookup, and social surfaces are **not** the ledger.
Blobs cannot reuse migration `0156` (already `lf_devices_composite_pk`). House
H6 shipped as **`0157_lf_blobs.sql`** — Health has **no** blob client yet (He6).

## Starting point (as of 2026-08-14) — engine as-built, D1 still SoT

| Layer | State |
|-------|--------|
| RN product | Five-tab shell + Body/Habits/Cycle/Vitality/Coach/Files/Fridge/Scan in the tree |
| SoT today | **Still** `symply-health-api` D1 (`0119`+) via `src/api/health.ts` + `writeThrough` / `HEALTH_PUSH_COLLECTIONS`. No Proxy. |
| Offline today | MMKV cache (`HEALTH_CACHE_KEYS`) + `health.outbox.v1` → `POST /health/sync/push` — **not** replaced |
| HealthKit | Native module + background import **shipped** (still writes the D1 path) |
| `@symply/local-first` | 🟢 Health importer exists at `src/features/health/local/` (registry, engine, session, sync). Storage modules do **not** call it. |
| `/v2` control plane | Capability on; DO bound; 410 reject-list + fail-closed + `/v2` rate limit + `health_sync_wake` **in tree**. `LOCAL_FIRST_API_ENABLED` out of `[vars]` (§1.7a Commit 3) — now a per-env secret, provisioned by `scripts/secrets/sync-child-worker-secrets.sh` and gated at `deploy:fleet` by `backend/scripts/verify-local-first-api-secret.sh`. Live 401-vs-404 proof: see [He0 live proof](#he0-live-proof--how-to-record-it). `wrangler.health.toml:173` comment still stale. |
| Client flag | `flag.ts` brand-defaults **on** for `symply-health` when unset — the default stays (He12 (full) is what turns it on). The **build** now pins `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=0` on all five `symply-health-*` `eas.json` profiles, guarded by `src/features/health/local/__tests__/easFlagPin.test.ts`. |

## He0 live proof — how to record it

DoD He0 requires a **live** `/v2` proof, because the fail-closed flip (§1.7a) and
the move of `LOCAL_FIRST_API_ENABLED` into secrets (§1.7a Commit 3) share one
silent failure mode: a missing or mistyped secret makes `requireLocalFirstApi()`
answer **404**, `/v2` goes dark, and the cron mailbox / checkpoint TTL sweeps
stop — with a green deploy log and no red test. Only a live probe tells 401 from
404.

One command, read-only, deploys nothing:

```sh
./scripts/health/verify-v2-fail-closed.sh budget          # the DoD gate — Budget staging + production
./scripts/health/verify-v2-fail-closed.sh health kaizen   # §2 item 1 — Health 401 vs Kaizen 404
```

It resolves hostnames from `src/config/env.shared.ts` (never hardcoded here),
sends one unauthenticated `GET {base}/v2/households` per Worker, and exits
non-zero on any mismatch.

| Code | Meaning | Verdict |
|---|---|---|
| **401** | Gate on, auth enforced | ✅ required for House / Budget / Health |
| **404** | Gate off — secret missing or not the literal `"true"` | ❌ `/v2` dark, mailbox TTL unswept — **except** on Kaizen, where 404 is correct (`localFirstApi: false`, body `{"error":"Not found"}`) |
| **200** | Gate on, auth **not** enforced | ❌ stop; do not deploy |

**Run it twice: before the fleet deploy and again after.** §1.7a's
kill-switch-durability note is the reason — a `[vars]` entry would let the next
`deploy:fleet`, for *any* brand's unrelated change, silently re-arm `/v2`. The
after-run is what proves the secret survived.

**What to paste back** (per env, four rows for the Budget gate):

| Field | Where it comes from |
|---|---|
| Brand + env | e.g. `budget production` |
| Status code | the script's `OK`/`FAIL` line |
| Worker Version ID | the script prints it if the response carries one; Cloudflare does not emit a version header by default, so otherwise take the `Current Version ID` line from the deploy output, or `cd backend && npx wrangler deployments status --env <env> [-c wrangler.<brand>.toml]` |

Two He0 items are **not** covered by this script and are still recorded by hand:
the mailbox-sweep cron line in **Budget and House** logs after the fleet deploy,
and the `health_flag0_mutation` staging positive control (§2 item 10).

## Rejected architectures (do not reintroduce)

| Rejected | Instead |
|----------|---------|
| Keep D1 as Health SoT + outbox | Device ledger; 410 `/health` writes when the V2 flag is on |
| Dual-write ledger + D1 / outbox | One SoT. Outbox is replaced, not kept beside the op log |
| Fork `projection.ts` | `@symply/local-first/projection` + a Health `LedgerSchema` |
| House multi-property / Budget household members as Health “family” | One personal household per user; family/community stays disabled (P4) |
| P3 plaintext Health projection to the server | Banned (same as House). Widget/Watch get a **local** glance slice |
| Silent Soft Transfer of the ledger | Deny-by-default; summaries only, consented, from local projections |
| Copy donor backend `/sync` as the V2 engine | Custom op log + mailbox already certified on Budget |
| Medical / clinical positioning | Wellness; no diagnosis claims |

## He3d decisions — reminders, the 64-slot budget, and Q3a

Recorded here because DoD He3d asks for two of them **by name**
(*"`authenticationRequired` decision recorded … Q3a default per §9"*), and
because §9 requires the notification allocation to be **named before Wave C
schedules anything**. Each one is also a constant in code, so a later change
breaks a test rather than a paragraph:
`src/features/health/local/reminders/decisions.ts` and
`src/features/health/local/reminders/slotBudget.ts`, both pinned by
`src/features/health/local/__tests__/reminders.test.ts`.

### 1. `authenticationRequired` — actions require an unlock, and He3d ships none

The Health DEK is `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so **any** ledger write from
a locked device fails. A notification action is such a write: iOS hands a
non-authenticating action straight to the app from the lock screen, and under
this DEK class "Log water" / "Mark habit done" would fail as a **silent no-op** —
the member taps, the sheet dismisses, nothing is saved, nothing says so (§5).

- Every Health notification action is declared **`isAuthenticationRequired: true`**
  (`HEALTH_REMINDER_AUTHENTICATION_REQUIRED`), so iOS unlocks before handing the
  action over.
- He3d ships **zero** actions (`HEALTH_REMINDER_ACTIONS = []`), which is the
  other outcome §5 explicitly allows: *"or must not offer log-from-notification
  at all"*. The flag above is the default any future action inherits, so the day
  one is added it is already correct.
- **Lock-screen content is not something the app can hide.** Previews are the
  member's own iOS setting and default to on — the same trap §9 documents for
  `.privacySensitive()` in WidgetKit. The control is therefore *what goes in the
  body*, and the rule is that a Health reminder body **carries no reading**: no
  weight, no calorie total, no volume, nothing from cycle / injury / vitality. A
  habit's own name is the single member-authored string that appears, exactly as
  in the server push it replaces.
- **If product wants log-from-locked, the DEK class changes first** (§16 Q8's
  option set) — not this flag.

### 2. Q3a — Option A, glance dark, no file-class migration later

Q3a is still open, and §9 is explicit that it *"gates enabling the glance, not
He3d — it must not strand He3a–c."* So He3d ships **Option A's file class by
default**:

| Setting | Value | Why |
|---|---|---|
| Glance file class | **`CompleteUntilFirstUserAuthentication`** | The App Group default. `.completeFileProtection` is **not** set |
| Widget entitlement | **none** | `NSFileProtectionComplete` is **not** added |
| Glance | **dark**, with in-product copy | Option A picks a file class, not a product answer |
| Never-list | `cycle`, `injury`, `vitality` — never written into the slice | §9: the write boundary is *"the real control"*, not file protection |

Guessing Option **B** is what §17 forbids: the entitlement is irreversible for a
shipped widget and would leave it a placeholder whenever the device is locked,
Home Screen included. Answering Q3a later flips the glance on with **no**
file-class migration.

### 3. The named per-feature notification allocation (the Wave C gate)

iOS keeps the **64 soonest-firing** pending requests and drops the rest silently.
Health's reminders are dailies, so each occurrence costs a slot. Budget:
**≤56 used / 64**, with 8 slots of headroom for everything else the app queues.

| Feature | Slots | Wave | Horizon that buys |
|---|---|---|---|
| `meals` | 12 | He7-lite | 4 slots × 3 days |
| `hydration` | 16 | He7-lite | up to 8/day × 2 days |
| `weighIn` | 4 | He7-lite | 4 occurrences — 4 days daily, or 4 weeks weekly |
| `habits` | 14 | He7-lite | the 14 next-firing habit reminders |
| `cycle` | 6 | **Wave C — reserved** | period / fertile-window predictions |
| `mensHealth` | 4 | **Wave C — reserved** | — |
| **Total** | **56** | | = the whole budget |

The two Wave C rows are **reserved, not spent**: the live scheduler may use only
the 46 He7-lite slots, so cycle predictions arriving is a one-line table edit
rather than a silent overflow. `reminders.test.ts` fails if the declared
allocations ever sum above 56.

**Rescheduling is bounded** (§9): a pass reschedules only when the reminder set's
content hash changes **or** ≥6 h have elapsed, whichever comes first. The hash
and the last-reschedule stamp live in MMKV under `health.reminderSchedule.v1`
(registered in `HEALTH_CACHE_KEYS`, so it is wiped on sign-out) and the bounded
path performs **no notification I/O at all** — not even a read of the centre.

**Accepted costs, stated in-product rather than discovered:** a member who never
opens the app runs out of horizon (Q7), and a member with more than 14 reminder-
bearing habits gets only the next few. Both are named in
`getHealthLocalRemindersCopy()`.
