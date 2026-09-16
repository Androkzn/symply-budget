# Implementation Plan — Budget V2 local-first

**Version:** v3.2 · **Owner:** engineering · **Branch:** `feat/budget-v2-local-first`
**Updated:** 2026-08-13 · **Area:** FE + BE (`@symply/local-first`, Budget brand, Worker mailbox)
**Priority:** P0 (sync dies without Stage 1; correctness without Stage 3)

> **✅ Wave-1 blocker found and cleared (v2.6):** the Stage 1 **client** reads `hasMore` from the
> mailbox fetch, but the deployed Worker (staging *and* production, last deploy
> `2026-08-12T18:54:19Z`) predated it — `hasMore` landed in `8bb49d48`, *after* that deploy — so
> `res.data.hasMore === true` was always `false` against live and inbound catch-up stopped after one
> page per sync. **Resolved:** `deploy:fleet` run 2026-08-12; Budget Worker now
> `d74fca18` (staging, 22:29:46Z) / `460db437` (production, 22:30:39Z). See §3.5.0.
> **Standing rule:** the two-device E2E must run against a Worker built from the same commit as the
> client, or it certifies a relay nobody will ship.

**Location:** `documents/requirements/Buget v2/` (canonical). Engineering copy is a stub only.

**Supersedes:** [budget-local-first-implementation-plan.md](../../engineering/budget-local-first-implementation-plan.md)
(Wave-0/1 narrative — keep as historical diagnosis only).

**Goal:** a local-first budget that stays correct and fast for **2–6 household members**
across **5–10 years** of data, on Hermes — where string building and pure-JS crypto run
3–15× slower than V8.

Companion docs
· [budget-local-first-scale-audit.md](../../engineering/budget-local-first-scale-audit.md) — how problems were found
· [budget-local-first-stage0-implemented.md](../../engineering/budget-local-first-stage0-implemented.md) — Stage 0 as shipped
· [BUDGET_MULTI_MEMBER_SYNC_E2E.md](../../engineering/testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md) — two-device suite

**How to read this.** Stages 0 / 1 / 2 / 3 / 4 / 5 / 6 are **as-built** (code on this branch is source of
truth). Every remaining gap has Problem / Fix / Benefit / Verification / DoD.
Status markers: ✅ shipped · 🟢 as-built WIP · 📐 design.

---

## Revision History

| Ver | Date | Changes |
|---|---|---|
| v2.0 | 2026-08-12 | Cycle 1: freeze Stage 0; rewrite 1/3/6 as as-built + contracts; skew/cohort policy; kill-switch; ownership; Stage 3/6 gaps; compaction watermark; Wave 2 Qs. |
| v2.1 | 2026-08-12 | Cycle 2: v1 supersede banner; §3.3 `vvCovers` anti-starvation; Appendix A CHUNK_*; Stage 2 `lf_rows` freeze; Q3 ack semantics; Q8–Q10. |
| v2.2 | 2026-08-12 | Cycle 3: baseline md provisional (not missing); Hermes **3–15×** unified. |
| v2.3 | 2026-08-12 | Cycle 4: remove false Revision History claims from a parallel edit; clarify mutateLocalLedger **78 await / 89 grep**; add deferred research backlog §11.8 (not implemented in body). |
| v2.4 | 2026-08-12 | Cycle 5 parallel merge: research items folded into body — nonce/custody (§1.3), HLC bounds (§1.2), chunk non-atomicity (§3.2), Hermes DoD (§5.1), restore stamp/epoch (§7.2), broadcast-TTL (§8), Q11–Q13, fleet blast (§12); §11.8 → pointer table; Stage 4/5 = design wave done, specs not yet folded. |
| v2.5 | 2026-08-12 | Cycle 5 close: join anti-starvation covered by `sync-storm.test.ts`; §7/§8 headers match dashboard; Appendix B Q1–Q13 + v2.5; recount note for mutateLocalLedger. |
| v2.6 | 2026-08-12 | Cycle 6 re-verification against the tree at `48e48d59`. **New CRITICAL:** deployed Worker predates client `hasMore` (§3.5 / §12). Retired stale "missing test" gaps — `outOfOrderDelivery.test.ts` (11), `bulkOps.test.ts` (12), `applyDeltaScale.test.ts` (13) all exist and pass. Scale baseline confirmed present. Refreshed suite counts (§9). Added Stage 6 fidelity caveats (§5.2) and `MAX_PULL_PAGES` to Appendix A. |
| v2.7 | 2026-08-12 | **Product mandate locked in §1.1:** app never delivered; zero real users; no migration / dual-format / backward-compat debt. Staging+prod Workers and sim DBs are disposable lab state — free to wipe/replace BE. Only quality bar binds (scale, reliability, security, performance, industry practice). |
| v2.8 | 2026-08-12 | §1.1 blast-radius table: confirmed **no user-data limitation** and zero non-Budget `@symply/local-first` importers; sole boundary is the **shared Worker codebase** co-deployed to three live brands. `/v2` mount later confirmed already gated (`requireBudgetApi`). |
| v3.0 | 2026-08-13 | **Wave 3 coded:** Stage 4 restore merge (ancient HLC + real delta) + chunked signed checkpoints; Stage 5 owner publish, bootstrap/catch-up, compaction watermark, mailbox sweep split, HLC 60s drift, seq-regression refuse, auto re-enroll on 403. Q1–Q13 locked in §11. |
| v3.1 | 2026-08-13 | Stage 1 contracts pinned (`appendix-a-contracts` client+Worker); kill-switch unit drill (`flag.test.ts`); Stage 3 revert-proof confirmed + silent parked-row eviction accepted. Two-device E2E still the remaining gate. |
| v3.2 | 2026-08-13 | Two-device Maestro suite **18/18 PASSED** (`reports/budget-multi-member/20260812-195127`). MM sims reinstalled (lab wipe). mm-20 SpringBoard recovery. |

---

## 0. Status dashboard

| Stage | Scope | Status | Evidence |
|---|---|---|---|
| **0** | Correctness & security | ✅ **Shipped** | 34 tests; Worker deployed staging + production — see stage0 companion |
| **1** | Sync cursor + chunked push + wire v2 | ✅ **Verified** | VV, `lf_op_frontier`, `lf_sync_peers`, chunked `pushOutbound`, `MAILBOX_BATCH_VERSION=2`, storm debounce; `sync-storm.test.ts` covers join anti-starvation. Worker `hasMore` deployed (§3.5.0). Contracts pinned. Kill-switch: `flag.test.ts`. Two-device E2E **18/18** `20260812-195127`. MM sims reinstalled 2026-08-13. |
| **3** | Orphan parking, linear apply, bulk | 🟢 **As-built; DoD closed except E2E** | `parkOrphanPatch`, `LEDGER_INDEX_THRESHOLD=16`, `jsonScalarEquals`, `chunkRowsForOp`; `outOfOrderDelivery.test.ts` (11), `applyDeltaScale.test.ts` (14), `bulkOps.test.ts` (12). Revert-proof drill 2026-08-13 (parking no-op → 16 fail; naive NaN `===` re-emits amount). Eviction: **silent drop** of oldest parked rows at `MAX_PARKED_ROWS` |
| **6** | Scale harness | 🟢 **As-built; close gaps** | harness + provisional baseline at `testing/budget-local-first-scale-baseline.md`. Quiet re-take 2026-08-13 (`20260813T035133Z-42882`) recorded 15/16 phases with **no** `SCALE_ALLOW_LOAD` (loadavg 2.38–2.99); `batchcap@10y` refused at 3.07 — not published. Remaining: complete quiet re-take + on-device Hermes anchor |
| **2** | Row-granular storage + SecureStore key | 🟢 **As-built** | `lf_rows` + `projected_at`; per-row AEAD; DEK in SecureStore; tests: `row-store.test.ts`, `rowPersist.test.ts`. Remaining: quiet Stage 6 re-take on the new write path; on-device Hermes anchor |
| **4** | Checkpoint + correct restore | 🟢 **As-built** | Restore merges via `applyLedgerDelta` + `RESTORE_HLC` (`000000000000001-0000-restore`); live stamps and tombstones win (D-20); op payload carries a real delta. Checkpoint: per-chunk HDK AEAD, signed `CheckpointManifest`, opaque R2 blobs (`lf_checkpoint_*`). Tests: `restoreMerge.test.ts`, `checkpoint.test.ts`, `budgetBackup.test.ts`. **Backup file is now the v3 multi-household bundle** (TRD §11.1): one file, one phrase, one section per household, one Argon2 pass; attachment bytes carried under a shared cap (TRD §11.2); v2 archives still restore. Schedule/phrase/destination/retention are device-level again, history stays per household. Tests: `backupBundle.test.ts` (`packages/local-first`), `budgetBackupBundle.test.ts`, `backupAttachments.test.ts`. Household sync E2E green; dedicated checkpoint/restore two-device flow not yet a separate suite |
| **5** | Bootstrap, catch-up, compaction | 🟢 **As-built** | Owner publishes (Q1); join/catch-up installs complete checkpoint then op tail; compact below `min(checkpoint VV, ours, peer knownVVs)`; sweep split queries + 90d/N=3; HLC drift 60s; seq regression throws `SeqRegressionError`; 403 → re-register. Enrolment (mm-03–05) is the live bootstrap path — green in `20260812-195127`. Remaining: quiet Stage 6 re-take |

Wave order (unchanged intent):

```text
Wave 1         Stage 1 / 3 verified  →  two-device E2E 18/18 green (`20260812-195127`)
Wave 2 (now)   Stage 2 storage           coded — see §6
Wave 3 (now)   Stage 4 checkpoint + Stage 5 bootstrap  coded — see §7 / §8
```

---

## 1. Decisions that shape everything

### 1.1 Product mandate — no install base (normative)

```text
$ git cat-file -t main:packages/local-first
fatal: path 'packages/local-first' exists on disk, but not in 'main'
```

**This app has not been delivered to real users.** Confirmed:

| Fact | Implication |
|---|---|
| `packages/local-first` is **not on `main`** | Nothing in the App Store / Play Store runs this stack |
| **Zero real users** (product owner) | No customer data, no upgrade population, no support obligation to old formats |
| Staging / production Workers may already have Stage 0 mailbox code + leftover blobs | That is **lab / fleet infrastructure**, not an install base. Wipe, redeploy, drop tables, replace routes — allowed |
| Simulators / TestFlight / E2E DBs | Disposable. Reinstall / clear data / revoke invites whenever the contract changes |

**Therefore — explicitly out of scope until first real GA cohort:**

- Cross-version **migration** machinery
- **Dual-format** readers / writers
- **Backward compatibility** with any prior wire, SQLite, or MMKV shape
- “Don’t break devices that already synced” constraints
- Soft rollout flags whose only purpose is format coexistence

**What we are free to do (and should, when it improves the quality bar):**

- Delete or replace old BE mailbox / control-plane surface and ship a clean one
- Change `OpBatch` / AEAD / SQLite / projection schemas outright
- Force every lab device to wipe + reinstall after a contract change
- Prefer the correct architecture over patching around a temporary shape

**The one real boundary (verified 2026-08-12) — it is about *shared code*, not about users.**
There is no user-data limitation. There is one blast-radius limitation:

| Surface | Free to delete / rewrite? | Why |
|---|---|---|
| `local-first-v2.ts`, `local-first-mailbox-service.ts`, `lf_*` D1 tables, R2 blobs, `OpBatch`/SQLite/projection schemas | **Yes, entirely** | Budget-only. Each brand has its **own** D1/R2/KV, so dropping Budget's `lf_*` tables cannot touch House/Kaizen/Health data |
| Client `@symply/local-first` consumers | **Yes** | Verified: every importer outside the package lives under `src/features/budget/local/` — zero non-Budget importers |
| Shared Worker plumbing — `backend/src/index.ts`, middleware, error handling, db setup | **No — change deliberately** | One codebase; `npm run deploy:fleet` ships House + Budget + Kaizen + Health together. **Those three are live products.** A regression in shared plumbing reaches their production Workers in the same run |

**Open item this exposes:** `app.route('/v2', localFirstV2Routes)` used to mount
unconditionally. **Closed:** `app.use('/v2', requireBudgetApi())` already 404s the
surface on House / Kaizen / Health (`BUDGET_API_ENABLED=false`).

**The only binding constraints** (non-negotiable):

1. **Scalable** — correct and usable for 2–6 members × 5–10 years of data  
2. **Reliable** — no silent data loss, no household forks, crash-safe durability  
3. **Secure** — E2EE threat model, authz on mailbox, secrets not in plaintext decorative stores  
4. **Performance-efficient** — Hermes-aware; write amplification and sync cost stay bounded  
5. **Industry practice** — version-vector sync cursors, LWW+tombstones, checkpoint+op-tail bootstrap, availability watermarks for compaction, kill-switch for P0 sync — as already chosen in this plan

**Lab hygiene (not “compat”):** when the wire or store contract changes, wipe sims / revoke invites / redeploy Workers so lab state cannot fake a multi-version household. Current tree uses `MAILBOX_BATCH_VERSION = 2` and acks unsupported versions away — that is a clean break, not dual-decode. Kill-switch (§1.6) remains for incident response, not for format coexistence.

### 1.2 Dual clocks: version vector cursor + HLC stamp

| Clock | Job | Never use for |
|---|---|---|
| **Version vector** `{deviceId → contiguous_seq}` | Sync cursor / “what am I missing?” | Conflict winner |
| **HLC string** | LWW stamp / conflict order | Delta query (`WHERE hlc > ?`) |

Actual HLC format (`packages/local-first/src/oplog/hlc.ts`):

```ts
`${String(wallMs).padStart(15, '0')}-${counter.toString(16).padStart(4, '0')}-${deviceSuffix}`
```

(Counter is **hex**, not decimal — plan v1 omitted that.)

Contiguous-prefix rule: an entry is never `MAX(seq)`. A device can relay author D’s seqs 5..7
while 3..4 are missing; claiming 7 would strand those ops forever
(`packages/local-first/src/store/types.ts` — `VersionVector` docstring).

**Open (Wave 2 pre-condition):** HLC receive drift window — see §11 Q8. Not implemented; must
land before treating hostile peers as in-scope.

**Bounds worth one line each:** the counter field is 4 hex digits (**16 bits** — overflow
behaviour at >65,535 ops in one wall-clock ms must be defined, even if only `throw`); the
device suffix is 8 sanitized chars, so LWW tie-breaks have a small but nonzero collision
class — acceptable, but stated.

### 1.3 At-rest encryption: SecureStore key + per-row AEAD (Stage 2)

Today: fleet MMKV still uses decorative `encryptionKey: 'your-encryption-key'`
(`src/services/storage/index.ts:45`); Budget ledger DB key is plaintext hex via storage helpers.

Stage 2 owns the real fix: per-row AEAD under a SecureStore-held key, windowed reads, op
ciphertext as SQLite **BLOB** (not hex). **Android SecureStore is not preserved across
uninstall** — document as acceptable pre-GA given no App Store install base; GA must state
recovery (encrypted backup) explicitly.

**Nonce policy (normative for Stage 2):** AES-GCM nonces are **96-bit random per row-write**
(matches `aead.ts` today). Never derive a nonce from encryptor-chosen fields, never counter-reuse
across processes; random-nonce birthday bound (~2³² messages/key) is far above budget scale but
a **rekey trigger tied to `key_epoch`** must be written down so a later “optimization” cannot
silently introduce nonce reuse. Store `(nonce, ciphertext, tag)` per row.

**iOS key custody:** Keychain entries **persist across app reinstall** (same bundle id) and can
migrate via iCloud restore unless the key is created `WHEN_UNLOCKED_THIS_DEVICE_ONLY` — the
ledger DEK must be device-bound, so use that accessibility class and treat “SecureStore wiped
while SQLite survives” as a detectable state (ciphertext orphan → recovery flow, not a crash).
**Key recovery when all devices are lost** is the same product gap as §8 residual risk —
encrypted-backup escrow; owner must be named before GA.

### 1.4 Restore honours D-20 “live wins”

BRD v2.0 §385 / TRD v2.0 §269: restore merges; **live data wins**. Restored values are stamped
**below** live stamps — not with a fresh HLC (that would invert D-20 into a household-wide
rollback).

**Canonical precedence:** TRD v2.0 D-20 overrides older TRD v1.4 “restore wins over delete”
wording. Wave 3 restore implementation follows v2.0 only.

### 1.5 Rejected: entityType-scoped diffing

`addExpense` declares `entityType: 'expense'` but mutates `ledger.categories`
(`usage_count += 1` via `bumpCategoryUsage` in `localBudgetApi.ts`). Scoping the diff would
silently drop category updates. Full-table capture+diff stays.

### 1.6 Kill switch & ops runbook (P0)

| Flag | Meaning | Default |
|---|---|---|
| `EXPO_PUBLIC_BUDGET_LOCAL_FIRST` | `1` on / `0` off / unset → on for `symply-budget` only | on for Budget brand (`src/features/budget/local/flag.ts`) |
| `EXPO_PUBLIC_BUDGET_P2P` | WebRTC transport | off unless `=1` |

**Disable sync mid-incident (client cohort):**

```bash
# EAS / env: force remote API path for next OTA / rebuild
EXPO_PUBLIC_BUDGET_LOCAL_FIRST=0
```

**Verify:** Budget app uses remote `src/api/budget.ts` paths; no mailbox deposits from that build.
**Revert:** unset or `=1`, redeploy OTA/build.
**Mid-stream:** in-flight sync may finish or fail once; new sessions honour the flag at process start.
**Mailbox drain:** addressed blobs TTL 14 days (`MAILBOX_TTL_MS` in mailbox service); sweep reclaims.
**Do not** rely on Worker-only kill for client deposits without also flipping the client flag —
clients will keep retrying.

**Unit drill (2026-08-13):** `src/features/budget/local/__tests__/flag.test.ts` — `=0` is off,
`=1` is on. Full OTA/rebuild remains the incident path above; the test pins the flag cannot
silently invert.

---

## 2. Stage 0 — correctness & security ✅ SHIPPED (historical)

Do not re-implement. Full narrative + file:line evidence:
[budget-local-first-stage0-implemented.md](../../engineering/budget-local-first-stage0-implemented.md).

Shipped highlights (still load-bearing):

| ID | Fix |
|---|---|
| 0.1 | Mailbox ack requires `recipient_device_id`; `deviceBelongsToUser` → 403; R2 delete removed from ack; broadcasts un-ackable |
| 0.2 | `openLocalBudgetSession` compares `memberId`; open/close serialized |
| 0.3 | `savingsMonthlyTargets` / `wishAttachments` re-keyed to surrogate `id` |
| 0.4 | `classifySyncError` (7 codes) + banner never shows raw errors; relay **413** |
| 0.5 | Oversized full-log push refused (`MailboxPayloadTooLargeError`) — **superseded as primary path by Stage 1 chunking**; keep as safety net |
| 0.6 | Encoder rewrite; base64 module landed (wire switch is Stage 1) |
| 0.7–0.10 | Android 64 MB + `setItemStrict`; WebRTC gated; `recipientDeviceId` mapping; ack best-effort |

**Exit debt still open:** two-device E2E not re-confirmed after Stage 0 (§11).

---

## 3. Stage 1 — sync stops dying 🟢 AS-BUILT

### 3.0 Wire & store contracts (frozen)

**OpBatch v2** — `packages/local-first/src/sync/batch.ts`:

```ts
export const MAILBOX_BATCH_VERSION = 2;

export type OpBatch = {
  v: typeof MAILBOX_BATCH_VERSION; // must be 2
  householdId: HouseholdId;
  senderDeviceId: DeviceId;
  senderSigningPublicKeyB64: string;
  senderVersionVector: VersionVector; // on EVERY batch, including receipts
  ops: SerializedStoredOperation[];   // payloadB64 + signatureB64
};
```

**Constants** — `packages/local-first/src/sync/mailbox-engine.ts`:

| Constant | Value | Role |
|---|---|---|
| `MAX_MAILBOX_CIPHERTEXT_B64` | `512_000` | Client deposit budget (matches BE `MAILBOX_MAX_CIPHERTEXT_B64`) |
| `CHUNK_FILL_RATIO` | `0.98` | Leave headroom under cap (also in Appendix A) |
| `CHUNK_START_OPS` | `256` | Initial chunk probe (also in Appendix A) |
| `MIN_PUSH_INTERVAL_MS` | `5_000` | Storm debounce |
| `SENT_VV_TTL_MS` | `12 * 24 * 3600_000` | Optimistic sent-VV expiry (&lt; 14d blob TTL) |

**SQLite** — `SQLITE_MIGRATION_V1` in `packages/local-first/src/store/types.ts`:

- `lf_op_frontier(household_id, device_id, contiguous_seq)`
- `lf_sync_peers(household_id, peer_device_id, known_vv, sent_vv, sent_at, last_push_at, last_receipt_vv)`
- Unique index `ops_household_device_seq` (replaces device-global `ops_device_seq`)

**SyncPeerState** fields: `knownVv`, `sentVv`, `sentAtMs`, `lastPushAtMs`, `lastReceiptVv`.

**BE names:** route constant is `MAILBOX_MAX_CIPHERTEXT_B64`; client export is
`MAX_MAILBOX_CIPHERTEXT_B64`. Same value; document both — do not rename casually.

### 3.1 Version vector over `(device_id, seq)` ✅ in tree

| | |
|---|---|
| **Was** | No cursor; full-log push every sync |
| **Now** | `getVersionVector` / `listOperationsSince` / `hasOperationsSince`; peer state persisted |
| **Gap** | Contiguous-prefix + `advanceVvWithOps` stop at holes is implemented; **normative gap re-request protocol** (who asks whom, wire shape, relay retention) is **not** chosen — see §11 Q9 |
| **Verification** | `packages/local-first/__tests__/version-vector.test.ts` (8 cases) |

### 3.2 Cursor-bounded, chunked push ✅ in tree

| | |
|---|---|
| **Was** | One blob = entire history → permanent 400/413 past ~450–500 ops at ~853 B raw/op under 512k b64 chars |
| **Now** | `pushOutboundDetailed` → delta vs effective VV → `sealChunks` under budget; wake only on last chunk |
| **Arithmetic** | Cap is **base64 chars**. If 853 is **raw ciphertext bytes**, b64 ≈ 1140 chars/op → `512000/1140 ≈ 449` ops/blob (pre-chunk). Chunking removes the hard death. |
| **Atomicity (stated)** | A multi-chunk push is **not atomic** and does not need to be: `sentVv` advances per delivered chunk (resume point), each op is independently signed and idempotently applied, and a peer holding only a prefix is merely *behind*, never *inconsistent*. No “set complete” marker exists — anything that later assumes atomic catch-up (e.g. checkpoint install) must NOT reuse this path unmodified. |
| **Verification** | `stage1-wire-size.bench.test.ts`, `scale/batchcap.*` |

### 3.3 Storm control ✅ in tree

| | |
|---|---|
| **Now** | `MIN_PUSH_INTERVAL_MS` + per-peer storm gate in `mailbox-engine.ts`: skip push only when `vvCovers(effective, myVv)` **and** within the debounce window. A peer with an **unknown / empty** VV can never be covered by a non-empty local frontier, so joiners are **not** skipped. |
| **Also on join** | `clearSyncPeerStates(previousHouseholdId)` in `adoptJoinedHousehold` (`engine.ts`) — **cross-household hygiene** (drop peer rows for the ledger being left). This is **not** the anti-starvation mechanism for a newly joined peer in the shared household. |
| **Verification** | `packages/local-first/__tests__/sync-storm.test.ts` — includes `does NOT starve a newly joined peer…` (asserts `vvCovers` gate, not `clearSyncPeerStates`) |

### 3.4 base64 on the wire ✅ in tree

`payloadB64` / `signatureB64`; no dual-decode. Unsupported `v` → `UnsupportedBatchVersionError` →
ack addressed blob (avoid 14-day refetch loop).

### 3.5 Stage 1 remaining gaps (must close)

#### 3.5.0 Worker redeploy — was CRITICAL, ✅ resolved 2026-08-12

Found via `wrangler deployments list --env staging`: the newest staging deployment was
`066c42d8` created **2026-08-12T18:54:19Z** — the Stage 0 deploy. Every Stage 1 relay change landed
**after** it, in `8bb49d48`. The client and relay had silently diverged.

| Capability | Deployed Worker | Tree (`8bb49d48`+) | Consequence of the skew |
|---|---|---|---|
| `hasMore` in `GET /mailbox` | **absent** | returned (`local-first-v2.ts:323`) | Client tests `res.data.hasMore === true` (`controlPlaneClient.ts:339`) → always `false` → pull loop breaks after page 1 (`mailbox-engine.ts:488`). Catch-up needs one `syncOnce` per page instead of up to `MAX_PULL_PAGES` |
| Byte-budgeted paging (`listForDevice`) | count-only `LIMIT 100` | 25 blobs + 4 MB budget | Large chunked catch-up can return an oversized response |
| `wake` honoured + `SYNC_WAKE_COALESCE_MS` | ignored; always wakes | coalesced (`:177`, `:262`) | Client sends `wake:false` on non-final chunks, but live relay wakes every peer per chunk — a multi-chunk push becomes the wake storm Stage 1 §3.3 exists to remove |

**This is a deployment-order defect, not a code defect** — the tree is self-consistent. Backend
source typechecks clean (remaining `tsc` errors are pre-existing `?raw` test-only imports).

**Why it was not silent data loss:** blobs are only acked once applied, so a truncated page is
re-fetched next cycle. It was a throughput/latency and wake-amplification bug, not divergence.

**Resolution (2026-08-12).** 29 backend local-first tests green (`local-first-mailbox-paging`,
`-ack`, `-wake-coalesce`, `-sync-wake`, `budget-local-first-gate`), backend source typechecks clean,
then `eval "$(./scripts/secrets/export-env.sh)" && cd backend && npm run deploy:fleet`.

| Worker | Env | Version | Deployed (UTC) |
|---|---|---|---|
| `simple-budget-api-staging` | staging | `d74fca18` | 2026-08-12T22:29:46Z |
| `simple-budget-api` | production | `460db437` | 2026-08-12T22:30:39Z |

House / Kaizen / Health redeployed in the same fleet run (shared Worker codebase — see §12 fleet
blast radius).

**Standing rule this exposed.** Client and relay live in one repo but deploy on different clocks, so
"the backend is already deployed" is only true for the commit it was deployed from. Before any E2E
run, confirm the deployed Version ID postdates the newest `backend/src` commit on the branch. This
class of skew is invisible to every test suite — unit tests import the tree, not the deployment.

1. Two-device E2E green on v2 wire (§11).
2. Lab wipe after the wire change (§1.1 hygiene): reinstall sims, revoke stale invites — no mixed hex-era/v2 devices in any test household.
3. Confirm `MailboxPayloadTooLargeError` remains unreachable from happy-path chunked push but still
   maps to sync error UI if a single op somehow exceeds cap.

### 3.6 Stage 1 Definition of Done

- [x] All §3.0 contracts match exports (no silent constant drift) — `appendix-a-contracts.test.ts` (client + Worker)
- [x] `version-vector.test.ts` + wire-size + batchcap + `sync-storm.test.ts` green
- [x] Join/starvation test present (`sync-storm.test.ts`)
- [x] Two-device Maestro suite green on this branch — **18/18 PASSED** `documents/engineering/testing/reports/budget-multi-member/20260812-195127` (create/modify/conflict/delete + BR-044)
- [x] All lab devices wiped/reinstalled on wire v2 — Budget Dev Client rebuilt and installed on Budget-A + Budget-B 2026-08-13 before the green run
- [x] Kill-switch drill documented once (§1.6) — runbook + `flag.test.ts`

---

## 4. Stage 3 — no lost peer edits, linear bulk 🟢 AS-BUILT

### 4.0 Constants (frozen)

| Constant | Value | File |
|---|---|---|
| `MAX_PARKED_ROWS` | `2000` | `src/features/budget/local/projection.ts` |
| `LEDGER_INDEX_THRESHOLD` | `16` | same |

### 4.1 Orphan patch parking ✅ in tree

| | |
|---|---|
| **Was** | `RowDelta` without create (`n:1`) for unseen row discarded; op marked applied → never reconsidered |
| **Now** | `parkOrphanPatch` + apply when create lands; eviction at `MAX_PARKED_ROWS`; must not resurrect tombstones |
| **Gap (v2.5)** | ~~No unit test asserts park / apply / tombstone-absorbs-park / eviction.~~ **Closed in v2.6** — `outOfOrderDelivery.test.ts` landed with 11 cases, all green. |
| **Durability** | Parking lives in `ledger.lww[table][key].p`, so it is **persisted with the snapshot**, not RAM-only — the round-trip is asserted. Residual: a crash between `applyLedgerDelta` and the next `persist()` loses parking while the op is already marked applied. Same class as any unpersisted ledger mutation; **Stage 2's single-transaction `projected_at` replay is the structural cure** (§6). |
| **Eviction** | At `MAX_PARKED_ROWS` the oldest-stamped parked rows are dropped **silently** (no conflict recorded). Bounded, but still edit loss under an orphan storm. See exit note below. |

**Coverage as built** — `src/features/budget/local/__tests__/outOfOrderDelivery.test.ts`:

| Test | Asserts |
|---|---|
| `applies a patch that arrived before its create` | edit before create applies after the create lands |
| `lets a tombstone absorb a parked patch` | parked edit does **not** resurrect a deleted row |
| `is idempotent when the parked patch is delivered twice` | re-delivery is a no-op |
| `bounds parked rows and still replays one that survived` | park count never exceeds `MAX_PARKED_ROWS` |
| `survives a persist/reload JSON round trip` | parking is durable, not in-memory only |
| `is indistinguishable from in-order delivery` | full ledger / lww / conflicts equality vs the in-order path |
| + 5 more | multi-field merge, same-field LWW among parked, conflict-id parity, older-losing tombstone, real-`OpLog` over-the-wire case |

**Revert-proof (2026-08-13):** making `parkOrphanPatch` a no-op failed 16 of the suite (create-before-patch
still passed). Do not weaken the `amount: 7500` assertion — that is the lost-edit detector.

**Eviction (Wave-1 lock):** silent drop of oldest parked rows. A conflict would claim a peer still
holds the patch; they do not — the create never arrived. Bounded loss under an orphan storm is
accepted until GA. Recorded on `evictOldestParked` in `projection.ts`.

### 4.2 Indexed apply above threshold ✅ in tree

Index path only when touched rows ≥ `LEDGER_INDEX_THRESHOLD` (unconditional index measured
10–16× regression on 1-row deltas). Strategy is chosen **once per table per delta** via
`planTableStrategy` + a lazy cursor map — not per row.

**Guarded (v2.6)** by `applyDeltaScale.test.ts`: `scans below the threshold and indexes at it`,
`decides per table, so a big expenses delta does not index a 1-row table`, and
`produces the same rows, order, lww and conflicts either way` — so the fast path cannot silently
diverge from the indexed path.

### 4.3 Bulk ops packed ✅ in tree

`chunkRowsForOp` used from `localBudgetApi` (`addExpensesBulk`), `localRegisteredApi`,
`confirmSavingsImport`; `applyGoalToYear` emits a single op for up to 12 months. All four call
sites named in plan v1 §4.3 are batched, covered by `bulkOps.test.ts` (12 cases, incl. the
receipt/history-grid route through `addExpensesBulk` and a 500+500-row chunked import that
converges on a peer).

**Layered budget, deliberately not the wire cap:** `MAX_OP_DELTA_BYTES = 64_000` /
`MAX_OP_DELTA_ROWS = 250` are *plaintext* budgets, ~4× inside the 512 000 base64 deposit cap after
AEAD. They are **not** derived from `MAILBOX_MAX_CIPHERTEXT_B64` — that is intentional layering,
but it means chunk sizing is a JSON row estimate, not a sealed-op measurement. Stage 1's
`sealChunks` is the authoritative cap enforcement (it re-seals and shrinks on overshoot).

**Remaining:** none — audit table below.

| Call site | File | Packed? |
|---|---|---|
| `addExpensesBulk` | `localBudgetApi.ts` | yes — `chunkRowsForOp` |
| `applyGoalToYear` | `localBudgetApi.ts` | yes — one op / year |
| registered apply / import | `localRegisteredApi.ts` | yes — `chunkRowsForOp` |
| `confirmSavingsImport` | `confirmSavingsImport.ts` | yes — `chunkRowsForOp` |
| recurring propagate | `localSavingsApi.ts` | yes — `chunkRowsForOp` |
| Other `mutateLocalLedger` sites | various | single-row / small — no bulk packing needed |

### 4.4 Scalar fast path + NaN guard ✅ in tree

`jsonScalarEquals` — `JSON.stringify(NaN) === 'null'` must not cause unbounded churn; naive
`!==` must not treat NaN inequality as a perpetual delta. Non-finite numbers compare against
`null` to match stringify semantics; `Date` / nested objects / arrays fall through to the
`JSON.stringify` slow path.

**Test landed (v2.6)** — `applyDeltaScale.test.ts`: `does not churn on NaN, ±Infinity or -0`
and `matches the stringify comparator across every value shape`.

### 4.5 Stage 3 Definition of Done

- [x] Orphan tests + NaN test green (`outOfOrderDelivery.test.ts` 11, `applyDeltaScale.test.ts` 14)
- [x] Confirmed to fail when parking / NaN guard reverted (§9 revert rule) — 2026-08-13 drill; sibling-field NaN case in `applyDeltaScale.test.ts` (stringify pre-check hid the naive revert)
- [x] Bulk call-site audit table committed (even if “none remaining”)
- [x] Decide: parked-row eviction silently drops edits — **accept and document** (Wave-1); conflict recording deferred to GA
- [x] No Stage 3 edits to `mailbox-engine.ts` without Stage 1 owner ack (see §10)

---

## 5. Stage 6 — scale harness 🟢 AS-BUILT

**Why Wave 1:** later stages claim performance wins; without a machine-local baseline those
claims are unfalsifiable.

**In tree:** `packages/local-first/__tests__/scale/` (phases: coldopen, edit, apply, batchcap).
The temp `zzScaleBench.test.ts` cited in earlier revisions is **gone** — it is not in the tree.

**Baseline artifact:**
[`documents/engineering/testing/budget-local-first-scale-baseline.md`](../../engineering/testing/budget-local-first-scale-baseline.md)
— **exists, provisional.** Run `20260812T221332Z-24118` was captured with
`SCALE_ALLOW_LOAD=1` (loadavg &gt; 3) on a **dirty** working tree. Do not quote as DoD-clean
until re-taken on a quiet machine with a clean tree. Hermes multiplier in that file: **3–15×**
(string / pure-JS crypto) — same as this plan’s goal line.

### 5.1 Harness fidelity — what the numbers do and do not cover

The harness is honest but not end-to-end. Cite it with these caveats or the numbers overclaim.

| Element | Real or faked | Consequence for a claim |
|---|---|---|
| `projection.ts` (`captureLedgerSnapshot`, `diffLedger`, `applyLedgerDelta`) | **Real import** | Projection numbers are trustworthy |
| AES-GCM | **Real** (`@noble/ciphers`) | Encrypt cost is real |
| **Ed25519 signatures** | **Faked** (`pseudoBytes`) | Sizes/persist timings fine; **verify cost is unmeasured** — the ~2.068 ms/op figure behind the 83 s bootstrap estimate (§8) is *not* validated here |
| `persist()` / `saveEncryptedSnapshot` / `reviveOps` / `normalizeLedger` | **Mirrored** in `scale/lib/mirror.ts` (product modules pull RN-only aliases) | Drift risk; `mirror-guard.test.ts` pins SHA-256 of the extracted product source, so product edits break the build — but it does **not** catch edits to the mirror itself, nor any `projection.ts` change |
| Cold open | **Snapshot path only** — SQLite journal branch excluded | `coldopen.total` understates real cold open |
| Bytes written | In-memory hex length, no AsyncStorage/MMKV I/O | Logical, not physical, write cost |
| Runtime | **V8 (Node)**, not Hermes | Hermes multiplier is a stated 3–15×, *not* a measurement — hence the on-device anchor in the DoD below |

Corpus generation is **deterministic** (`mulberry32`, `DEFAULT_SEED = 0x5c41e`), with per-table
field sets and JSON sizes pinned by snapshot, so run-to-run deltas are real signal.

**Isolation:** phases are `*.scale.ts` and excluded from the default vitest include, so they cannot
land in normal CI. The temp `zzScaleBench.test.ts` exception is **gone** (not in tree as of 2026-08-13).

### 5.2 Stage 6 Definition of Done

- [x] Baseline markdown path published (provisional numbers landed)
- [ ] Quiet-machine re-take: no `SCALE_ALLOW_LOAD`, clean git tree; regenerate via
      `scripts/e2e/lib/budget-scale-bench.sh` + `budget-scale-report.mjs`
      — **partial 2026-08-13:** 15/16 phases ok on `20260813T035133Z-42882`; `batchcap@10y`
      load-gated at 3.07. Machine stayed noisy (Budget Metro :8082). Do not publish holes.
- [ ] Cover edit ms + bytes, `applyLedgerDelta` throughput, cold open, max ops under cap
- [ ] Environment labelled (machine, Node/V8, heap) — already in provisional file; keep on re-take
- [x] Hermes multiplier stated as **3–15×** lower-bound disclaimer (not a separate 3–8× band) — in the generated baseline md
- [ ] **One on-device Hermes anchor** (cold open + single edit on a real/simulated device build)
      before any Stage 2 performance claim is treated as a ship gate — a stated multiplier alone
      is directional, not evidence

---

## 6. Stage 2 — row-granular storage 🟢 AS-BUILT

**Was (pre-Stage-2 persist):** full-ledger `JSON.stringify` + hex op payloads + AES-GCM + hex
write → **~46.72 MB → ~93.44 MB** per single-field edit at 5 years. That path is gone.

**Now:**

| Piece | Where |
|---|---|
| One `lf_rows` table (`WITHOUT ROWID`) | `SQLITE_MIGRATION_V1` |
| `projected_at` on `lf_operations`; replay `WHERE projected_at IS NULL` on open | `sqlite-store.ts` / `engine.ts` `replayUnprojected` |
| Per-row AEAD, 96-bit random nonce stored separately from ciphertext | `row-aead.ts`; engine seals before `putRows` |
| DEK in SecureStore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | `persistence.ts` (`budget.localFirst.dek.v1`) |
| Windowing `'YYYY-MM'` / `'*'`; tombstones always listed | `rowBucket` + `listRows({ buckets })` |
| Op-insert + row-write + `markProjected` in one transaction | `mutateLocalLedger` → `runInTransaction` |
| `mutateLocalLedger` call sites | **unchanged** (request-shaped payloads) |

Cold open loads identity + rows; it does **not** re-persist the whole ledger. UI still holds
all loaded rows in memory (window filter is on the store API; default load is every bucket
until screens are month-scoped). Re-measure via Stage 6 (`edit.scale.ts` now seals changed
rows, not the 93 MB snapshot).

### 6.0 Design freeze (still normative)

| Decision | Rule |
|---|---|
| **Physical table** | **One** `lf_rows` table — not 25. Under per-row AEAD the body is opaque; predicates are only `(tbl, row_key)`, `(tbl, bucket)`, `deleted`. Twenty-five tables buy nothing and cost DDL on every `LEDGER_TABLE_KEYS` change. Prefer `WITHOUT ROWID` so the key *is* the storage. |
| **Windowing** | Bucket by `'YYYY-MM'`; `'*'` = always-resident. Bad/missing date **degrades to `'*'`** (loaded eagerly), never “invisible”. |
| **Tombstones** | **All tombstones stay resident regardless of bucket.** A tombstone not in memory cannot absorb → peer re-create would resurrect and diverge silently. |
| **Projected win** | Single-field edit **93.44 MB / 11.6 s → ~1.9 KB logical / ~24 KB physical**, flat at 1 / 5 / 10 years (re-measure via Stage 6 — quiet re-take still required). |

---

## 7. Stage 4 — checkpoint + correct restore 🟢 AS-BUILT (v3.0)

### 7.1 Checkpoint artifact

Encrypted, **chunked**, signed snapshot at a version-vector watermark + LWW stamp map
(row envelopes already carry LWW). Serves: new-device bootstrap, months-offline catch-up.
Server stores opaque blobs only (`lf_checkpoint_manifests` / `lf_checkpoint_chunks` + R2).

**Manifest (as shipped):**

```ts
type CheckpointManifest = {
  v: 1;
  householdId: string;
  generation: number;
  versionVector: VersionVector;
  chunkCount: number;
  rootHash: string;          // sha256(concat(sha256(chunk_i)))
  signerDeviceId: DeviceId;
  signatureB64: string;
};
```

Per-chunk AEAD AAD `lf-checkpoint:${householdId}:${generation}:${index}:${count}`.
Install is atomic: every chunk + valid signature + matching root hash, or nothing.
Must **not** reuse multi-chunk mailbox push (non-atomic by design).

Publisher: **Owner only** (Q1). Retain last **3** generations, **90d** TTL (Q6).

### 7.2 Restore (D-20) — as shipped

| | |
|---|---|
| **Stamp** | `RESTORE_HLC = '000000000000001-0000-restore'` (wall ms = 1). Any real live HLC wins. |
| **Delta** | `restoreDeltaFromBackup` diffs backup tables onto live, **strips deletes** (live-only rows stay), applies via `applyLedgerDelta`. |
| **Tombstones** | Live `meta.del` absorbs restore creates — no resurrection. |
| **Wire** | `BACKUP_RESTORE` ops carry `encodeLedgerOpPayload({ restoreEpoch, … }, chunk)` — peers apply the same merge. Chunked with `chunkLedgerDelta`. |
| **Archive** | `BACKUP_ARCHIVE_VERSION = 2` (base64 ciphertext). Snapshot omits ops/crypto (no 7.3× blow-up). Lab-only; no dual-format. |

Tests: `restoreMerge.test.ts` (live edit + tombstone), `budgetBackup.test.ts` (payload has delta).

---

## 8. Stage 5 — bootstrap, catch-up, compaction 🟢 AS-BUILT (v3.0)

| Item | As shipped |
|---|---|
| **Checkpoint publish** | Owner only, after mailbox sync, when ≥100 ops past last checkpoint VV |
| **New-member bootstrap** | Empty local VV → fetch latest complete checkpoint, verify, install rows, `setAuthorBaseline`, mailbox op tail |
| **Months-offline catch-up** | If lag ≥ **500 ops** (Q10) **or** last sync ≥ **14d** with lag > 0 → checkpoint+tail. Skip if checkpoint is behind our own device seq |
| **Compaction** | `compactOperations` deletes seq ≤ `min(checkpoint VV, ours, every peer knownVv)`. `nextSeq` is `max(MAX(seq), frontier)+1` so compaction cannot burn seqs |
| **Recovery gap (Q5)** | 403 from control plane → `syncLocalHouseholdToControlPlane()` (POST devices) then retry |
| **Sweep** | Two indexed queries (`expires_at <= ?` and `acked_at IS NOT NULL`), limit 500; checkpoint sweep in the same cron |
| **HLC drift (Q8)** | `applyRemote` rejects `hlc_drift` if wall > now + **60s** |
| **Seq regression (Q13)** | `OpLog.append` throws `SeqRegressionError` if any peer `knownVv[self] > localMax` |
| **Device id (Q12)** | Never reused; reinstall mints a new one. Retired ids stay out of compaction via missing peer VV → min 0 |
| **Crypto (Q11)** | Stay **pure-JS** (`@noble/*`) — no quick-crypto vs SQLCipher `libcrypto.so` |
| **Gap fill (Q4/Q9)** | Origin-only: version-vector `listOperationsSince` **is** the gap protocol. Relay does not retain for gap-fill |
| **Ack (Q3)** | Keep **per-recipient ack + 14d TTL** |
| **Tombstone GC (Q2)** | Retain tombstones in the snapshot until compaction watermark (all active peers have passed) |
| **Biometric (Q7)** | Deferred |

**Broadcast TTL vs offline window (rule):** broadcasts are un-ackable and expire at the mailbox
TTL (14d). Any peer offline longer than the TTL **will** miss broadcasts — that is by design and
must be *covered*, not prevented: everything durable must be reachable via addressed resend
(`SENT_VV_TTL_MS` = 12d &lt; 14d keeps the optimistic watermark inside the blob lifetime) or via
checkpoint+tail catch-up. No correctness-bearing state may exist **only** in a broadcast.

**Residual risk:** if every peer is uninstalled while one device is offline past checkpoint TTL,
that device cannot obtain later history without recoverable server data. Mitigation: prompt for
encrypted backup when household drops to one active device.

**Crypto cost note:** ~2.068 ms/op verify+decrypt → ~83 s at 40k ops (`2.068 × 40000 = 82720 ms`)
— why bootstrap needs checkpoints.

---

## 9. Verification strategy

**Per item:** tests for every behaviour changed; for every bug fix, confirm the test **fails
without the fix** by temporary revert.

**Per stage:** two adversarial reviewers (concurrency correctness; Hermes/perf displacement).

**Baselines — re-measured 2026-08-12 at `48e48d59` (v2.6):**

| Suite | Stage 0 ship | Measured now | Command |
|---|---|---|---|
| `packages/local-first` | 24 tests | **105 passed, 2 skipped (17 files)** | `npx vitest run` in `packages/local-first` |
| Budget local (mobile subset) | not tracked | **175 passed, 27 suites** | `npx jest src/features/budget/local` |
| Mobile (whole repo) | 580/585 suites, 8,916/8,923 | not re-run this cycle | 7 failures were pre-existing / unrelated |
| Backend | 132 files, 2,930 tests | not re-run this cycle | — |

**Caveat on measuring a moving tree:** the first `jest src/features/budget/local` run this cycle
reported 3 failures in `bulkOps.test.ts`; a re-run after the file settled gave 175/175. The file was
being written concurrently. **Any suite count taken while build agents are committing is a
snapshot, not a gate** — the Wave-1 exit numbers must be taken on a quiet, clean tree.

**End-to-end:** 18-flow two-device Maestro suite — green before Stage 0 (run 8, 20/20); **pending
re-confirmation** on this branch (§11).

---

## 10. File ownership & sequencing

Wave-1 “strict disjoint layers” was aspirational and **already violated**. Normative ownership:

| Area | Primary owner files | May touch with ack |
|---|---|---|
| Stage 1 sync | `packages/local-first/src/sync/**`, `store/sqlite-store.ts`, `store/memory-store.ts`, `store/types.ts`, `sync/batch.ts` | `engine.ts` (peer clear on join), `controlPlaneClient.ts`, `httpControlPlane.ts`, `orchestrator.ts` |
| Stage 3 projection | `src/features/budget/local/projection.ts` | `localBudgetApi.ts`, `localRegisteredApi.ts`, `localSavingsApi.ts`, `confirmSavingsImport.ts` |
| Stage 6 harness | `packages/local-first/__tests__/scale/**` | read-only imports from production code |
| Stage 0 BE (frozen) | `backend/src/routes/local-first-v2.ts`, `backend/src/services/local-first-mailbox-service.ts` | only for Stage 5 sweep/checkpoint |

**Rule:** if Stage 3 needs a sync change, file an issue for Stage 1 owner — do not silently edit
`mailbox-engine.ts` from a projection agent.

Worktree isolation remains unsafe in this repo (tooling has deleted in-progress work on
worktree removal) — coordinate in one checkout via the table above.

---

## 11. Known open items

1. **Two-device E2E green** — 18/18 PASSED `20260812-195127` after SpringBoard recovery (`budget-relaunch-if-backgrounded.yaml`). Prior mm-20 failures were iOS-26 `openLink`/`hideKeyboard` backgrounding the Dev Client, not missing UI.
2. **Maestro disk:** `~/.maestro/tests` previously hit 28 GB; runner must auto-prune (&lt;5 GB warn,
   &lt;2 GB abort).
3. **Stage 3 correctness tests** — closed. `outOfOrderDelivery.test.ts`, `applyDeltaScale.test.ts`, `bulkOps.test.ts` exist; revert-proof drill 2026-08-13.
4. **Scale baseline markdown** provisional only — quiet re-take still required (§5.1).
5. **Fetch ACL asymmetry:** ack is device-scoped; fetch is household-membership only. With shared
   HDK this is peer-visible ciphertext anyway — document as accepted for Wave 1; revisit if
   device-private envelopes appear.
6. **Effort estimate** under revision from Wave 1 measured throughput.
7. **Wave 2 product forks — locked in v3.0:**

| # | Question | Lock |
|---|---|---|
| Q1 | Checkpoint publisher | **Owner** |
| Q2 | Tombstone GC after compaction | Retain until all active peers pass the watermark |
| Q3 | Mailbox ack vs TTL | **Per-recipient ack + 14d TTL** |
| Q4 | Sequence gap fill | Origin-only re-send via version vector |
| Q5 | Re-registration | **Auto re-enroll** existing device_id if control-plane row missing but ledger claims membership |
| Q6 | Checkpoint generations | Last **N=3**, **90d** TTL |
| Q7 | Biometric gate | Deferred |
| Q8 | HLC receive drift | Reject if wall > now + **60s** |
| Q9 | Gap re-request protocol | `listOperationsSince(have)` **is** the protocol; relay does not retain for gap-fill |
| Q10 | Catch-up routing | **500 ops OR 14 days** behind peer VV → checkpoint+tail |
| Q11 | Native crypto | Stay **pure-JS** |
| Q12 | Device lifecycle | **Never reuse device_id**; retired ids must leave active VVs |
| Q13 | Seq regression | If peer VV for own id > local seq → **refuse to author** (`SeqRegressionError`) until a fresh device_id |

### 11.8 Research-pass items — where each now lives

These came up in `/review-plan` research passes. Most are now written into normative sections;
the pointers below are the single source of truth (the decisions themselves remain **open**
where marked Q):

| Item | Status |
|---|---|
| AEAD nonce uniqueness policy | §1.3 (normative for Stage 2) |
| iOS Keychain / Android SecureStore custody + key-recovery UX | §1.3; recovery owner still unassigned — GA blocker |
| HLC counter overflow / device-suffix collision | §1.2 bounds note; overflow behaviour still to define |
| Multi-chunk deposit atomicity | §3.2 — stated as deliberately **non**-atomic; checkpoint install must not reuse the path unmodified |
| On-device Hermes anchor | §5.1 DoD (required before Stage 2 perf ship gate) |
| Restore stamp-function + restore-epoch freeze | §7.2 design-freeze requirement |
| Broadcast TTL vs longest offline window | §8 rule — no correctness-bearing state broadcast-only |
| Native crypto on sync hot path | §11 Q11 — decide before Stage 2 code |
| Device retirement / ghost VV entries | §11 Q12 |
| Seq regression / fork policy | §11 Q13 |
| Fleet blast radius + brand-isolation invariant | §12 (CI grep suggested); Budget local-first must also not alter House/Kaizen/Health MMKV posture |
| Stage 4/5 full design-wave writeups | **Still missing from this doc** — fold in before Wave 3 code (§0 dashboard flags it) |

---

## 12. Deployment order (Wave 1 exit → Wave 2)

```text
1. ✅ DONE 2026-08-12 — Worker redeployed (fleet) so live BE matches the tree, incl.
   hasMore (§3.5.0): budget staging d74fca18 / production 460db437.
2. ✅ Stage 2 storage coded (v2.9) — wipe Budget sims after this contract change
3. ✅ Wave 3 Stage 4/5 coded (v3.0) — restore merge, checkpoints, bootstrap/catch-up
4. Close remaining Stage 1/3/6 DoD (quiet baseline re-take on the *new* write path)
5. Run two-device E2E to green against a Worker built from the same commit
```

**Lab note (not a user-compat rule):** a mixed-format mailbox in the lab is noise — wipe it.
There are no real users to migrate. Prefer a clean break over dual-decode.

Environments: `top-level` (local) / `staging` / `production`. Deploy Worker with
`wrangler deploy --env staging|production` (Budget wrangler config). Never `--env dev`.

**Fleet blast radius:** the mailbox routes ride the shared Worker codebase; `npm run deploy:fleet`
ships House + Budget + Kaizen + Health together (staging then production). Relay changes therefore
reach four production Workers at once. Invariant to keep (worth a CI grep): **no non-Budget brand
imports `@symply/local-first` or calls `/v2/households/*/mailbox`** — as long as that holds, a bad
relay change degrades only Budget sync, not other brands. (Other brands are live products;
Budget local-first is not — do not confuse fleet co-deploy with Budget user install base.)

Control-plane DDL lives under `backend/migrations/` when we keep Drizzle history; we may also
replace tables outright under §1.1. Local SQLite DDL is client-side `SQLITE_MIGRATION_V1`
(rebuild / wipe lab DBs freely).

---

## 13. Monitoring (minimal Wave 1)

| Signal | Where |
|---|---|
| Sync terminal errors | client `classifySyncError` codes + banner |
| Relay 413 | Worker logs / client `payload_too_large` |
| Kill switch | `EXPO_PUBLIC_BUDGET_LOCAL_FIRST=0` (§1.6) |
| Mailbox growth | existing control-plane counts; watch unacked addressed blobs |
| Disk / Maestro | prune policy (§11.2) |

Stage 5 adds sweep lag + checkpoint publish failure alarms.

---

## 14. Alternatives considered (stay on custom stack)

| Alternative | Why not |
|---|---|
| Automerge / Yjs | Document CRDT; memory/tombstone growth; wrong boundary for financial op audit log |
| ElectricSQL / PowerSync | Postgres-shaped backend; conflicts with Cloudflare-only + E2EE relay |
| DO-authoritative op log | Breaks zero-knowledge relay threat model |

Architecture stays: LWW + tombstones + op log + encrypted R2 mailbox + version-vector cursors.

---

## Appendix A — Identifier registry

| Identifier | Value / location |
|---|---|
| `MAILBOX_BATCH_VERSION` | `2` — `packages/local-first/src/sync/batch.ts` |
| `MAX_MAILBOX_CIPHERTEXT_B64` | `512_000` — client `mailbox-engine.ts` |
| `MAILBOX_MAX_CIPHERTEXT_B64` | `512_000` — BE `local-first-v2.ts` |
| `CHUNK_FILL_RATIO` | `0.98` — `mailbox-engine.ts` |
| `CHUNK_START_OPS` | `256` — `mailbox-engine.ts` |
| `MIN_PUSH_INTERVAL_MS` | `5_000` — `mailbox-engine.ts` (no jitter; fixed window) |
| `MAX_PULL_PAGES` | `8` — `mailbox-engine.ts`; inbound pages per `syncOnce`. Larger catch-ups need multiple cycles |
| `SYNC_WAKE_COALESCE_MS` | `10_000` — BE `local-first-v2.ts` |
| `SENT_VV_TTL_MS` | `12d` (&lt; mailbox TTL 14d) |
| `MAX_OP_DELTA_BYTES` / `MAX_OP_DELTA_ROWS` | `64_000` / `250` — `projection.ts`; **plaintext** bulk-chunk budget, deliberately independent of the wire cap (§4.3) |
| `MAX_PARKED_ROWS` | `2000` |
| `LEDGER_INDEX_THRESHOLD` | `16` |
| `EXPO_PUBLIC_BUDGET_LOCAL_FIRST` | client kill / path gate |
| `EXPO_PUBLIC_BUDGET_P2P` | WebRTC gate (default off) |
| Mailbox TTL | 14 days (`MAILBOX_TTL_MS`); TRD v2.0 also ≤14d — Q3 is all-device ack vs per-recipient |
| `lf_rows` | Stage 2 single physical table (design freeze §6.0) |
| Branch | `feat/budget-v2-local-first` |

---

## Appendix B — What changed from plan v1 (review-plan)

1. Dashboard matches working tree (1/3/6 as-built, not “spec complete”).
2. §1.1 product mandate: zero real users → no migration / dual-format / backward-compat; quality bar only (v2.7).
3. HLC format corrected (hex counter); encryptionKey line → `:45`.
4. OpBatch / VV / SQLite / constants published as frozen contracts.
5. Kill-switch runbook added.
6. File ownership table reflects real touch sets.
7. Stage 3 + Stage 6 concrete DoD gaps (tests + baseline md).
8. Compaction availability watermark + Wave 2 open questions (Q1–Q13).
9. Deployment order + lab wipe hygiene (not user-compat).
10. Ephemeral “22 agents running” process noise removed.
11. **v2.1–v2.5:** contracts, Stage 2 freeze, research fold, storm tests (see Revision History).
12. **v2.7:** §1.1 product mandate locked — zero users, free to replace BE, quality bar only.
