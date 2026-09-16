# Health V2 local-first — implementation plan (stub)

**The canonical plan lives at
[documents/requirements/Health v2/health-local-first-implementation-plan.md](../requirements/Health%20v2/health-local-first-implementation-plan.md)
(v1.8, 🟢 as-built engine — not `ready`).**

This file is a pointer only, mirroring House and Budget.

Do not edit the plan here — edit the canonical copy.

## One-paragraph summary

Convert Symply Health from D1 + MMKV-outbox to the same local-first architecture proven
for Budget V2 and reused by House Wave A: on-device encrypted op-log (`@symply/local-first`),
LWW + tombstones, version-vector cursors, zero-knowledge mailbox. Health-specific work is a
**personal** (one user, N devices) household, a Proxy/repository cutover of the existing
`health*Storage` modules, HealthKit as an ingest adapter, and on-device summaries (today
computed on the Worker). Family/community stays disabled. Soft Transfer of the ledger stays
denied.

**2026-08-14:** Wave A engine is on `health-v2`. D1 + outbox are still SoT. He3 cutover,
He10 scale, and He12 E2E are not started.

## Related

- [Health v2 README](../requirements/Health%20v2/README.md)
- [Symply_Health_V2_Implementation.md](../requirements/Health%20v2/Symply_Health_V2_Implementation.md)
- [house-local-first-implementation-plan.md](./house-local-first-implementation-plan.md)
- [budget-local-first-implementation-plan-v2.md](./budget-local-first-implementation-plan-v2.md)
- [testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md](./testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md)
