# Symply Health Acceptance Results — 2026-07-19

| Field | Value |
|-------|-------|
| **App / scope** | `health` |
| **Run date** | `2026-07-19` |
| **Last updated** | `2026-07-20 04:39 PDT` |
| **Environment** | `staging` |
| **Device / OS** | Health-A (`0BB24343-E7FE-4327-AD24-7AA994EA823F`), iOS 26.5 |
| **Matrix source** | [health.md](./health.md) |
| **Maestro log (final)** | `/tmp/maestro-health-verify-final.log` + `/tmp/maestro-hv-*.log` |
| **Progress log** | `/tmp/maestro-health-final-progress.log` |

## Summary

| Layer | Pass | Fail | Notes |
|-------|-----:|-----:|-------|
| Jest (`src/features/health/`) | 71 | 0 | All green |
| Live API (`health-live-api.mjs`) | 8 | 0 | All green |
| Maestro flows (14) | **14** | **0** | **Re-verified** sequential run `2026-07-20T11:39Z` |

**Maestro flow score:** **14/14 passed** (0 left).

## Maestro flow results (final sequential run)

| Flow | Result | Notes |
|------|:------:|-------|
| login-screen-controls | PASS | clearState login chrome |
| login-email-submit-seeded | PASS | Deep-link login + API 200 |
| home-weight-water-note | PASS | Note persist via blur + `e2e-health-set-note` deep link |
| home-weight-keyboard-return | PASS | Weight keyboard Done / log button |
| home-empty-and-privacy | PASS | Scroll helpers + COMING SOON testIDs |
| home-rapid-water | PASS | — |
| home-cancel-drafts | PASS | — |
| scroll-note-keyboard | PASS | — |
| privacy-data-paths | PASS | More scroll + `health-sign-out` |
| privacy-local-mutations | PASS | Note round-trip + wire-check dump |
| privacy-cross-user-leak | PASS | Sign-out + clearState fallback |
| tab-shell-two-tabs | PASS | Session recovery subflow |
| more-settings-controls | PASS | Settings testIDs + AI `Go back` |
| scroll-all-screens | PASS | Home/More swipe scroll helpers |

## Fixes landed (final batch)

1. **Note E2E** — `onEndEditing` native text save, `useFocusEffect` note reload, `e2e-health-set-note` dev deep link, PRIVACY blur subflow.
2. **Scroll** — `health-scroll-home-top/down`, `health-scroll-more-down` Maestro subflows; upcoming-row testIDs; `ScreenScrollEnd` accessibility for Maestro.
3. **More settings** — Row testIDs (`health-setting-*`), weight-units subtitle testID, `Go back` from `/ai-access`.
4. **Infra** — Freed `~/.maestro/tests` disk (6.2 GB); `E2E_MAESTRO_CLEANUP=0`; sequential runner with retries on `Killed: 9`.
5. **App** — `health-weight-latest-value`, `health-coming-soon-section`, note saved sentinel sizing, non-multiline note input for Maestro sync.

## Blockers / infra

- Parallel Budget/Kaizen/Language Maestro runs can `Killed: 9` Health driver — run Health suite sequentially or alone.
- `login-screen-controls` first in config uses `clearState`; must not be conflated with mid-suite session state.

## Commands (re-run)

```bash
eval "$(./scripts/secrets/export-env.sh)"
curl -sf -X POST http://localhost:8085/reload
E2E_MAESTRO_CLEANUP=0 ./scripts/e2e/run-health-flows-sequential.sh /tmp/maestro-health-progress.log
```
