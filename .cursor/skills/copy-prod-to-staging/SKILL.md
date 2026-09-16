---
name: copy-prod-to-staging
description: >-
  Copy selected Symply Ecosystem production D1 records into staging, scoped by
  account email. Use when asked to clone, mirror, refresh, or reproduce specific
  user accounts and their related household/app data in staging for debugging.
disable-model-invocation: true
---

# Copy Symply Ecosystem production accounts into staging

Copies records owned by one or more accounts from the production D1 database into
staging. The copy is scoped by account email, so other users' data is left
untouched.

Read first:

1. `AGENTS.md`
2. `documents/ecosystem/SERVICES.md`
3. `documents/ecosystem/RELATIONSHIPS.md`

Load operator credentials before Wrangler commands:

```sh
eval "$(./scripts/secrets/export-env.sh)"
```

Never print secrets, tokens, database dumps, password hashes, or generated SQL
containing sensitive values into chat.

## What it does

- Resolves each seed email -> their households -> all members in both databases.
- Discovers the table/column/foreign-key graph live from production via `PRAGMA`
  (new migrations/tables are picked up automatically — nothing is hard-coded).
- Exports the scoped rows from production and, in `replace` mode, first deletes
  the staging accounts' existing rows using **staging's own ids** (children-first,
  users last) so `INSERT OR REPLACE` doesn't collide on the unique email/oauth
  columns or trip `NO ACTION` foreign keys.
- Writes INSERTs in topological parents-first order. D1 enforces foreign keys
  and does not honor deferral across a batched file import.
- Pulls in any referenced parent row outside the household scope (upward closure)
  so foreign-key integrity holds.

## Excluded by design

- Ephemeral auth/session tables: `refresh_tokens`, `email_verifications`,
  `password_resets` (sensitive, per-device, pointless to clone; login still works
  because the `users` row, password hash, and oauth ids are copied).
- FTS5 virtual/shadow tables (`*_fts`, `*_fts_data`, etc.) are rebuilt by their own triggers.
- R2 files (report PDFs, photos) live in a separate bucket, so images may
  404 in staging. This skill copies D1 records only.

## Usage

Run from the `backend/` directory (so `wrangler.toml` resolves):

```sh
cd backend

# 1) DRY RUN — prints per-table row counts + writes the SQL, no writes to staging
node ../.cursor/skills/copy-prod-to-staging/scripts/copy-d1-scoped.mjs \
  --emails a.tekhtelev@gmail.com,atextel@gmail.com --out /tmp/copy.sql

# 2) APPLY — re-exports fresh and executes DELETE+INSERT against staging
node ../.cursor/skills/copy-prod-to-staging/scripts/copy-d1-scoped.mjs \
  --emails a.tekhtelev@gmail.com,atextel@gmail.com --out /tmp/copy.sql --apply
```

Always dry-run first and review the counts plus any reported dangling FKs.

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--emails <csv>` | (required) | Seed account emails |
| `--apply` | off (dry-run) | Execute against the target |
| `--out <file>` | `copy-prod-to-staging.sql` | Generated SQL path |
| `--mode replace\|upsert` | `replace` | `replace` clears the target's scoped rows first |
| `--source-db` / `--source-env` | `simple-house-db` / `production` | Read from |
| `--target-db` / `--target-env` | `simple-house-db-staging` / `staging` | Write to |

The script refuses to target production. Do not bypass that guard.

## Verify after applying

Compare counts for the copied households between the two databases (D1 caps
`UNION` terms, so use separate statements):

```sh
HH="'id1','id2',..."   # the household ids printed in the run
Q="SELECT COUNT(*) c FROM budget_categories WHERE household_id IN ($HH); \
   SELECT COUNT(*) c FROM expenses WHERE household_id IN ($HH); \
   SELECT COUNT(*) c FROM savings_income_entries WHERE household_id IN ($HH);"
npx wrangler d1 execute simple-house-db         --remote --env production --json --command "$Q"
npx wrangler d1 execute simple-house-db-staging --remote --env staging    --json --command "$Q"
```

## Notes / gotchas

- D1 enforces foreign keys and the file import is atomic: on any failure it rolls
  back and staging is left unchanged, so it is safe to retry.
- If a run fails with `FOREIGN KEY constraint failed`, re-run the dry-run: the
  script prints any dangling references and how many parent rows the upward
  closure pulled in.
- The staging accounts keep the same emails but take on production row ids, so
  testers just log in again with the same credentials.
- This is a staging/debugging operation only. It does not define Soft Transfer,
  app migration, or production data-sharing behavior.
