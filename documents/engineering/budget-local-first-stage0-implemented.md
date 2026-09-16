# Budget V2 local-first — what we implemented (Stage 0)

**Date:** 2026-08-12 · **Branch:** `feat/budget-v2-local-first`
**Scope:** shipped code only. For the diagnosis and the forward plan see
[budget-local-first-scale-audit.md](budget-local-first-scale-audit.md).

Every number in this document was measured or read out of the running system. Where
something is unverified, it says so.

---

## 1. Summary

Thirteen changes shipped across the mobile app, the shared `@symply/local-first`
package, and the Cloudflare Worker. They fall into three groups:

| Group | Count | What it addresses |
|---|---|---|
| Security / data-loss defects | 4 | mail destruction, cross-account ledger leak, silent write loss, permanent divergence |
| Failure visibility | 2 | a terminal failure masquerading as "offline" |
| Performance / correctness groundwork | 7 | encoders, dead transport, harness fidelity |

**34 new automated tests.** Backend deployed to staging **and** production
(verified live). The two-device E2E suite is **not yet green end-to-end** after
these changes — see §7 for exactly where it stands and why.

---

## 2. How the problems were found

Not by reading code casually. Two structured passes:

| Pass | Agents | Tool calls | Tokens | Wall clock |
|---|---|---|---|---|
| Audit — 8 subsystem readers + 1 benchmark agent | 9 | 555 | 1,384,571 | 27.5 min |
| Design — 4 architectures × 3 adversarial judges + synthesis | 17 | 400 | 2,087,268 | 31.6 min |

Findings were **not** taken on faith. Every load-bearing claim was re-verified by
hand at file:line before any code changed. Three claims in the audit brief turned
out to be wrong and were corrected:

- "93 `mutateLocalLedger` call sites" → **88 grep hits across 10 files**, all inside
  `src/features/budget/local/`, none in screens/stores/hooks.
- "one natural-key table" → **two** (`savingsMonthlyTargets: 'period'`,
  `wishAttachments: 'key'`).
- The design panel's highest-*scoring* proposal was **rejected** because its row
  digests were computed over stamp sets rather than values, so two replicas holding
  different data would produce identical digests — its own anti-entropy check would
  have been blind to the divergence it introduced.

One finding reframed the whole effort:

```
$ git cat-file -t main:packages/local-first
fatal: path 'packages/local-first' exists on disk, but not in 'main'
```

The local-first subsystem is **unmerged — there is no production install base.**
That deleted every cross-version migration mechanism the proposals had budgeted,
and it made the natural-key re-key (§3.3) affordable instead of impossible.

---

## 3. What we implemented

### 3.1 Mailbox ack could destroy another member's mail — **fixed**

**File:** [local-first-mailbox-service.ts](../../backend/src/services/local-first-mailbox-service.ts),
[local-first-v2.ts](../../backend/src/routes/local-first-v2.ts)

**What was wrong.** `ack(blobIds, householdId)` matched on
`id = ? AND household_id = ?` with **no recipient check**, then **hard-deleted the
R2 object**. The route verified only household membership. So any member's device
could permanently destroy mail addressed to a different device — including the
wrapped household-key envelope a joining member is waiting on (`hdkTransfer.ts`),
stranding them mid-enrolment.

**What we implemented.**
1. `ack(blobIds, householdId, deviceId)` now requires `recipient_device_id = ?`.
2. New `deviceBelongsToUser()`; the route rejects with **403** unless the device is
   registered to the caller in `lf_devices`.
3. **The R2 delete was removed from the ack path.** Ack means "this recipient has
   it", not "nobody needs it". `sweepExpired()` already reclaims acked blobs, so
   there is no storage leak.
4. **Broadcast blobs are deliberately not ackable.** A broadcast is addressed to
   every peer, so honouring the first ack would destroy it for the rest — the same
   data loss, relocated. They expire by TTL; redelivery is harmless because
   `applyRemote` dedupes by `opId`.

Points 3 and 4 were **not** in the plan. They were added because the plan's fix
moved the bug rather than removing it.

**Benefit.** A member's device can no longer delete another device's undelivered
operations. Enrolment can no longer be stranded by an unrelated device syncing.

**Verified:** 9 tests, including "member A cannot ack the HDK envelope addressed to
joiner B, but B can".

---

### 3.2 Signing in as a second user could hand over the first user's ledger — **fixed**

**File:** [engine.ts](../../src/features/budget/local/engine.ts)

**What was wrong.** `openLocalBudgetSession` began:

```ts
if (engine) {
  return engine.ledger;   // ignores input.userId entirely
}
```

A disk-level guard further down *did* reset when the stored `memberId` differed —
but the early return fired first, so it never ran. Both call sites in `authStore`
are floated promises (`void import(...).then(...)`), one on sign-in and one on
logout, so a fast sign-out/sign-in could reach the open before teardown finished.
**The new user received the previous user's household, their spending, and their
sync keys.**

**What we implemented.**
1. The early return now compares `engine.ledger.memberId === input.userId` and
   closes + reopens when they differ.
2. Session open/close/reset are serialized through a module-level promise chain, so
   the two floated promises can no longer interleave.
3. `openLocalBudgetSessionForTests` calls the *inner* close to avoid self-deadlock.

**Benefit.** Account isolation no longer depends on teardown winning a race.

**Verified:** 4 tests against the **real** `openLocalBudgetSession`. My first
version of these tests used the test helper, which unconditionally tears down first
— so it passed without testing anything. Rewritten, then confirmed by temporarily
restoring the old early return: **the leak test fails without the fix.**

---

### 3.3 Two tables diverged permanently between members — **fixed at the root**

**Files:** [projection.ts](../../src/features/budget/local/projection.ts),
[engine.ts](../../src/features/budget/local/engine.ts),
[localSavingsProjector.ts](../../src/features/budget/local/savings/localSavingsProjector.ts),
[localWishesApi.ts](../../src/features/budget/local/wishes/localWishesApi.ts),
[budgetBackup.ts](../../src/features/budget/local/backup/budgetBackup.ts)

**What was wrong.** `savingsMonthlyTargets` was keyed by `period` and
`wishAttachments` by `key` — **natural keys with live delete-then-recreate paths.**
Clearing a month's savings target deletes the row; setting it again re-creates the
*same* key. A delete records an **absorbing tombstone** under that key, so every
peer rejected the re-create *forever* while the authoring device kept the row.
Permanent, silent divergence: two phones showing different numbers, with nothing
surfaced to either user.

**What we implemented.**
1. Both tables re-keyed to a surrogate `id`. A re-create is now genuinely a new row.
2. `targetsByPeriod()` — surrogate keys mean two members setting the same month
   concurrently now produce **two rows** (concurrent creates are both kept by
   design). Letting the last one win would make the displayed figure depend on op
   arrival order, which differs per device. Newest `updated_at` wins, ties broken by
   id, so **both devices show the same number**.
3. A `__DEV__` throw in `rowKey()` — a row with no key is invisible to the
   projection: it never diffs, never syncs, silently, for one writer only.
4. `withSurrogateIds()` backfills ids when restoring an older backup archive.

Items 2 and 4 were **not** in the plan; they are consequences of the change.

**Why this was possible.** Every earlier proposal patched the *projector* around
this, because a key migration was assumed impossible. With no install base, re-keying
is strictly better: it removes the resurrection path permanently, for both tables,
with no null-handling audit and no tombstone-clearing migration.

**Verified:** 4 tests. Reverting the keys to natural ones **fails 3 of 4**; the
fourth (delete still beats a concurrent edit) passes both ways, which is the point —
the re-key must not weaken absorbing tombstones.

---

### 3.4 Sync failures all looked the same — **fixed**

**Files:** [syncErrors.ts](../../src/features/budget/local/sync/syncErrors.ts) *(new)*,
[syncStatusStore.ts](../../src/features/budget/local/sync/syncStatusStore.ts),
[orchestrator.ts](../../src/features/budget/local/sync/orchestrator.ts),
`SyncStatusBanner.tsx` *(deleted 2026-08-16 — the failure copy below now lives
on [BudgetSyncScreen.tsx](../../src/screens/budget/BudgetSyncScreen.tsx))*,
[local-first-v2.ts](../../backend/src/routes/local-first-v2.ts)

**What was wrong.** Every failure collapsed into one `lastError` string built from
`error.message`, rendered as a generic problem. Two consequences: a raw system
string could reach the UI, and — worse — a **permanent** failure was
indistinguishable from being briefly offline. The app kept promising it would sync
when the connection returned, which it could no longer do.

**What we implemented.**
1. `classifySyncError()` → `offline | payload_too_large | auth | key_epoch |
   decrypt | server | unknown`, plus `isTerminalSyncError()`.
2. The relay returns an explicit **413** with `code: 'payload_too_large'`, `limit`
   and `actual`, instead of a generic zod 400 that the client could not distinguish
   from a malformed request.
3. The banner maps codes to distinct copy and **never renders the raw error**.
   `payload_too_large` reads *"Sync paused — too much history to send"*, which does
   not invite a retry that cannot work.

**Benefit.** A user is told the truth, and support can tell the two apart.

**Verified:** 6 tests, including "never classifies a terminal failure as offline".

---

### 3.5 An oversized op batch: refuse, do not truncate

**File:** [mailbox-engine.ts](../../packages/local-first/src/sync/mailbox-engine.ts)

**What was wrong.** `pushOutbound` ships the **entire op log** every sync —
`listOperationsByHlc()` with no cursor — against a relay that caps a deposit at
512,000 base64 chars. At a measured ~853 bytes/op, sync fails permanently at
roughly **450–500 ops**, and every retry is larger than the last.

**What we implemented.** `pushOutbound` measures the sealed batch and throws
`MailboxPayloadTooLargeError` before uploading.

**We deliberately did not implement the plan's version of this.** The plan called
for capping the batch at 400 ops. But nothing removes ops from the batch, so that
would deposit the same oldest 400 forever while every newer change silently never
left the device — **silent divergence dressed up as a healthy sync**, strictly worse
than the failure it replaces. Refusing is loud, local, and costs no upload.

**Benefit.** The condition becomes visible and bounded instead of silent and
permanent. Stage 1 removes it properly with a cursor-bounded slice.

---

### 3.6 Encoders — measured, then replaced

**Files:** [bytes.ts](../../packages/local-first/src/crypto/bytes.ts),
[base64.ts](../../packages/local-first/src/crypto/base64.ts) *(new)*

**What was wrong.** `bytesToHex` built its output with `out +=` **per byte**. It was
the single most expensive operation in the app — slower than the AES-GCM that
produced the bytes — with heap churn ~56× the input, which is what pushed large
ledgers into OOM. `hexToBytes` allocated a two-character string per byte via
`parseInt(slice(...))`, and runs over the whole snapshot on every cold open.

**Measured (Node 22 / V8, Apple silicon, min of 3 runs):**

| Operation | 2 MB | 8 MB | 32 MB |
|---|---|---|---|
| `bytesToHex` — before | 154 ms | 637 ms | 2,825 ms |
| `bytesToHex` — after | 110 ms | 546 ms | 2,270 ms |
| **speedup** | 1.4× | 1.2× | **1.2×** |
| `hexToBytes` — before | 52 ms | 210 ms | 852 ms |
| `hexToBytes` — after | 7 ms | 21 ms | 87 ms |
| **speedup** | 7.8× | 9.8× | **9.8×** |
| base64 (new) | 75 ms | 262 ms | 1,133 ms |
| base64 size vs hex | 67% | 67% | **67%** |

**What we implemented.**
1. `bytesToHex` — 256-entry lookup table, built in 8 KB chunks joined once.
2. `hexToBytes` — `charCodeAt` + nibble table, no per-byte allocation.
3. New `crypto/base64.ts` — chunked, dependency-free, environment-agnostic
   (`btoa`/`atob` are not guaranteed under Hermes, and the usual
   `String.fromCharCode(...spread)` pairing blows the call-stack argument limit on
   multi-megabyte buffers). **Not yet on the wire** — Stage 1 switches the format.

**Honest note on the headline number.** An earlier measurement suggested 2.8× for
the encoder. That was a p50 inflated by GC pressure; min-of-3 shows 1.2×. The real
wins are the **decoder at ~10×** — which is on every cold open — and base64 being
**2× faster than hex and a third smaller**, which is what makes it the right wire
format.

**Verified:** 11 tests over sizes that straddle both chunk boundaries (8192 for hex,
8190 for base64), all 256 byte values, RFC 4648 vectors for both padding cases, and
agreement with the platform encoder where one exists.

---

### 3.7 Android storage cliff and silent write loss — **fixed**

**Files:** [gradle.properties](../../android/gradle.properties),
[storage/index.ts](../../src/services/storage/index.ts),
[persistence.ts](../../src/features/budget/local/persistence.ts)

**What was wrong.** Three compounding issues:
1. `@react-native-async-storage` defaults to a **6 MB** SQLite database
   (`config.gradle: dbSizeInMB = 6L`) and `AsyncStorage_db_size_in_MB` was **never
   set** in this repo.
2. Storage silently falls back to AsyncStorage whenever MMKV init throws — logged at
   `console.log`, so a fleet-wide failure was invisible in production.
3. `setItem` swallowed write failures and returned `void`, so a caller could not
   distinguish "written" from "silently dropped". The Budget ledger is stored as a
   **single value**, so on Android it meets that ceiling in one write.

**What we implemented.**
1. `AsyncStorage_db_size_in_MB=64`.
2. `setItemStrict()` — throws instead of swallowing. The ledger snapshot and its DB
   key now use it. **Tolerant `setItem` is retained** for the fleet's many zustand
   `persist` stores, which legitimately treat storage as best-effort; making every
   app's preferences throw was not worth the blast radius.
3. MMKV init failure is now recorded (`getMmkvInitError()`) and warned.

**Benefit.** The ledger — the system of record — can no longer be silently lost on
Android.

---

### 3.8 WebRTC peer sync gated off

**File:** [webrtcPeer.ts](../../src/features/budget/local/sync/webrtcPeer.ts)

**What was wrong.** `isAvailable()` treated `not_configured` as available, and
`/v2/turn` returns exactly that unconditionally — so **every sync attempted the peer
path**. `PeerSyncSession` serializes the entire op log into **one** DataChannel
message with no chunking and no `maxMessageSize`/`bufferedAmount` check, exceeding
libwebrtc's ~256 KiB SCTP limit at roughly **110 ops** and tearing down the channel.
It could not act as an escape hatch from the mailbox cap either — it fails *lower*.

**What we implemented.** Gated behind `EXPO_PUBLIC_BUDGET_P2P=1`.

**Benefit.** A transport that reliably fails, and can tear down a channel mid-sync,
no longer runs on every sync for every user.

---

### 3.9 `recipientDeviceId` was dropped in the mapping layer — **found by E2E**

**File:** [httpControlPlane.ts](../../src/features/budget/local/sync/httpControlPlane.ts)

Introduced by §3.1 and caught by the live suite. `fetchMailbox` rebuilt each blob
without `recipientDeviceId`, so **every blob looked like a broadcast**, nothing was
ever acked, and the mailbox grew without bound — observed live as `blobs=3`, then
`blobs=4`, on every fetch. Fixed by preserving the field.

**This is why the E2E matters:** unit tests covered each half of the ack contract
correctly and still missed it, because the defect was in the glue between them.

---

### 3.10 A failed ack aborted the entire sync — **found by E2E**

**File:** [mailbox-engine.ts](../../packages/local-first/src/sync/mailbox-engine.ts)

Also introduced by §3.1. Once ack became device-scoped, a device whose control-plane
registration had lapsed got a 403 there and its **whole sync** was reported as an
auth failure — even though the inbound merge had already succeeded and persisted.
Observed live:

```
POST /v2/households/.../mailbox/ack → 403 FAIL detail=errorCode=forbidden
WARN [BudgetLocal] sync failed code=auth Request failed with status code 403
```

Ack is now best-effort in a `try/catch`: the ops are already applied, so a failed
ack costs only redelivery, and replay is idempotent.

**Note:** the 403 itself was the new check working correctly — device B genuinely was
not registered for that household. Both user ids were confirmed against the live API
(`712c6c8c…` owner, `b20e35a5…` member) rather than inferred from a shared log.

---

### 3.11–3.13 Test-harness fidelity

These changed no product code but were required to test the product honestly.

| # | Fix | Why it mattered |
|---|---|---|
| 3.11 | Scroll guards before interacting with settings elements | The floating tab bar overlays the settings ScrollView at **y=770–830**. "Invite someone" sat at y=739–789 (centre 764, just clear). The inline sync note added earlier pushes content down 20px → centre **784, under the bar**. Maestro reported the tap `COMPLETED` because the element is in the hierarchy at those coordinates; the touch went to the Spending tab. |
| 3.12 | Unconditional native-alert dismissal (4 sites) | Tapping "Join requests" with nothing pending raises a `UIAlertController`. iOS renders it in its **own window**: `idb` sees 4 elements, Maestro sees none. So `when: visible: 'No one is waiting to join'` **SKIPPED**, the alert stayed up and swallowed every later step — surfacing as "element not found" several steps downstream. Don't gate a dismissal on seeing what you're dismissing. |
| 3.13 | `mm-one.sh` household selection + `.*Request sent.*` regex | The fast-loop tool minted invites from the owner's `households[0]` instead of the paired household. Device B claimed one, its ledger moved to `hh_local_fac1ebb3d3caf2d3` while A stayed in `hh_local_00ac7cb585b6c7bb` — **different households**, so `mm-03` took its "already enrolled" branch, reported PASS without claiming, and every later phase failed for unrelated reasons. Separately, Maestro selectors are regexes matched against the **whole** element text, so bare `'Request sent'` cannot match *"Request sent. Ask the household owner…"*. |

---

## 4. Verification

### Tests added — 34, all passing

| Suite | Tests | Runner |
|---|---|---|
| `local-first-mailbox-ack.test.ts` | 9 | vitest (backend) |
| `encoding.test.ts` | 11 | vitest (`packages/local-first`) |
| `accountSwitch.test.ts` | 4 | jest |
| `naturalKeyRekey.test.ts` | 4 | jest |
| `syncErrors.test.ts` | 6 | jest |

Two suites were **verified to fail when the fix is reverted** — the account-leak
test and 3 of the 4 re-key tests. A regression test that has never been seen to fail
is not evidence.

### Full suites

| Suite | Result |
|---|---|
| Mobile jest (whole repo) | **580 / 585 suites, 8,916 / 8,923 tests** |
| Backend vitest | **132 files, 2,930 tests — all passing** |
| `packages/local-first` vitest | **7 passed, 1 skipped (24 tests)** |

The 7 mobile failures are pre-existing and unrelated: 4 Health icon tests
(`"vitality" is not a valid icon name` — this checkout is built for
`APP_BRAND=symply-budget`) and 1 flow-completeness test whose gaps come from commit
`7ef1605b`, another branch's chat/backup work. Confirmed by checking those files are
unmodified.

### Deployment — live

| Worker | Environment | Deployed (UTC) |
|---|---|---|
| Budget | staging | 2026-08-12 18:54:58 |
| Budget | production | 2026-08-12 18:56:32 |
| House | production | 2026-08-12 18:56:20 |

Via `npm run deploy:fleet` (House + Budget + Kaizen + Health, staging then
production). Backend typecheck clean in all changed files; lint 0 errors.

---

## 5. Benefits, concretely

| Before | After |
|---|---|
| A member's device could permanently delete another device's undelivered ops, including the enrolment key envelope | Ack requires the addressed device **and** proof it belongs to the caller; nothing is hard-deleted on ack |
| A fast sign-out/sign-in could hand user B user A's ledger | Session open is user-aware and serialized |
| Clearing and re-setting a savings target diverged the household permanently and silently | Surrogate keys; re-create merges; concurrent same-period rows resolve identically on every device |
| A permanent sync failure displayed as "offline, will retry" | Seven typed codes, explicit 413, honest copy |
| An oversized batch failed silently forever | Refused loudly and locally, before upload |
| `hexToBytes` cost 852 ms per 32 MB on every cold open | 87 ms — **9.8× faster** |
| Android: ledger writes could vanish past a 6 MB ceiling, logged at `warn` | 64 MB ceiling; ledger writes throw on failure |
| Every sync attempted a WebRTC path that dies at ~110 ops | Off unless explicitly enabled |

---

## 6. What we deliberately did NOT do

Stated plainly, because each was a judgement call against the plan:

1. **Did not swap the MMKV encryption key.** The literal
   `encryptionKey: 'your-encryption-key'` ships in every build of all five apps, so
   at-rest encryption is currently decorative — and Budget writes its ledger DB key
   in **plaintext hex** into that same store. But MMKV cannot open an existing store
   under a different key: a bare swap **orphans every current user's data across all
   five apps**. Doing it properly needs `recrypt()`-on-first-launch plus a
   per-install SecureStore key, and it is entangled with the at-rest posture decision
   that must be settled before row-granular storage. Documented in place.
2. **Did not truncate the op batch** (§3.5) — it would convert loud failure into
   silent divergence.
3. **Did not implement entityType-scoped diffing.** `addExpense` declares
   `entityType: 'expense'` and mutates `ledger.categories` in place
   (`cat.usage_count += 1`), so scoping would silently drop the category update.
   Measured full-table capture+diff is ~38 ms for the whole 5-year corpus.
4. **Did not make tolerant `setItem` throw globally** — the fleet's zustand stores
   legitimately treat storage as best-effort.

---

## 7. Honest status of the two-device E2E

The suite is **not yet green end-to-end** after these changes. Progress across runs:

| Run | Reached | Stopped by |
|---|---|---|
| 9 | mm-02 | invite button under the tab bar (§3.11) |
| 10 | mm-03 | join panel at the fold (§3.11) |
| 11–12 | mm-04 | native alert swallowing steps (§3.12) |
| 13 | mm-05 | device B half-enrolled — ledger said member, control plane had no device row |
| 14 | mm-03 | `'Request sent'` regex (§3.13) — **but the claim succeeded against the correct household** |
| 15 | mm-04 | OOB word mismatch: panel showed invite `AF8EKV` (`jade/flint/maple`), runner passed `umbra` from this run's invite |
| 16 | — | aborted at install: I had uninstalled the app from **both** simulators, and the runner installs on B by copying A's bundle |

**None of these were defects in the Stage 0 code.** They were harness fragility and
test-environment state. Two were self-inflicted: `mm-one.sh` targeting the wrong
household, and uninstalling both apps at once. Both simulators have since been
restored from an existing bundle and 49 stale invites were revoked.

What this means for confidence: the Stage 0 changes are supported by 34 targeted
tests plus full-suite regression, and the ack contract was additionally exercised
live — §3.9 and §3.10 are defects the E2E found that unit tests could not. What is
**not** yet re-confirmed on two real devices is the end-to-end enrolment → create →
modify → conflict → delete chain, which was green before Stage 0 (run 8, 20/20).

Also worth recording as a genuine product gap, distinct from the harness issues: a
device whose control-plane registration is missing while its local ledger still
claims membership has **no recovery path** — it never re-claims and waits on
"Waiting for approval…" indefinitely. Stage 5 bootstrap should close this.

### Operational note

`~/.maestro/tests` reached **28 GB**, leaving 3.7 GB free. A full disk wedges the
simulator into failures indistinguishable from app bugs. Pruned to 1.2 GB (31 GB
free). The runner auto-prunes below 5 GB and aborts below 2 GB.

---

## 8. Where this leaves the architecture

Stage 0 fixed **correctness and security**. It did not change the performance
architecture, which remains the reason the system cannot yet hold years of data:

- `persist()` still re-serializes and re-encrypts the **whole ledger and every op**
  on each mutation — measured **46.72 MB stringified → 93.44 MB written** per
  single-field edit at 5-year scale, 11.6 s on V8 (Hermes 3–8× worse).
- The op log is still never compacted, and is stored **three times**: SQLite BLOBs,
  hex inside the snapshot, and live in memory.
- A new member still cannot bootstrap a household with existing history.

Those are Stages 1–5. Stage 1 (version vector, cursor-bounded push, storm control,
base64 wire) is the one that stops the product dying, and the base64 encoder it
needs is already implemented and tested here.
