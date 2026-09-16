# Symply Budget V2 — Requirements Pack

| Field | Value |
|-------|-------|
| **Status** | Canonical for Budget V2 (local-first) |
| **Last updated** | 2026-08-13 |
| **Owning app** | Symply Budget (`simple-budget` / brand `symply-budget`) |

Every file in this folder is current. There is no "superseded drafts" shelf —
pre-v2.0 source material was merged into the masters below and removed
(recover from git history if ever needed).

## Documents

| Doc | Path | Role |
|-----|------|------|
| **BRD v2.0** | [Symply_Budget_BRD_v2.0.md](./Symply_Budget_BRD_v2.0.md) | Business requirements, scope, decision log — **what** and **why** |
| **TRD v2.0** | [Symply_Budget_TRD_v2.0.md](./Symply_Budget_TRD_v2.0.md) | Technical architecture and contracts — **how** |
| **Local-first plan (active)** | [budget-local-first-implementation-plan-v2.md](./budget-local-first-implementation-plan-v2.md) | Current engineering plan for `@symply/local-first` + mailbox sync. Stages 0–6 as-built; **code on the branch is the source of truth where they disagree** |
| **Phases 0–5 record** | [Symply_Budget_V2_Implementation.md](./Symply_Budget_V2_Implementation.md) | As-built record of the original V2 feature build (local domains, control plane, multi-device sync, resilience). All phases complete — a history of what shipped, not open work |

Which implementation doc do I read? Use the **local-first plan** for anything
touching sync, storage, checkpoints, or scale — it is the live one. Use the
**Phases 0–5 record** only to answer "when and how did this ship?".

Fleet-facing app summaries (not full feature catalogs):

- [documents/apps/symply-budget/BRD.md](../../apps/symply-budget/BRD.md)
- [documents/apps/symply-budget/TRD.md](../../apps/symply-budget/TRD.md)
- [documents/apps/symply-budget/features/README.md](../../apps/symply-budget/features/README.md)

Engineering companions (outside this pack):

- [budget-local-first-scale-audit.md](../../engineering/budget-local-first-scale-audit.md) — how the scale problems were found
- [budget-local-first-stage0-implemented.md](../../engineering/budget-local-first-stage0-implemented.md) — Stage 0 as shipped
- [BUDGET_MULTI_MEMBER_SYNC_E2E.md](../../engineering/testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md) — two-device suite

## Locked product stance (one paragraph)

Device holds the encrypted household ledger. Cloudflare stores identity, membership, device keys, signaling, and a **transit-only zero-knowledge mailbox**. Peers sync via WebRTC plus that mailbox. Shared User remains the fleet identity. Soft Transfer stays opt-in summaries. UI stays close to today’s Budget screens. Pre-release: greenfield, no production data migration.

## Rejected architectures (do not reintroduce)

These were considered and ruled out. Named here so a future reader does not
resurrect them from an old draft or an LLM's memory of one.

| Rejected | Instead |
|----------|---------|
| CR-SQLite as the sync engine | Custom operation log (TRD §7) |
| "No account DB" / local-only identity | Shared User accounts stay (BRD §11) |
| Pure P2P with no relay | Transit-only ZK mailbox is required (BR-046) |
| Production migration from the D1 ledger | Greenfield — testers only |
| Dual-write local + D1 | Device is the single system of record |
