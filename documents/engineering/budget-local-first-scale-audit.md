# Budget V2 local-first — scale audit and build plan

**Date:** 2026-08-12 · **Branch:** `feat/budget-v2-local-first` · **Status:** Stage 0 shipped, Stages 1–6 pending

Goal: support **2–6 household members** and **5–10 years** of data on Hermes, where
string building and pure-JS crypto run 3–15× slower than V8.

Companion docs: [Symply_Budget_TRD_v2.0.md](../requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md) ·
[Symply_Budget_V2_Implementation.md](../requirements/Buget%20v2/Symply_Budget_V2_Implementation.md) ·
[BUDGET_MULTI_MEMBER_SYNC_E2E.md](testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md)

---

## 1. Headline

**This did not break in years. It broke in weeks.**

`pushOutbound` ships the **entire op log** on every sync — `listOperationsByHlc()`
with no cursor ([mailbox-engine.ts](../../packages/local-first/src/sync/mailbox-engine.ts)) —
against a relay that caps a deposit at 512,000 base64 chars. At a measured
~853 B/op, sync returns a permanent error at roughly **450–500 ops**, and every
retry is larger than the last. It surfaced as a generic status string
indistinguishable from being offline.

The two-device Maestro suite passed throughout because a test household holds
~100 ops.

## 2. What is CORRECT and must be preserved

The merge layer is sound and proven, by
`src/features/budget/local/__tests__/multiMemberSync.test.ts` and by a
two-device / two-account Maestro suite in which both devices independently
converged on the same value:

- Per-field LWW by HLC with author-id tie-break (TRD §8.4)
- Tombstone absorbing — delete beats a concurrent edit, discarded edit recorded
- Concurrent creates both kept
- Conflict surfacing (BR-044) as the mitigation for LWW's inherent loss
- Idempotent replay
- Zero-knowledge relay; the device is the system of record

**Any redesign keeps these observable behaviours identical and changes
everything beneath them.**

## 3. Findings

Measured by nine independent agents reading the real code; every load-bearing
claim re-verified by hand at file:line. Reference household: 5 years, 2 adults ≈
11,833 rows / 17,750 ops. Four-member variant ≈ 24,703 rows / 39,525 ops.

### Fixed in Stage 0

| # | Finding | Evidence |
|---|---|---|
| B8 | Mailbox `ack` checked household membership but **not recipient**, and hard-deleted the R2 object — any member's device could destroy mail addressed to another, including the wrapped-HDK enrolment envelope | `local-first-mailbox-service.ts` |
| B9 | `openLocalBudgetSession` early-returned the open ledger **ignoring `userId`**; both authStore call sites are floated promises, so a fast re-login handed user B user A's ledger | `engine.ts`, `authStore.ts` |
| B6 | `savingsMonthlyTargets` (`period`) and `wishAttachments` (`key`) were keyed by **natural keys** with live delete-then-recreate paths; the re-create was rejected on every peer forever while the author kept the row | `projection.ts`, `localSavingsProjector.ts` |
| B10 | Android `AsyncStorage` DB defaults to **6 MB** and was unset; write failures swallowed with `console.warn` — silent data loss | `android/gradle.properties`, `services/storage/index.ts` |
| B11 | WebRTC always attempted (`/v2/turn` returns `not_configured`, treated as available) while sending the whole log in one un-chunked DataChannel message — fails at ~110 ops | `sync/webrtcPeer.ts` |
| B1 | Every failure collapsed into one string, so a **terminal** failure read as "offline" | `sync/orchestrator.ts` |

### Open — addressed by Stages 1–5

| # | Finding | Magnitude |
|---|---|---|
| B1 | Full-log push vs the 384 KB cap | permanent failure at ~450–500 ops |
| B2 | **No bootstrap.** A new device cannot receive a household's history — `adoptJoinedHousehold` clears to empty and relies on the full-log push the cap rejects | any real history |
| B3 | **Sync storm.** Every deposit wakes all peers, each of which unconditionally re-deposits its full log, waking the sender. No dirty flag, no watermark, no debounce | ~45 MB/day/device at 6 devices |
| B4 | Out-of-order delivery **silently drops** a peer's edit: a RowDelta for an unseen row is discarded, then marked applied, so it is never reconsidered | intermittent, now |
| B5 | Backup restore writes `delta: null`, so peers project nothing, and leaves `lww` empty so any later op overwrites restored values — **restore forks the household** | any restore |
| B7 | Projection only moves forward and never replays the durable journal, so any op whose delta never reached the snapshot can never apply | app kill mid-replay |
| C12 | `persist()` re-serializes and re-encrypts the **whole ledger + whole op log** per mutation | see below |
| C17 | **No compaction.** Ops stored three times: SQLite BLOBs, hex in the snapshot, live in memory | 82% of every write is immutable history |
| C18 | LWW watermark map unbounded — 6.1 MB at 5 years vs 3.0 MB of actual rows | grows past the data |
| C19 | Cold open parses the full snapshot **twice**, revives every op from hex, discards them, then persists | 10.3 s at 5-year scale |

### Measured cost of a single-field edit

| Scale | Stringified | Written | Time (V8) |
|---|---|---|---|
| 1 year | — | 7.09 MB | ~1.0–2.8 s |
| 5 years | 46.72 MB | 93.44 MB | 11.6 s (23.6 s under GC) |
| 4 members | 102.90 MB | 205.79 MB | 34 s, OOM at a 4 GB heap |

Write amplification is ~10× over the real data and ~500,000× over the ~70-byte
semantic delta. The curve crosses one frame budget at **~2 weeks** of use and one
second at **~3 months**. Hermes multiplies by 3–8.

### Encoding

`bytesToHex` built its output with `out +=` per byte — 3,442 ms for 17.5 MB
(slower than the AES-GCM that produced it) with heap churn ~56× the input, which
is what pushed large ledgers into OOM.

| | Old | New | |
|---|---|---|---|
| `bytesToHex` (32 MB) | 2,825 ms | 2,270 ms | 1.2× |
| `hexToBytes` (32 MB) | 852 ms | 87 ms | **9.8×** |
| base64 vs hex (32 MB) | 2,825 ms / 100% | 1,133 ms / **67%** | 2× faster, ⅓ smaller |

## 4. Decision

**Checkpointed op-log on row-granular SQLite.** Keep the merge algebra. Change:

1. **Row-granular persistence** — the unit of durability becomes a row, not the ledger.
2. **Version vector over `(device_id, seq)`** as the cursor.
3. **Chunked encrypted checkpoint** serving bootstrap, months-offline catch-up and cold open.

### Why a version vector, and not an HLC watermark

`HybridLogicalClock.format()` is
`` `${String(wallMs).padStart(15,'0')}-${counter}-${deviceSuffix}` ``
([hlc.ts](../../packages/local-first/src/oplog/hlc.ts)), so HLCs **string-sort by
wall clock first**. A device that has been offline keeps an old `wallMs`, so ops
it authors while away sort *below* the receiver's recent ops — and a
`WHERE hlc > ?` cursor ([sqlite-store.ts](../../packages/local-first/src/store/sqlite-store.ts))
skips exactly them.

**A scalar HLC watermark is unsound as a sync cursor.** Fixing the 384 KB cap the
obvious way — an `afterHlc` cursor — would have shipped silent data loss.

### Why not the alternative designs

- **State-CRDT without an op log** scored highest but computes row digests over
  *stamp sets*, not values, so two replicas holding different data produce
  identical digests: its own anti-entropy backstop is blind to the divergence it
  introduces. Today's bug loses data loudly; that one loses it while reporting
  "converged."
- **entityType-scoped diffing** is rejected: `addExpense` declares
  `entityType: 'expense'` and mutates `ledger.categories` in place
  (`cat.usage_count += 1`, [localBudgetApi.ts](../../src/features/budget/local/localBudgetApi.ts)),
  so scoping would silently drop the category update. Measured full-table
  capture+diff is ~38 ms for the whole 5-year corpus — not worth a
  silent-divergence class.

### No install base

`git cat-file -t main:packages/local-first` → does not exist. The subsystem is
unmerged, so there is **no production install base**. That deletes all
cross-version migration machinery every proposal had budgeted (~4–6 weeks) and
makes the natural-key re-key affordable instead of impossible.

## 5. Stages

| Stage | Scope | Estimate | Status |
|---|---|---|---|
| 0 | Correctness & security; no format or protocol change | 1 wk | **shipped** |
| 1 | Version vector, cursor push, storm control, base64 wire | 2 wk | next |
| 2 | Row-granular SQLite, `projected_at`, cold open | 3–4 wk | |
| 3 | Orphan parking, row index, bulk + op splitting, diff fast path | 1–2 wk | |
| 4 | Checkpoint build/load/verify, restore | 3 wk | |
| 5 | Publish, bootstrap, catch-up routing, compaction | 2–3 wk | |
| 6 | Verification, digest diagnostic, load tests | 1 wk | |

**Total 13–16 weeks**, one engineer undivided.

What ships when:

- **Stage 1** — sync works at any history size. *This is the stage that stops the product dying.*
- **Stage 2** — a keystroke costs 2 KB instead of 93 MB; cold open sub-second; crash divergence structurally impossible.
- **Stage 3** — out-of-order peer edits never lost; bulk imports linear.
- **Stage 4** — restore converges the household instead of forking it.
- **Stage 5** — a new member can join a household with years of history; a phone left in a drawer catches up.

## 6. Decisions that need a product call

1. **At-rest encryption posture.** Today's is a placebo: the ledger DB key is
   written in plaintext hex into a store whose MMKV instance uses the literal
   `encryptionKey: 'your-encryption-key'`, identical in every install of all five
   apps, and which silently falls back to unencrypted AsyncStorage. Options:
   per-row AEAD under a SecureStore key (~1–2 s Hermes cold open at 5 years),
   per-table page encryption (faster, coarser), or plaintext + OS file protection.
   **Blocks Stage 2.** Note MMKV cannot open an existing store under a new key —
   any change needs `recrypt()` on first launch, or it orphans every user's data
   across all five apps.
2. **Bootstrap trust model.** A joiner accepts one peer's *signed merged view*
   rather than re-deriving from ~40,000 individually-signed ops (83 s of blocked
   Ed25519). Not a new trust boundary — every member already holds the HDK — but a
   compromised member could hand a joiner a fabricated history in one shot.
3. **Retention and dormancy.** Proposed: 180 days dormant, 30-day minimum
   retention, 90-day checkpoint TTL. Residual risk: if every peer is uninstalled
   while one device is offline past the TTL, that device keeps its own state but
   cannot obtain later history. No zero-knowledge relay can fix this; mitigation
   is prompting for an encrypted backup when a household drops to one active
   device — a product flow.
4. **Restore semantics — urgent.** Policy is explicit: *"Restore merges; live data
   wins on conflict"* (BRD v2.0 §385), *"Restore vs live | Live wins (D-20)"* (TRD
   v2.0 §269). But stamping restored rows with a fresh HLC — which every proposed
   fix does — inverts D-20 into a household-wide destructive rollback. Choose:
   (a) honour D-20, stamping restored values *below* live stamps, so restore
   cannot bring back anything edited since the backup; or (b) switch to
   restore-wins with a confirmation UI naming what will be overwritten.
   **The current code does neither — it forks the household. Blocks Stage 4.**
5. **Single-device household bootstrap.** With no peer there is no checkpoint
   source; the joiner falls back to the encrypted device backup. Should a backup
   be *required* before an invite can be issued?

## 7. Stage 0 — what shipped

| Fix | Change | Tests |
|---|---|---|
| B8 | `ack(blobIds, householdId, deviceId)` with `recipient_device_id` match; route verifies the device belongs to the caller via `lf_devices.user_id`; **R2 delete removed** from the ack path (`sweepExpired` reclaims); **broadcast blobs are not ackable** — acking one recipient would destroy them for the rest | 9 |
| B9 | User-aware early return + open/close/reset serialized through a promise chain | 4 |
| B6 | Both tables re-keyed to surrogate `id`; `targetsByPeriod()` resolves concurrent same-period rows deterministically (newest `updated_at`, tie-break by id); `__DEV__` throw when a row has no key | 4 |
| B1 | `classifySyncError` → typed codes; relay returns explicit **413**; banner maps codes to copy and never renders the raw error | 6 |
| B1b | `pushOutbound` **refuses** an oversized batch (`MailboxPayloadTooLargeError`) rather than truncating — truncating would deposit the oldest N ops forever while newer changes silently never sync | — |
| B10 | `AsyncStorage_db_size_in_MB=64`; `setItemStrict` for the ledger and its DB key so a dropped write throws instead of returning `void`; MMKV init failure recorded and warned | — |
| B11 | WebRTC gated behind `EXPO_PUBLIC_BUDGET_P2P=1` | — |
| C13a | Chunked table-driven `bytesToHex`, ~10× faster `hexToBytes`, new `crypto/base64.ts` (no wire change yet) | 11 |

Verified: **580/585 mobile suites, 8,916/8,923 tests**; backend **132 files /
2,930 tests**. The 7 failures are pre-existing and unrelated (4 Health icon-kit
brand mismatch, 1 flow-completeness gap from another branch). Regression tests
for B9 and B6 were confirmed to **fail** when the fix is reverted.
