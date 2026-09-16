# Launch zero-user audits

Archived Appendix A query results for Data Bridge launch gates.

| File | Env | Notes |
|------|-----|--------|
| `20260715T025421Z-production.jsonl` | production | House/Budget/Kaizen |
| `20260715T0255*Z-staging.jsonl` | staging | if present |

## Production snapshot (2026-07-15)

| Worker | users (not deleted) | active refresh | platform_* rows |
|--------|---------------------|----------------|-----------------|
| House | 26 | 42 | 0 |
| Budget | 4 | 3 | 0 |
| Kaizen | 4 | 3 | 0 |

**Launch rule:** public `platformRegistrationEnabled` stays **false**. Existing rows are treated as synthetic/test until an explicit reviewed cleanup; do not invent identity remaps. Re-run:

```bash
./scripts/engineering/launch-zero-user-audit.sh production
```
