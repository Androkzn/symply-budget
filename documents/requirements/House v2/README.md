# Symply House V2 — Requirements Pack

| Field | Value |
|-------|-------|
| **Status** | Canonical for House V2 (local-first) |
| **Last updated** | 2026-08-13 |
| **Owning app** | Symply House (`simple-house` / brand `symply-house`) |

This pack mirrors [Buget v2](../Buget%20v2/README.md). Pre-v2 source material lives in
the live engineering plan; recover older drafts from git history if needed.

## Documents

| Doc | Path | Role |
|-----|------|------|
| **BRD v2.0** | [Symply_House_BRD_v2.0.md](./Symply_House_BRD_v2.0.md) | Business requirements, scope, decision log — **what** and **why** |
| **TRD v2.0** | [Symply_House_TRD_v2.0.md](./Symply_House_TRD_v2.0.md) | Technical architecture and contracts — **how** |
| **Local-first plan (active)** | [house-local-first-implementation-plan.md](./house-local-first-implementation-plan.md) | Current engineering plan. H0–H5, H7-lite, H8, H10 as-built; **code on the branch is the source of truth where they disagree** |
| **Stages H0–H12 record** | [Symply_House_V2_Implementation.md](./Symply_House_V2_Implementation.md) | As-built record of what shipped and what remains. Use this to answer “when and how did this ship?” |

Which implementation doc do I read? Use the **local-first plan** for anything
touching sync, storage, checkpoints, blobs, multi-property, or scale — it is the
live one. Use the **Stages H0–H12 record** to see phase status without the
full design narrative.

Fleet-facing app summaries (not full feature catalogs):

- [documents/apps/symply-house/BRD.md](../../apps/symply-house/BRD.md)
- [documents/apps/symply-house/TRD.md](../../apps/symply-house/TRD.md)
- [documents/apps/symply-house/features/README.md](../../apps/symply-house/features/README.md)

Engineering companions (outside this pack):

- [house-local-first-implementation-plan.md](../../engineering/house-local-first-implementation-plan.md) — stub pointing here
- [house-local-first-scale-baseline.md](../../engineering/testing/house-local-first-scale-baseline.md) — H10 corpus sizes
- [budget-local-first-implementation-plan-v2.md](../Buget%20v2/budget-local-first-implementation-plan-v2.md) — proven engine this pack reuses
- [BUDGET_MULTI_MEMBER_SYNC_E2E.md](../../engineering/testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md) — two-device suite House will port (H12)

## Locked product stance (one paragraph)

Device holds the encrypted household operations ledger (Wave A: tasks, spaces,
appliances, checklists, notes, settings — 21 tables). Cloudflare stores identity,
membership, device keys, signaling, and a **transit-only zero-knowledge mailbox**.
Peers sync via that mailbox (WebRTC later, flag off). Shared User remains the
fleet identity. Soft Transfer stays opt-in summaries. UI stays on today’s House
screens via Proxy facades. Pre-release: greenfield, wipe authorized, no production
data migration. House pays for five things Budget never needed: multi-property
sessions, encrypted attachment bytes, server-compute displacement, widget/watch
plaintext projection, and wide-row LWW containment.

## What is already done (as of 2026-08-13)

| Stage | Status |
|-------|--------|
| H0 enablement (gate, DO, mailbox authz) | Shipped on `main`, fleet deployed |
| H1 ledger core (promoted projection + 21-table registry) | Shipped |
| H2 row storage + DEK | Shipped with H1 |
| H3 Wave A API facades (10 modules / ~117 methods, zero screen edits) | Shipped |
| H4 sync client | Shipped; invite **screen** still owed |
| H5 multi-property session manager | Shipped |
| H7-lite rolling-horizon reminders + widget projection | Shipped (live, not dark) |
| H8 checkpoints / bootstrap / catch-up | Shipped with H4 |
| H10 scale harness + House baseline | Shipped (quiet re-take + Hermes anchor owed) |
| **H6** encrypted blob channel | Design only |
| **H7** remainder (BYOK Housekeeper, cron guards) | Design only |
| **H9** backup / restore / export | Design only |
| **H11** Wave B + Wave C tables | Design only |
| **H12** two-device E2E + brand-default-on | Design only |

## Rejected architectures (do not reintroduce)

| Rejected | Instead |
|----------|---------|
| House stays server-authoritative | Offline + E2EE are confirmed House product requirements (Q0, 2026-08-12) |
| Fork `projection.ts` per brand | Promoted into `@symply/local-first/projection` (Q13) |
| Consented plaintext projection **to the server** (P3) | Not approved. Closed-app push/email digests are P1 in-app or P4 off |
| Budget-style “images stay on capturing device” | House has 25 blob-bearing tables; bytes must sync (H6) |
| Dual-write local + D1 / production migration | Greenfield — testers only; wipe authorized |
| CR-SQLite as the sync engine | Custom operation log (inherited) |
| Pure P2P with no relay | Transit-only ZK mailbox is required |
| Widen `requireBudgetApi` to House | New `localFirstApi` capability |
