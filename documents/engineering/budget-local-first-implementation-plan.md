# Budget V2 local-first — detailed implementation plan

> **SUPERSEDED for implementation contracts (2026-08-12).** Canonical plan:
> **[../requirements/Buget v2/budget-local-first-implementation-plan-v2.md](../requirements/Buget%20v2/budget-local-first-implementation-plan-v2.md)**
> (see that file’s Revision History). Keep this file as historical diagnosis +
> Stage 0 narrative. Each item's **Problem**
> section describes the defect *as originally found*; do not treat present-tense Problem text
> as a claim about current code. Stage 2/4/5 design bullets in §0 are preserved in v2 §6–§8.

**Owner:** engineering · **Branch:** `feat/budget-v2-local-first` · **Updated:** 2026-08-12 · **Status:** superseded — see requirements pack

**Goal:** a local-first budget that stays correct and fast for **2–6 household members**
across **5–10 years** of data, on Hermes — where string building and pure-JS crypto run
3–15× slower than V8.

Companion docs
· [budget-local-first-scale-audit.md](budget-local-first-scale-audit.md) — how the problems were found
· [budget-local-first-stage0-implemented.md](budget-local-first-stage0-implemented.md) — Stage 0 as shipped
· [BUDGET_MULTI_MEMBER_SYNC_E2E.md](testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md) — the two-device suite

**How to read this.** Every item follows the same shape: **Problem** (with evidence — a
file:line or a measurement), **Why it matters**, **Fix**, **Benefit**, **Verification**.
Nothing here is aspirational: items marked ✅ are merged and tested, 🔨 are being written
right now, 📐 are specified and queued.

---

## 0. Status dashboard

| Stage | Scope | Status | Evidence |
|---|---|---|---|
| **0** | Correctness & security | ✅ **Shipped** | 34 tests; deployed staging + production |
| **1** | Sync stops dying | 🔨 **Code in tree** | `getVersionVector()` on the store interface; byte-budgeted `listForDevice` + `hasMore` paging; `wasRecentlyWoken()` wake suppression wired into the deposit route; stub mailbox counts deposits **and** wakes so storm control is provable |
| **3** | No lost peer edits, linear bulk | 🔨 **Code in tree** | orphan **parking** in `projection.ts` with an explicit `MAX_PARKED_ROWS` bound and oldest-stamp eviction |
| **6** | Scale harness | 🔨 **Code in tree** | `packages/local-first/__tests__/scale/` — `harness`, `generator`, `batchcap` + snapshots |
| **2** | Row-granular storage | ✅ **Spec complete** | design + 2 adversarial critiques landed — see §6 |
| **4** | Checkpoint + restore | ✅ **Spec complete** | design + 2 adversarial critiques landed — see §7 |
| **5** | Bootstrap, catch-up, compaction | ✅ **Spec complete** | design + 2 adversarial critiques landed — see §8 |

The Stage 2/4/5 design wave finished: **9 agents, 301 tool calls, 1,393,505 tokens, 26.6 min.**
It ran read-only by construction, so it could not collide with the build wave editing the
same checkout.

**Notable design outcomes** (full specs in the workflow output, summarised in §6–§8):

- Stage 2 concluded on **one physical `lf_rows` table**, not 25. Under per-row AEAD the row
  body is an opaque blob, so no projection column is ever queryable — the only predicates are
  `(tbl, row_key)`, `(tbl, bucket)` and `deleted`. Twenty-five tables would buy nothing and
  cost DDL on every `LEDGER_TABLE_KEYS` change. `WITHOUT ROWID` so the key *is* the storage.
- **Windowing by `'YYYY-MM'` bucket**, with `'*'` meaning always-resident. A bad or missing
  date degrades to `'*'` — "loaded eagerly", never "invisible".
- **All tombstones stay resident regardless of bucket.** A tombstone that is not in memory
  cannot absorb, so a peer's re-create would resurrect a deleted row and diverge the
  household silently.
- Projected Stage 2 result: a single-field edit goes from **93.44 MB / 11.6 s** to
  **~1.9 KB logical / ~24 KB physical, flat at 1, 5 and 10 years**.

---

## 1. Decisions that shape everything

These were settled first because each one deletes work downstream.

### 1.1 There is no install base — confirmed twice

```
$ git cat-file -t main:packages/local-first
fatal: path 'packages/local-first' exists on disk, but not in 'main'
```

The subsystem is unmerged, and the product owner confirmed zero users.

**What this buys:** no migration machinery, no dual-format readers, no version-skew
handling, no backward compatibility, no rollback flags. Formats and schemas change
outright. Roughly **4–6 weeks** of work every design proposal had budgeted, deleted.

It also made otherwise-impossible fixes cheap — the natural-key re-key in §2.3 was
previously "patch around it forever"; here it is a two-line key change.

### 1.2 The sync cursor is a version vector, not an HLC watermark

`HybridLogicalClock.format()` is `` `${String(wallMs).padStart(15,'0')}-${counter}-${suffix}` ``
([hlc.ts](../../packages/local-first/src/oplog/hlc.ts)), so HLCs **string-sort by wall
clock first**. A device that has been offline keeps an old `wallMs`, so ops it authors
while away sort *below* the receiver's recent ops — and `WHERE hlc > ?`
([sqlite-store.ts](../../packages/local-first/src/store/sqlite-store.ts)) skips exactly
those.

**Reasoning:** the obvious fix for the sync cap is an `afterHlc` cursor. It would have
shipped **silent data loss** — the ops most likely to be dropped are those from the member
who was away longest. Two independent reviewers found this before any code was written.
The cursor is therefore a version vector over `(device_id, seq)`.

### 1.3 At-rest encryption: per-row AEAD under a SecureStore key

Today's posture is decorative: `encryptionKey: 'your-encryption-key'`
([storage/index.ts:19](../../src/services/storage/index.ts#L19)) ships in every build of all
five apps, and Budget writes its ledger DB key in **plaintext hex** into that same store.

Normally changing an MMKV key orphans all existing data. With no users, we replace it
outright — no `recrypt()` dance.

**Cost accepted:** per-row AEAD adds ~15 µs/row of cipher setup (measured: 11,833 rows
individually = 176.9 ms vs 51.7 ms for the same bytes in one buffer). Mitigated by
windowing reads so the cost is only paid on rows actually loaded.

### 1.4 Restore honours D-20 "live wins"

Documented policy is explicit: *"Restore merges; live data wins on conflict"*
(BRD v2.0 §385), *"Restore vs live | Live wins (D-20)"* (TRD v2.0 §269).

Every proposed restore fix stamped restored rows with a **fresh** HLC, which inverts D-20
into a household-wide destructive rollback. We implement the written spec instead: restored
values are stamped **below** live stamps.

**Product consequence, stated plainly:** a row edited on another device since the backup
will **not** revert. That is what "live wins" means.

### 1.5 Rejected: entityType-scoped diffing

Two designs proposed scoping the diff to the table named in the op descriptor — a ~30 ms
saving. Rejected: `addExpense` declares `entityType: 'expense'` but mutates
`ledger.categories` in place (`cat.usage_count += 1`,
[localBudgetApi.ts](../../src/features/budget/local/localBudgetApi.ts)), so scoping would
**silently drop the category update**. Measured full-table capture+diff is ~38 ms for the
entire 5-year corpus. We are not trading a silent-divergence class for 30 ms.

---

## 2. Stage 0 — correctness & security ✅ SHIPPED

**Why first:** these are defects that lose or expose user data *today*, independent of any
architecture. Shipping them early also meant the E2E suite was exercising the real contract
while later stages were still being designed.

### 2.1 Mailbox ack could destroy another member's mail ✅

| | |
|---|---|
| **Problem** | `ack()` matched `id = ? AND household_id = ?` with **no recipient check**, then **hard-deleted the R2 object**. The route verified only household membership. |
| **Why it matters** | Any member's device could permanently destroy mail addressed to a different device — including the wrapped household-key envelope a joining member is waiting on (`hdkTransfer.ts`), stranding them mid-enrolment. Not a cross-tenant breach, but real data loss. |
| **Fix** | `ack(blobIds, householdId, deviceId)` requires `recipient_device_id = ?`; new `deviceBelongsToUser()` and a **403** unless the device is registered to the caller in `lf_devices`. **R2 delete removed** from the ack path — `sweepExpired()` already reclaims. **Broadcast blobs made un-ackable**: a broadcast is addressed to every peer, so honouring the first ack destroys it for the rest. |
| **Benefit** | Undelivered operations can no longer be destroyed by an unrelated device. Enrolment cannot be sabotaged. |
| **Verification** | 9 tests, incl. "member A cannot ack the HDK envelope addressed to joiner B, but B can". |

The R2-delete and broadcast points were **not in the plan** — the plan's fix relocated the
bug rather than removing it.

### 2.2 Signing in as a second user could hand over the first user's ledger ✅

| | |
|---|---|
| **Problem** | `openLocalBudgetSession` began `if (engine) return engine.ledger;` — **ignoring `input.userId`**. A disk-level different-user guard existed but sat *below* the early return, so it never ran. Both `authStore` call sites are floated promises (`void import(...).then(...)`). |
| **Why it matters** | A fast sign-out/sign-in handed the new user the previous user's household, spending, and sync keys. |
| **Fix** | The early return compares `engine.ledger.memberId === input.userId` and closes+reopens on mismatch; open/close/reset serialized through a promise chain so the two floated promises cannot interleave. |
| **Benefit** | Account isolation no longer depends on teardown winning a race. |
| **Verification** | 4 tests against the **real** function. Confirmed to **fail** when the guard is reverted. |

*Process note:* the first version of these tests used the test helper, which tears down
unconditionally — so they passed without testing anything. Rewritten and re-verified.

### 2.3 Two tables diverged permanently between members ✅

| | |
|---|---|
| **Problem** | `savingsMonthlyTargets` keyed by `period`, `wishAttachments` by `key` — **natural keys with live delete-then-recreate paths**. Clearing a savings target deletes the row; setting it again re-creates the *same* key, which every peer rejects forever because a delete records an **absorbing tombstone**. |
| **Why it matters** | Permanent, silent divergence: two phones showing different numbers, with nothing surfaced to either user. |
| **Fix** | Both re-keyed to a surrogate `id`. Plus `targetsByPeriod()` to resolve concurrent same-period rows identically on every device (newest `updated_at`, tie-break by id), a `__DEV__` throw when a row has no key, and `withSurrogateIds()` to backfill older archives. |
| **Benefit** | The resurrection path is gone at the root, for both tables. |
| **Verification** | 4 tests. Reverting the keys **fails 3 of 4**; the fourth (delete still beats a concurrent edit) passes both ways — proving the re-key did not weaken tombstones. |

### 2.4 Every sync failure looked the same ✅

| | |
|---|---|
| **Problem** | All failures collapsed into one `lastError` string from `error.message`. |
| **Why it matters** | A **permanent** failure was indistinguishable from being briefly offline, so the app kept promising a sync it could no longer perform. Raw system strings could also reach the UI. |
| **Fix** | `classifySyncError()` → 7 typed codes + `isTerminalSyncError()`; the relay returns an explicit **413** with `limit`/`actual`; the banner maps codes to copy and **never renders the raw error**. |
| **Benefit** | Users are told the truth; support can distinguish the cases. |
| **Verification** | 6 tests, incl. "never classifies a terminal failure as offline". |

### 2.5 Oversized op batch: refuse, don't truncate ✅

**Deliberately diverged from the plan.** The plan said cap the batch at 400 ops. But nothing
removes ops from the batch, so that would deposit the same oldest 400 forever while newer
changes silently never left the device — **silent divergence dressed as a healthy sync**,
strictly worse than the failure it replaces. `pushOutbound` now measures the sealed batch and
throws `MailboxPayloadTooLargeError` before uploading.

### 2.6 Encoders ✅

| Operation | Before | After | Gain |
|---|---|---|---|
| `bytesToHex` (32 MB) | 2,825 ms | 2,270 ms | 1.2× |
| `hexToBytes` (32 MB) | 852 ms | **87 ms** | **9.8×** |
| base64 vs hex (32 MB) | 2,825 ms / 100% | 1,133 ms / **67%** | 2× faster, ⅓ smaller |

`bytesToHex` built output with `out +=` **per byte** — slower than the AES-GCM producing the
bytes, with heap churn ~56× input (the OOM cause). The decoder win matters most: it runs on
every cold open. base64 is new and tested (11 tests) but **not yet on the wire** — Stage 1
switches it. *(Since done: `MAILBOX_BATCH_VERSION = 2` ships base64 — see v2 plan §3.4.)*

*Honesty note:* an earlier 2.8× encoder figure was a p50 inflated by GC pressure; min-of-3
shows 1.2×.

### 2.7 Android storage cliff ✅

AsyncStorage defaults to a **6 MB** database and `AsyncStorage_db_size_in_MB` was never set;
`setItem` swallowed write failures and returned `void`; MMKV fallback was logged at
`console.log`. Fixed: 64 MB ceiling, `setItemStrict()` for the ledger and its DB key,
observable MMKV init failure. Tolerant `setItem` retained for the fleet's zustand stores.

### 2.8 WebRTC gated off ✅

`isAvailable()` treated `not_configured` as available and `/v2/turn` returns exactly that, so
**every sync attempted** a transport that sends the whole log in one un-chunked DataChannel
message and dies at ~110 ops. Now behind `EXPO_PUBLIC_BUDGET_P2P=1`.

### 2.9–2.10 Two defects the E2E found that unit tests could not ✅

- **`recipientDeviceId` dropped in the mapping layer** — `fetchMailbox` rebuilt blobs without
  it, so every blob looked like a broadcast, nothing was acked, and the mailbox grew
  unbounded (observed live: `blobs=3`, then `4`). Unit tests covered both halves of the ack
  contract correctly and still missed it, because the defect was in the glue.
- **A failed ack aborted the entire sync** — a device with a lapsed registration got a 403 at
  ack and its *whole* sync was reported as an auth failure, though inbound merge had already
  succeeded. Ack is now best-effort; replay is idempotent.

---

## 3. Stage 1 — sync stops dying 🔨 BUILDING

**Why this is the highest priority stage.** Everything else is about holding years of data
well. This is about the product working *at all*: `pushOutbound` ships the **entire op log**
every sync ([mailbox-engine.ts](../../packages/local-first/src/sync/mailbox-engine.ts) —
`listOperationsByHlc` with no cursor) against a relay capping a deposit at 512,000 base64
chars. At a measured **~853 bytes/op**, sync fails permanently at roughly **450–500 ops** —
a few weeks of ordinary use — and every retry is larger than the last.

### 3.1 Version vector over `(device_id, seq)`

| | |
|---|---|
| **Problem** | No cursor exists; `getCheckpoint` computes a watermark that is never used. |
| **Fix** | Persist a per-peer version vector; a peer's "what I lack" is a vector comparison, not a timestamp scan. |
| **Benefit** | Sends only genuinely-missing ops, and is **sound for offline authors** (§1.2). |
| **Verification** | Convergence tests where one member is offline across many peer writes. |

### 3.2 Cursor-bounded, chunked push

| | |
|---|---|
| **Problem** | One blob carries all history; past the cap every deposit 400s forever. |
| **Fix** | Send only the delta for that peer, split into chunks under `MAILBOX_MAX_CIPHERTEXT_B64`. |
| **Benefit** | **Sync works at any history size.** This is the line between a product that survives and one that dies in week three. |
| **Verification** | Wire-size benchmark asserting max-ops-per-sync before vs after. |

### 3.3 Storm control

| | |
|---|---|
| **Problem** | Every deposit wakes all peers; each woken device unconditionally re-deposits its **full** log, waking the sender. No dirty flag, no debounce, no last-sent watermark. ~45 MB/day/device for 6 devices, to move a handful of expenses. |
| **Fix** | Per-peer sent-watermark + debounce. |
| **Benefit** | Mobile data and battery stop being burned on re-uploading identical bytes. |
| **Risk handled explicitly** | A naive dirty flag **starves a newly-joined peer** — the design must special-case it. |

### 3.4 base64 on the wire

Hex doubles every byte at rest and in transit. base64 is 1.33× and measured 2× faster, so
the same cap carries ~1.5× more history. No install base ⇒ change the format outright, no
dual-decode path.

---

## 4. Stage 3 — no lost peer edits, linear bulk 🔨 BUILDING

**Why now:** these are correctness defects in the merge layer that are independent of
storage, so they can be fixed in parallel with Stage 1 without touching the same files.

### 4.1 Out-of-order delivery silently drops a peer's edit

| | |
|---|---|
| **Problem** | In `applyLedgerDelta`, a `RowDelta` without `n:1` for a row this replica hasn't seen is **discarded**. The comment claims it holds the stamps and waits for the create — nothing is buffered. The op is then marked applied, so `hasOperation` returns duplicate forever and it is **never reconsidered**. |
| **Why it matters** | A member's edit vanishes, silently, permanently, with no conflict recorded. Ordering is not guaranteed by the mailbox, so this is a *when*, not an *if*. |
| **Fix** | Park the orphan patch (shadow row / pending buffer) and apply it when its create lands. Must stay idempotent and must not resurrect tombstoned rows. |
| **Benefit** | Delivery order stops being a correctness dependency. |

### 4.2 `applyLedgerDelta` is quadratic

`.find()` per row, a full array copy per new row, `.find()` + `.filter()` per delete —
**20,000 rows = 8.76 s**. Fixed with a row index built **only above a threshold**: a reviewer
*measured* that an unconditional index is a **10–16× regression** on 1-row deltas (0.027 ms
vs 0.270 ms at 7k rows). Threshold ≥16 rows.

### 4.3 Bulk operations are quadratic overall

N rows → N full capture+diff+persist cycles on a ledger that grows each iteration (AI history
import, `addExpensesBulk`, `applyGoalToYear`, receipt multi-item commits). Batched into one
op where semantics allow, with splitting to stay under the wire cap.

### 4.4 Scalar fast path in `changedFields`

Currently `JSON.parse`s the pre-image per row and `JSON.stringify`s **both sides of every
field**. A fast path is easy — but `JSON.stringify(NaN) === 'null'`, so the current code
treats NaN as equal and a naive `a !== b` causes **unbounded delta churn**. Guarded explicitly.

---

## 5. Stage 6 — the harness that proves everything 🔨 BUILDING

**Why it runs first, not last.** Every later stage claims a performance win. Without a
baseline measured on *this* machine with the *real* code, those claims are unfalsifiable.

Measures at 1/3/5/10-year scale, using the real `projection.ts` and real crypto:
single-field edit (ms **and** bytes written), `applyLedgerDelta` throughput, cold open, and
the op count at which a batch stops fitting under the relay cap. Baseline lands in
`documents/engineering/testing/budget-local-first-scale-baseline.md`, labelled as V8 with the
Hermes multiplier stated.

---

## 6. Stage 2 — row-granular storage 📐 DESIGNING

**The single largest performance win available.**

| | |
|---|---|
| **Problem** | `persist()` hex-encodes payload+signature of **every** op, `JSON.stringify`s the **entire** ledger (25 tables + LWW map + all ops), AES-GCM encrypts in pure JS, hex-encodes again, and writes **one** key. |
| **Measured** | **46.72 MB stringified → 93.44 MB written per single-field edit** at 5 years; 11.6 s on V8 (23.6 s under GC); 4-member variant **OOM-killed node at a 4 GB heap**. Write amplification ~10× over real data, ~500,000× over the ~70-byte semantic delta. Cold open: full snapshot parsed **twice**, every op revived from hex then **discarded**, then an unconditional persist — **10.3 s** before any SQLite work. |
| **Why it matters** | The curve crosses one frame budget at **~2 weeks** of use and one second at **~3 months**. Hermes multiplies by 3–8. |
| **Fix** | Durability unit becomes a **row**. Writes persist only changed rows, driven by the `LedgerDelta` `diffLedger` already produces. `projected_at` on `lf_operations` with op-insert + row-write + cursor advance in **one transaction**, and replay of `WHERE projected_at IS NULL` on open. Per-row AEAD under a SecureStore key, with **windowed** reads. Op ciphertext as BLOB, not hex. |
| **Benefit** | A keystroke costs kilobytes instead of ~93 MB; cold open sub-second; **crash divergence becomes structurally impossible** rather than merely unlikely. |
| **Constraint** | The 88 `mutateLocalLedger` call sites pass **request-shaped** payloads and must keep working unchanged. |

The `projected_at` transaction is the *structural* cure for a real bug: today the projection
only moves forward and never replays the durable journal, so any op whose delta never reached
the snapshot (app killed mid-replay, a failed persist) **can never be applied again**.

---

## 7. Stage 4 — checkpoint + correct restore 📐 DESIGNING

### 7.1 The checkpoint artifact

An encrypted, **chunked**, signed state snapshot at a version-vector watermark carrying the
LWW stamp map. One artifact serving three jobs: new-device bootstrap, months-offline
catch-up, and fast cold open. Chunking is mandatory — it must fit the relay's per-blob cap —
with integrity verification per chunk and across the set. The server stores opaque blobs
only.

### 7.2 Restore is broken two independent ways

| | |
|---|---|
| **Problem A** | `applyLocalLedgerRestore` writes its op with `encodeLedgerOpPayload(op.payload, null)` — no delta — so `decodeLedgerOpPayload` returns null on every peer and the handler returns early. **A restore is invisible to other members: it silently forks the household.** |
| **Problem B** | The restore mutator replaces all 25 tables while leaving `ledger.lww` **entirely unpopulated**. Since `wins(candidate, undefined)` returns true, **any** later peer op — however old — overwrites restored values with no conflict recorded, and absorbing tombstones are lost so deleted rows can be **resurrected**. |
| **Fix** | Propagate restore as a real delta; stamp restored values **below** live stamps per D-20. |
| **Benefit** | Restore converges the household instead of forking it, and cannot silently undo other members' work. |

Also fixed: archive generation builds a string **~7.3×** the raw op bytes (decimal encoding at
3.64×, then outer hex at 2×) before running Argon2id over it.

---

## 8. Stage 5 — bootstrap, catch-up, compaction 📐 DESIGNING

| Item | Problem | Fix |
|---|---|---|
| **Checkpoint publish** | — | Which device, how often, how superseded checkpoints retire; must not stampede |
| **New-member bootstrap** | **Impossible today.** `adoptJoinedHousehold` clears the projection to empty and relies on a peer's full-log push — exactly the call the cap rejects. The member lands on an empty ledger with a sync error and no way forward | Fetch checkpoint chunks + the op tail after its watermark, verify, install |
| **Months-offline catch-up** | No routing exists | Choose op-tail vs checkpoint by how far behind the peer's vector is |
| **Compaction** | Op log never truncated; stored **three times** | Truncate below the checkpoint watermark — **with a proven no-stranding argument** |
| **Recovery gap** | Found in live testing: a device whose control-plane registration is missing while its ledger claims membership **never re-claims** and waits on "Waiting for approval…" forever | Design the re-registration path |
| **Sweep capacity** | 200 blobs / 5 min = 57,600/day across **all** households, and the sweep full-scans (an `OR` defeats the `expires_at` index) | Fix the query and size for checkpoint chunk volume |

**Why bootstrap needs the checkpoint:** replaying every op costs a measured **2.068 ms/op**
(Ed25519 verify + AES-GCM decrypt) — about **83 seconds of blocked crypto** at 40,000 ops.

**Residual risk, stated plainly:** if every peer is uninstalled while one device is offline
past the checkpoint TTL, that device keeps its own state but cannot obtain the household's
later history. No zero-knowledge relay can fix this without the server holding recoverable
data. Mitigation is a product flow — prompt for an encrypted backup when a household drops to
one active device.

---

## 9. How this is being verified

**Per item:** tests for every behaviour changed, and for every bug fixed the test is
**confirmed to fail without the fix** by temporarily reverting it. A regression test never
seen to fail is not evidence — this caught one of my own tests that passed while testing
nothing.

**Per stage:** two independent adversarial reviewers, one on correctness under concurrency
(finding the two-member, one-offline-for-months divergence) and one on Hermes performance at
5–10 years (has the cost merely *moved*?). Reviewers re-run suites themselves rather than
trusting the builder's numbers.

**Per wave:** an integration agent runs the full suites and checks the concurrent stages did
not clobber each other.

**Current baselines to hold:** mobile **580/585 suites, 8,916/8,923 tests**; backend **132
files, 2,930 tests**; `packages/local-first` **24 tests** *(stale — Stage 1 VV + scale suites
since added ~87 tests; recount at Wave 1 exit, see v2 plan §9)*. The 7 mobile failures are
pre-existing and unrelated (4 Health icon-kit brand, 1 flow-completeness from another branch).

**End-to-end:** the two-device / two-account Maestro suite (18 flows) covering enrolment →
create → modify → conflict → delete. It was green before Stage 0 (run 8, 20/20) and is
**pending re-confirmation** — see §11.

---

## 10. Sequencing, and why it is not fully parallel

```
Wave 1 (now)   Stage 1 sync ──┐
               Stage 3 projection ──┤ layer-disjoint, strict file ownership
               Stage 6 harness ──┘
               Stage 2/4/5 design (read-only, concurrent)

Wave 2         Stage 2 storage        needs Stage 1's store schema settled
Wave 3         Stage 4 checkpoint ──┐ needs Stage 2's storage model
               Stage 5 bootstrap ──┘ needs Stage 4's checkpoint
```

Stages 1, 3 and 6 own **disjoint layers** — sync, projection, new test files — enforced by
strict per-agent file ownership (`engine.ts` belongs to Stage 1 only; Stage 3 must *report*
anything it needs there rather than edit it).

Stages 4 and 5 consume Stage 1's version vector and Stage 2's storage model. Building them
against a schema that does not exist yet produces code that compiles against nothing. And two
agents editing `engine.ts` concurrently in one checkout **silently destroy each other** —
worktree isolation is unsafe here because this repo's tooling has been observed deleting
in-progress work when worktrees are removed.

---

## 11. Known open items

1. **Two-device E2E not yet re-confirmed after Stage 0.** Runs 9–15 each stopped on harness
   fragility or test-environment state — *not* on Stage 0 defects. Two were self-inflicted
   (a fast-loop tool minting invites for the wrong household; uninstalling the app from both
   simulators at once, which aborted run 16 at install). Both simulators are restored and 49
   stale invites revoked. Full per-run table in
   [budget-local-first-stage0-implemented.md](budget-local-first-stage0-implemented.md) §7.
2. **Operational:** `~/.maestro/tests` reached **28 GB**, leaving 3.7 GB free. A full disk
   wedges the simulator into failures indistinguishable from app bugs. Pruned to 1.2 GB; the
   runner auto-prunes below 5 GB and aborts below 2 GB.
3. **Effort estimate under revision.** The original plan was 12–15 weeks remaining for one
   engineer. The no-install-base simplifier and parallel execution compress that
   substantially; a revised figure will be based on Wave 1's measured throughput rather than
   a guess.
