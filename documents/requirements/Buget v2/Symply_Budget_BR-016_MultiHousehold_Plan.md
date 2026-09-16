# BR-016 — Multi-household membership + switcher (Symply Budget V2)

**Status:** planned, not started · **Requires:** 100% data isolation between households
**Reference implementation:** House H5 "Multi-property session" (shipped 2026-08-13)

---

## 1. The isolation verdict

**100% isolation does NOT require a separate database per household.** It requires
per-household namespacing of four `lf_meta` keys, plus moving the engine's
module-level singletons into a per-household session.

This is settled by what already exists:

| Layer | Already isolated? | Evidence |
|---|---|---|
| Row storage | ✅ PK `(household_id, tbl, row_key)` | `packages/local-first/src/store/types.ts:288-299` |
| Op log | ✅ unique `(household_id, device_id, seq)` | `types.ts:254-255` |
| Op frontier | ✅ PK `(household_id, device_id)` | `types.ts:259-264` |
| Sync peer cursors | ✅ PK `(household_id, peer_device_id)` | `types.ts:266-275` |
| Row encryption | ✅ AEAD bound to household | `row-aead.ts:14-21`, applied at `budget/local/engine.ts:475-478` (write) / `:570-575` (read) |
| **`lf_meta`** | ❌ `key TEXT PRIMARY KEY`, household-blind | `types.ts:224-227`, `:56-57` |

Every row is sealed with AAD `lf-row:<householdId>:<table>:<rowKey>:<keyEpoch>`, so a
row moved between households **fails to decrypt**. Isolation is enforced
cryptographically per row, not by file separation.

`getMeta`/`setMeta` are the only two methods in the entire `LocalFirstStore`
interface that do not take a `householdId`. That asymmetry — not the shared
database — is the whole problem.

### Why separate databases would be worse

Splitting the DB would not remove the `lf_meta` asymmetry, only relocate it, while
multiplying open file handles, WAL files, transaction scopes and DEK slots — and
breaking the `runInTransaction` (`types.ts:134`) guarantee that a cross-household
operation is atomic. The device DEK is deliberately device-scoped in both brands
(`budget/local/persistence.ts:29`, `house/local/persistence.ts:13`).

---

## 2. Tier-1 hazards — these corrupt data on the first background sync

Adding a second session without addressing these causes **silent, correctly-encrypted,
wrong-household data**. Ordered by severity.

| # | Hazard | Location | Mechanism |
|---|---|---|---|
| 1 | **`IDENTITY_META` is one global key** | `engine.ts:437`, w `:462`, r `:548` | Holds household + memberId + deviceId + **hdkHex + keyEpoch**. Two sessions ⇒ last write wins ⇒ next cold open reconstructs household A's ledger **under household B's HDK**, or loses one household outright. *This single key is why a naive second session cannot work at all.* |
| 2 | **Shared projection handler** | `engine.ts:313-346` (reads module `engine` at `:323, 333-334`) | Household B's `applyRemote()` merges B's deltas into **A's** ledger. Invisible until they diverge. |
| 3 | **Shared `pendingRemoteDeltas`** | `engine.ts:305`, drained `:938-939`, written `:945` | `noteRemoteOpsApplied` resolves the *active* session at `:932` and persists B's deltas as **A's rows**. |
| 4 | **`CHECKPOINT_VV_META` is one global key** | `engine.ts:1069`, w `:1165, 1193`, r `:1172` | `compactLocalLogIfSafe` (`:1170-1190`) truncates using a shared watermark ⇒ **A's compaction destroys ops B still needs**. Unrecoverable. |
| 5 | **Global `awaitingHouseholdKeys`** | `engine.ts:388`; r `:391, 839, 872, 1111`; w `:398, 763, 819, 1018` | Joining B blocks every write to fully-enrolled A; enrolling B unblocks A prematurely. |
| 6 | **`adoptJoinedHousehold` mutates in place** | `engine.ts:972-1023` | No registry re-keying — the session Map would still point at the stale id. |
| 7 | **Global `syncInFlight`** | `sync/orchestrator.ts:39, 46` | One unreachable household blocks every other household's sync. |
| 8 | **Global `controlPlaneSyncInFlight`** | `controlPlaneClient.ts:165, 174-178` | Registering B no-ops behind A's promise; B's peers never learn its device keys. |

### Tier-2 — user-visible cross-contamination

- **Reminder identifiers omit the household** (`reminders/budgetLocalReminders.ts:174, 203`).
  `syncBudgetLocalReminders` cancels all by prefix (`:156`) then reschedules only the
  active household ⇒ **switching households silently deletes the other's notifications.**
  The `householdId` is already in the notification `data` payload (`:182, 211`) — it just
  isn't in the identifier.
- **Blanket cache invalidation** — `sync/ledgerRefresh.ts:34` calls
  `queryClient.invalidateQueries()` with no household discrimination.
- **`pushWake.ts:53-59`** drops wakes for non-active households ⇒ they never sync on push.
- **Backup globals** — one schedule, phrase, history and destination for N households
  (`autoBackup.ts:89, 91`; `backupHistory.ts:43`; `backupDestinations.ts:134-135`).
  Household B would look backed up and not be: **a silent data-loss surface.**
- **`householdStore` holds one household + one roster** (`ensureSession.ts:37-43`,
  `householdRoster.ts:140`).

---

## 3. Staged plan

Each stage is independently landable and leaves the app shippable.

### B1 — Per-household meta keys + persisted index *(foundation)*

- `IDENTITY_META` → `identityMetaKey(householdId)` (House: `engine.ts:779`)
- `CHECKPOINT_VV_META` → `checkpointVvMetaKey(householdId)` (House: `:1663`)
- **Add** `HOUSEHOLDS_META` — the index a cold open enumerates (House: `:780, 814-834`)
- **Add** `ACTIVE_META` — the active pointer (House: `:781, 1161, 1349`)
- Keep `MEMBER_META` global — it is the correct different-account guard (`engine.ts:710-730`)
- Repurpose `HOUSEHOLD_META` as the active pointer, as House did (`:809, 1350`)

**Ship B1 with the migration (§4) or the release is a data-loss event.**

### B2 — Session registry

- `let engine: EngineState | null` → `Map<string, EngineState>` + `activeHouseholdId`
- `EngineState` gains `householdId`, `hydrated`, `awaitingKeys`, `pendingRemoteDeltas`,
  `retiredHouseholdKeys` (House: `engine.ts:478-502`)
- Two accessor tiers: `requireEngine()` (active, for UI) and `requireSession(id)`
  (any, for background work) — House `:635-650`. Add `BudgetLocalUnknownHouseholdError`.
- `ledgerProjection` → `projectionFor(householdId)` (House `:597-633`) — **hazard #2**
- Lazy hydration: build sessions from disk without decrypting rows; hydrate on
  activation (House `:1049-1108`). A three-household user must not pay cold-open cost 3×.

### B3 — Per-household sync

- `syncInFlight` → `Map<string, Promise<void>>` (House `orchestrator.ts:64`)
- Split `runBudgetLocalSync()` fan-out / `runBudgetLocalSyncFor(householdId)` (House `:113-131`)
- Introduce `BudgetSessionHandle` — background sync must **never** use the active
  accessors, or it seals B's ops under A's HDK (House `engine.ts:1204-1240`)
- Gate `useBudgetSyncStatusStore` on active-ness (House `:134-144`)
- `controlPlaneSyncInFlight` → household-keyed
- **Open question:** `WebRtcPeerTransport` + the module-global signaling client
  (`signalingClient.ts:105`) have **no House precedent** — House shipped mailbox-only
  for multi-property. Decide: per-household client, household-tagged multiplex, or
  disable WebRTC when >1 household.

### B4 — Notifications, roster, cache

- Embed `householdId` in every reminder identifier (House: `houseLocalReminders.ts:277, 338, 434, 485`)
- Add an `includeColdHouseholds` option so unhydrated households still schedule (House `:639, 666`)
- Put `householdId` on the ledger-change event and filter subscribers (House `engine.ts:538-547`)
- `householdStore` → real list + active selection; roster per household

### B5 — UI

- `listBudgetHouseholds()` / `createLocalBudgetHousehold()` / `removeLocalBudgetHousehold()`
- A `withHousehold(id, run)` write adapter that **activates before writing**, or refuses —
  House `localHouseholdsApi.ts:308-315`. Writing without it puts B's data in A's ledger.
- **Un-gate `BudgetHouseholdScreen`**: remove the `isLocalFirst` guards on the Add FAB,
  Delete and Leave added as the interim fix
- Refuse to remove the last household (House `engine.ts:1326-1328`)
- Restore `PropertySwitcher` for Budget, or use the existing per-card Switch action

### B6 — Join adds instead of replaces

- `adoptJoinedHousehold` (`engine.ts:972-1023`) stops wiping the previous ledger
  (`:1015-1016`) and instead mints a new session (House `:1620-1633`)
- Remove the "joining replaces this device's ledger" confirmation copy from
  `BudgetInviteScreen` (`:58, 261, 583, 632, 1087`, modal `:1175-1177`)

### B7 — Backup/restore

- Per-household archives; filenames must disambiguate (House `houseBackup.ts:20-22`)
- Every entry point takes `householdId`, defaulting to active (House `:157, 174-177, 223, 241-245`)
- Rewrite the mismatch error for a world where it is routine, not corruption —
  name the action: "Switch to that household and try again" (House `:250-256`)
- Decide: does auto-backup cover all households or only the active one? **If only the
  active one, the history must say so** — otherwise B looks backed up and is not.

---

## 4. Migration — where Budget must diverge from House

House shipped **no migration**, deliberately: `engine.ts:776-777` — "No migration from
the single-key layout, deliberately — §1.1 authorizes a wipe and there is no client in
the field to read the old shape."

**Budget cannot do this.** It has live ledgers in the field — see the
archive-instead-of-delete work in `budget/local/persistence.ts:63-105`, prompted by an
observed 2026-08-14 data-loss incident.

Without a migration the failure is silent and total: a device holding the legacy
unnamespaced `ledger.identity.v2` has no index entry, so the household list is empty,
`sessions.size === 0`, and `openLocalBudgetSession` falls through to `mintNewHousehold`
— **an effective wipe of the member's entire budget.**

Required migration, on open, before anything else:

1. If the index key is absent but `ledger.identity.v2` decrypts:
   read `ledger.household_id`, copy the blob to `ledger.identity.v2:<id>`,
   write the index `[<id>]` and the active pointer `<id>`, then delete the legacy key.
2. `lf.checkpoint.vv` → `lf.checkpoint.vv:<id>`.
3. `lf_rows` / `lf_operations` need **no** data migration — they already carry `household_id`.

Idempotent, and must run inside `runInTransaction`.

---

## 5. Conformance tests

Port `src/features/house/local/__tests__/multiProperty.test.ts`. It already asserts:

| Assertion | Line |
|---|---|
| One device identity, many HDKs | `:65, 76` |
| No cross-household row bleed | `:101` |
| Correct op attribution | `:116` |
| Isolation survives close/reopen | `:137` |
| Lazy hydration | `:154, 171` |
| Scoped removal | `:191` |
| Per-household checkpoint watermarks | `:237` |

**Add, with no House equivalent:** a migration test proving a legacy single-household
device keeps its ledger (§4), and a reminder-identifier test proving a switch does not
cancel the other household's notifications (Tier-2).

### E2E

These currently fail on exactly this defect and become the acceptance tests:

- `budget-households.yaml` — creates "E2E Household", asserts it stays visible
  (last real run 2026-08-13: `Assertion is false: ".*E2E Household.*" is visible`)
- `budget-household-switch.yaml` — same shape, `.*E2E Switch HH.*`

Both assert `POST /households` against **D1**; under local-first they must be rewritten
to assert against the local engine. Until BR-016 lands they contradict the interim fix
(no Add FAB) and need updating either way.

---

## 6. What is already safe — do not touch

- **Shared device DEK.** Isolation comes from row AAD, not key separation.
- **`lf_rows` keying** — `(household_id, tbl, row_key)`, not table-only.
- **`MEMBER_META`** — correctly device/account-scoped.
- **Domain facades** — `localSavingsApi.ts:78`, `localRegisteredApi.ts:27`,
  `localWishesApi.ts:20`, `localMortgageApi.ts:33`, `localBudgetLoansApi.ts:20`,
  `localBudgetRenewalsApi.ts:16` already take a `householdId` and throw on mismatch.
  Mechanical port to `withHousehold`, not a redesign.
- `lf_projection_cursors` is household-blind by schema (`types.ts:277-282`) but **unused**
  by Budget. Noted so nobody starts using it.
