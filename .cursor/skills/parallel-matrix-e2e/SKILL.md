---
name: parallel-matrix-e2e
description: >-
  Autonomous parallel matrix E2E for one or many Symply apps (house, budget,
  kaizen, language, health). Runs suites on dedicated simulators without
  interrupting other brands, scores today's RESULTS matrix copy, investigates
  failed/skipped rows in parallel, fixes with parallel agents, and retests until
  100% pass rate. Use when the user asks to run parallel tests, matrix E2E,
  achieve 100% matrix pass, or drive fleet/app acceptance testing with agents.
---

# Parallel Matrix E2E

Autonomous acceptance loop: **test all according matrix → investigate failed/skipped → fix with parallel agents → retest on separate simulators → 100% pass rate**.

## Goal (non-negotiable)

Achieve **100% pass rate** for every scored row in the app matrix RESULTS copy for today. Do not stop at “almost green.” Own E2E: run, fix, retest, update RESULTS. Hand back only for 2FA, missing secrets, or explicit product forks.

## Triggers

User asks to:

- run parallel tests for one/many apps
- drive matrix acceptance / 100% pass
- continue a matrix campaign without killing other brands’ runs

## Hard rules (parallel isolation)

| Do | Do not |
|----|--------|
| One brand → one sim + Metro port (`maestro-fleet-brand.sh`) | Global `pkill` Maestro / suite runners |
| `scripts/e2e/maestro-scoped-kill.sh <brand>` | `simctl shutdown all` / exclusive dedicated-sim while others run |
| `E2E_PARALLEL_FLEET=1` `E2E_DEDICATED_SIM=0` `E2E_MAESTRO_LOCK=0` | Touch another brand’s UDID, Metro, or log |
| Update only **today’s RESULTS copy** | Mark Pass from code reading alone |

Fleet map + preflight: [reference.md](reference.md).

## Models

- Default Task/subagents: **Composer 2.5** (`composer-2.5-fast`)
- Optional adversarial RCA: **Cursor Grok 4.5** (`grok-4.5-fast-xhigh`)
- Never Opus / Sonnet / GPT / other slugs

## Inputs

Parse from the user (defaults in parentheses):

| Input | Default |
|-------|---------|
| `APPS` | one brand, or `house budget kaizen language health` |
| Environment | `staging` |
| Target | **100%** Pass (excl. N/A only when matrix flags deferred) |
| Status cadence | **every 5 min** |

## Artifacts (today’s run)

```text
documents/engineering/testing/matrices/
  <app>.md                              # source of truth (do not score here)
  RESULTS_YYYY-MM-DD_<app>.md           # COPY OF Matrix for the current test run today
.tmp/e2e-logs/matrix-<app>-YYYY-MM-DD/
  status.md                             # 5-min heartbeat
  suite.log / flow-*.log
  rca-queue.md                          # failed/skipped backlog
```

Date = local calendar day (`date +%Y-%m-%d`). If RESULTS for today is missing, create/regen via:

```bash
python3 scripts/e2e/generate-results-from-logs.py \
  "$(date +%Y-%m-%d)" staging "<Device>, iOS …" <app>
```

Or copy `RESULTS_TEMPLATE.md` and fill from observed runs. **Regularly update** the RESULTS copy as flows finish — not only at the end. Prefer incremental Pass/Fail edits during the campaign; use full regen as a merge aid.

## Autonomous workflow

Copy and track:

```text
Campaign:
- [ ] 0. Preflight
- [ ] 1. Open today's RESULTS copy
- [ ] 2. Arm 5-min status loop
- [ ] 3. Main test wave (per app, parallel if many)
- [ ] 4. Parallel RCA + fix agents for Fail/Skip/N/A-that-should-run
- [ ] 5. Retest fixed slices on brand's dedicated sim
- [ ] 6. Rescore RESULTS → repeat 4–6 until 100%
- [ ] 7. Final status + stop loop
```

### 0. Preflight

```bash
eval "$(./scripts/secrets/export-env.sh)"
APPS="<apps>" E2E_PREFLIGHT_STRICT=1 ./scripts/e2e/preflight-fleet-parallel.sh
```

Ensure each selected brand has Metro on its port and app installed. Start missing Metros yourself (`npm run start:<brand> -- --port <port>`). Seed if needed: `npm run test:e2e:seed:fleet`.

### 1. Today's RESULTS copy

For each app:

1. Read `documents/engineering/testing/matrices/<app>.md` (scored row count + flagged/deferred).
2. Ensure `RESULTS_YYYY-MM-DD_<app>.md` exists (today).
3. Treat that file as the **only** scoring surface for this campaign.

Flagged/deferred in the matrix source stay unscored until product ships — do not invent Pass. Everything else must become Pass.

### 2. Status updates every 5 min

Arm a fixed loop (see loop skill). Unique sentinel per campaign:

```bash
while true; do
  sleep 300
  echo "AGENT_LOOP_TICK_matrix_e2e {\"prompt\":\"Status update for parallel-matrix-e2e campaign; refresh RESULTS and status.md\"}"
done
```

`notify_on_output` pattern: `^AGENT_LOOP_TICK_matrix_e2e`

On each tick (and immediately at start):

1. Parse latest suite logs + RESULTS checkboxes.
2. Write `.tmp/e2e-logs/matrix-<app>-YYYY-MM-DD/status.md` with: Pass / Fail / N/A / Skip, pass rate, active agents, top blockers, next actions.
3. Reply to the user with a **short** status (counts + top 3 blockers). Do not dump full matrices.

### 3. Main testing flow

**One app:** run that brand’s suite on its dedicated sim only:

```bash
E2E_PARALLEL_FLEET=1 E2E_DEDICATED_SIM=0 E2E_MAESTRO_LOCK=0 \
  ./scripts/e2e/run-<app>-suite.sh
```

**Many apps:** `./scripts/e2e/run-fleet-parallel.sh` (or `APPS="…" ./scripts/e2e/run-fleet-parallel.sh`). Never exclusive-sim mode.

Also run non-Maestro layers required by the matrix (Jest / live API) for that brand when RESULTS rows cite them.

While the suite runs, **do not wait serially** to start RCA — as soon as a flow fails or a row is skipped, enqueue it (step 4).

### 4. Investigate failed / skipped in parallel to main testing flow

For each Fail, Skip, or unexpected N/A:

1. Append to `rca-queue.md` (ID, flow, log excerpt, hypothesis).
2. Launch a **background** Task agent (`composer-2.5-fast`, `run_in_background: true`) with a tight prompt:
   - brand + UDID + Metro port
   - matrix row ID(s) + expected behavior (correct product behavior, not “assert the bug”)
   - log path + failing assertion
   - constraints: scoped kill only; do not touch other brands; fix code/tests so they reflect **correct** behavior; retest the slice
3. Cap concurrent fix agents (~3–5 per machine) to avoid OOM/`Killed: 9`. Queue the rest.
4. Optional second agent (**Cursor Grok 4.5**) only when RCA is contested.

Root-cause classes to distinguish in Notes:

| Class | Action |
|-------|--------|
| Product bug | Fix app/BE; update test to correct behavior; retest |
| Flaky / harness | Fix testIDs, waits, login subflow; retest |
| Infra (Metro/sim/OOM) | Recover brand only; retry; do not mark Pass |
| Deferred / not shipped | N/A + cite matrix Flagged section |

### 5. Fix + retest (parallel)

Each fix agent must:

1. Implement the smallest correct fix.
2. Retest **only** the affected flow(s) on that brand’s sim (`run-<app>-suite.sh path/to/flow.yaml` or sequential subset).
3. Update today’s RESULTS rows for those IDs (Pass/Fail/Notes).
4. Report back: root cause, files changed, retest result.

Parent agent merges RESULTS, keeps the main suite moving, and re-queues remaining fails.

### 6. Exit criteria

Stop only when for every selected app:

- RESULTS summary: **Fail = 0**, and every runnable scored row is **Pass**
- Pass rate (excl. legitimate deferred N/A) = **100%**
- `status.md` shows campaign **COMPLETE**
- 5-min loop stopped

If blocked on human (2FA / secret): document in RESULTS Notes + status.md; keep other apps/agents running.

## Agent prompt template (fix worker)

```text
You are a parallel-matrix-e2e fix worker for brand=<brand>.
Model: Composer 2.5.
Isolated sim=<device> Metro=:<port>. Never kill other brands.
Matrix rows: <IDs>
Failure evidence: <log path / excerpt>
Goal: correct product behavior + green retest. Update RESULTS_YYYY-MM-DD_<brand>.md for those IDs only.
Return: root cause, files changed, retest command + outcome.
```

## Forbidden

- Global Maestro cleanup / killing all suite runners
- Shutting down other fleet sims during a multi-app or neighbor run
- Marking Pass without an observed run
- Leaving Fail/Skip without RCA enqueue
- Amending git / committing unless the user asks

## Related

- [reference.md](reference.md) — ports, scripts, RESULTS regen
- `.cursor/rules/e2e-parallel-fleet.mdc`
- `documents/engineering/testing/matrices/COVERAGE_CONTRACT.md`
- `documents/engineering/testing/matrices/RESULTS_TEMPLATE.md`
