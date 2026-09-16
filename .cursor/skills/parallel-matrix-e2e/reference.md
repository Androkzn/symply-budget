# Parallel Matrix E2E — Reference

## Fleet isolation map

| Brand | Simulator | Metro | App id | Suite runner |
|-------|-----------|------:|--------|--------------|
| house | House-A | 8083 | `com.symply.house` | `scripts/e2e/run-house-suite.sh` |
| budget | Budget-A | 8082 | `com.symply.budget` | `scripts/e2e/run-budget-suite.sh` |
| kaizen | Kaizen-A | 8081 | `com.symply.kaizen` | `scripts/e2e/run-kaizen-suite.sh` |
| language | Language-A | 8084 | `com.symply.language` | `scripts/e2e/run-language-suite.sh` |
| health | Health-A | 8085 | `com.symply.health` | `scripts/e2e/run-health-suite.sh` |

Metadata: `scripts/e2e/maestro-fleet-brand.sh`.

## Parallel env (always for this skill)

```bash
export E2E_PARALLEL_FLEET=1
export E2E_DEDICATED_SIM=0
export E2E_MAESTRO_LOCK=0
export E2E_MAESTRO_CLEANUP=0
```

## Scripts

| Script | Role |
|--------|------|
| `scripts/e2e/preflight-fleet-parallel.sh` | Sims + Metro + app install check; auto-create missing iPhone sims |
| `scripts/e2e/run-fleet-parallel.sh` | Launch many brand suites in parallel (runs preflight) |
| `scripts/e2e/run-<brand>-suite.sh` | Single-brand suite (isolation-safe when parallel env set) |
| `scripts/e2e/maestro-scoped-kill.sh <brand>` | Reset **one** brand only |
| `scripts/e2e/generate-results-from-logs.py` | Rebuild/update `RESULTS_YYYY-MM-DD_<app>.md` from Maestro logs |

### Metro start

```bash
npm run start:kaizen   -- --port 8081
npm run start:budget   -- --port 8082
npm run start:house    -- --port 8083
npm run start:language -- --port 8084
npm run start:health   -- --port 8085
```

### Seed

```bash
eval "$(./scripts/secrets/export-env.sh)"
npm run test:e2e:seed:fleet
```

### RESULTS regen

Positional CLI (no `--help`):

```bash
# argv: [date] [env] [device] [app...]
python3 scripts/e2e/generate-results-from-logs.py \
  "$(date +%Y-%m-%d)" staging "Health-A, iOS 26.5" health
```

House/Budget/Health pick known log globs under `/tmp` and `.tmp`; other apps use `/tmp/maestro-<app>-<date>.log`. After regenerating, manually patch Notes for RCA and keep Fail→Pass only when retest observed. Prefer **incremental edits** to today’s RESULTS during a campaign; full regen is a merge aid, not a license to wipe Pass marks.

## Matrix sources

| App | Matrix | Typical RESULTS |
|-----|--------|-----------------|
| platform | `matrices/platform.md` | `RESULTS_YYYY-MM-DD_platform.md` |
| house | `matrices/house.md` | `RESULTS_YYYY-MM-DD_house.md` |
| budget | `matrices/budget.md` | `RESULTS_YYYY-MM-DD_budget.md` |
| kaizen | `matrices/kaizen.md` | `RESULTS_YYYY-MM-DD_kaizen.md` |
| language | `matrices/language.md` | `RESULTS_YYYY-MM-DD_language.md` |
| health | `matrices/health.md` | `RESULTS_YYYY-MM-DD_health.md` |

Contract: `matrices/COVERAGE_CONTRACT.md`.

## status.md template

Write to `.tmp/e2e-logs/matrix-<app>-YYYY-MM-DD/status.md` every 5 minutes:

```markdown
# Matrix E2E status — <app> — <ISO time>

| Metric | Count |
|--------|------:|
| Pass | |
| Fail | |
| N/A | |
| Skip / blocked | |
| Pass rate (excl. deferred N/A) | |

**Suite:** running | idle | complete
**Active fix agents:** N
**Top blockers:**
1.
2.
3.

**Next actions:**
-
```

## User-facing 5-min status (keep short)

```text
[matrix-e2e <app>] Pass=P Fail=F N/A=N rate=R% | agents=A | blocker: <one line>
```

Multi-app: one line per brand, then fleet totals.

## rca-queue.md row

```markdown
| Time | ID | Flow | Class | Agent | Status |
|------|----|------|-------|-------|--------|
| HH:MM | HEALTH-PRIV-011 | privacy-data-paths | product | task-… | fixing |
```

## Concurrency guidance

- Prefer **one Maestro driver per brand UDID**.
- Cap ~3–5 concurrent fix/retest agents on a typical Mac to reduce `Killed: 9`.
- Jest/live API RCA can run while Maestro continues on that brand if they do not contend for the same sim session.
- When disk/`~/.maestro/tests` pressure appears: prune **stale** artifacts only; never wipe mid-flow; keep `E2E_MAESTRO_CLEANUP=0`.

## Isolation checklist before any kill/reset

1. Brand name known?
2. Using `maestro-scoped-kill.sh <brand>` only?
3. Not calling `simctl shutdown all`?
4. Not matching other brands’ bundle ids in `pkill`?
