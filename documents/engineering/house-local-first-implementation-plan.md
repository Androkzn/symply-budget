# House V2 local-first — implementation plan (stub)

**The canonical plan lives at
[documents/requirements/House v2/house-local-first-implementation-plan.md](../requirements/House%20v2/house-local-first-implementation-plan.md).**

This file is a pointer only, mirroring how the Budget V2 plan is indexed
(`documents/engineering/budget-local-first-implementation-plan-v2.md` → `documents/requirements/Buget v2/`).

Do not edit the plan here — edit the canonical copy.

## One-paragraph summary

Convert Symply House to the same local-first architecture proven for Budget V2: an on-device
encrypted op-log ledger (`@symply/local-first`), LWW + tombstones, version-vector sync cursors, and
a zero-knowledge Cloudflare mailbox relay. The engine, the wire format, the `/v2` control plane and
the `lf_*` D1 tables are all reusable as-is — the House-specific work is a 21-table Wave-A registry,
~117 API methods behind Proxy facades, and **five subsystems Budget never needed**: multi-property
sessions, an encrypted attachment channel, server-compute displacement for the AI Housekeeper and
cron notifications, a widget/watch plaintext projection, and wide-row LWW containment.

**As of 2026-08-13**, four of those five have landed: multi-property sessions (H5), wide-row
containment (H10/Q12), the widget/watch projection and rolling-horizon reminders (H7-lite), and the
encrypted attachment channel (H6). What remains is the rest of H7 — the BYOK AI ladder, the cron
guards and the P4 member-facing copy — plus H9 (backup/restore/export), H11 (Wave B/C tables) and
H12 (two-device E2E + fleet deploy).

## Related

- [budget-local-first-implementation-plan-v2.md](./budget-local-first-implementation-plan-v2.md) — the pattern source
- [budget-local-first-scale-audit.md](./budget-local-first-scale-audit.md) — how the Budget problems were found
- [budget-local-first-stage0-implemented.md](./budget-local-first-stage0-implemented.md) — Stage 0 as shipped
- [testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md](./testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md) — the two-device suite House will port
