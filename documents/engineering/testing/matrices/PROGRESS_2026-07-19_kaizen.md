# Kaizen E2E Progress — live tracker

| Field | Value |
|-------|-------|
| **Last updated** | 2026-07-19 17:15 PDT (tick 38) |
| **Agent session** | Pick-fix + canary-6 + full suite |
| **Authoritative matrix** | [RESULTS_2026-07-18_kaizen.md](./RESULTS_2026-07-18_kaizen.md) (rescore after green run) |

## Matrix snapshot (last scored run)

| Layer | Total | Scored | Pass | Fail | N/A | Unscored |
|-------|------:|-------:|-----:|-----:|----:|---------:|
| Matrix rows | 479 | 233 | 166 | 38 | 29 | **246** |
| Maestro (39 flows) | 39 | 39 | 33 | 6 | — | 0 |
| Jest (kaizen) | 1005 | 1005 | 1005 | 0 | — | 0 |

**Maestro pass rate (baseline):** 85% (33/39) — log `kaizen-suite-final2.log`

## Six failing flows (baseline → target)

| Flow | Baseline failure | Fix status | Latest run |
|------|------------------|------------|------------|
| `books` | pick → `book.pdf` not visible | route-restore + queue+tap | **v18 PASS** ✅ (~4 min) |
| `books-offline-upload` | same pick subflow | shares pick fix | **PASS** ✅ |
| `system-detail` | pause toggle | Enable system assert | **PASS** ✅ |
| `question-import` | Import for review | e2eText deep link + Pressable + scroll subflow | **v8 PASS** ✅ |
| `question-banks` | Import link assert | arrow fix | **PASS** ✅ |

## Active run

**Log:** `/tmp/kaizen-suite-serial-full.log` — **36 pass / 4 fail / ~38 done** (on `question-import`)

**Fails (4):** `career-setup`, `system-detail`, `guide-background-reply`, `books-offline-upload`

**Canary:** `question-banks` ✅ · `question-import` running

**Matrix (pending rescore):** still 33/39 until full suite completes (~2–3 hr serial)

## Update log

| Time (PDT) | Event |
|------------|-------|
| 15:31 | Tick 18: v2 retry started |
| 15:32 | v2 FAIL — eraseText broke text assert |
| 15:33 | v3: always-visible import button |
| 15:36 | **Tick 19:** v3 on launch; matrix 33/39 |
| 15:37 | v3 FAIL — `kaizen-import-for-review` not in a11y tree (Maestro paste ≠ React state) |
| 16:00 | v8 PASS — e2eText deep link, Pressable testID, removed hideKeyboard, scroll subflow |
| 16:05 | **Canary 6/6** — full suite next |
| 16:10 | **Tick 25:** full 39-flow suite launched (`kaizen-suite-serial-full.log`) |
| 16:15 | **Tick 26:** shell prime done; serial run started — `all-hubs` (1/39) |
| 16:20 | **Tick 27:** 2/39 pass (`all-hubs`, `today-screen`); 0 fail |
| 16:25 | **Tick 28:** 5/39 pass (+`deep-links-smoke`, `profile`, `settings`); on `more-hub` |
| 16:30 | **Tick 29:** 8 pass, **1 fail** (`career-setup`); on `interview-pipeline` |
| 16:35 | **Tick 30:** 13 pass, 1 fail; on `practice-session` (~36% through) |
| 16:40 | **Tick 31:** 17 pass, 1 fail; on `deep-work` (~46% through) |
| 16:45 | **Tick 32:** 21 pass, 1 fail; on `system-config` (~56% through) |
| 16:50 | **Tick 33:** 23 pass, **2 fail** (+`system-detail`); on `memory` (~64% through) |
| 16:55 | **Tick 34:** 28 pass, 2 fail; on `guide-background-reply` (~74% through) |
| 17:00 | **Tick 35:** 31 pass, **3 fail** (+`guide-background-reply`); `books` ✅; on `book-detail` |
| 17:05 | **Tick 36:** 34 pass, 3 fail; on `books-offline-upload` (~90% through) |
| 17:10 | **Tick 37:** 35 pass, **4 fail** (+`books-offline-upload`); `resume-review` ✅; on `question-banks` |
| 17:15 | **Tick 38:** 36 pass, 4 fail; `question-banks` ✅; on `question-import` (final stretch) |

- **Sim:** Kaizen-A `D3BC7D94…` booted, iOS 26.5
- **Metro:** `:8081` running (`APP_BRAND=symply-kaizen`)
- **App:** `SymplyEcosystem.app` installed from `/tmp/kaizen-sim-dd`
- **Suite mode:** serial + shell prime + `MAESTRO_DEBUG=0`

## Code changes (uncommitted)

- `e2e/maestro/kaizen/subflows/pick-kaizen-fixture.yaml` — wait for auto-deliver before manual tap
- `src/services/e2e-document-pick.ts` — retry flush on register
- `src/features/kaizen/stores/kaizenStore.ts` — immer-safe activation toggle
- `scripts/e2e/run-kaizen-suite.sh` — serial runner, shell prime, recover session

## Next gates

1. Finish `books` canary (v11 interrupted)
2. Run canary-6 batch
3. Full 39-flow serial suite
4. Rescore RESULTS via `scripts/e2e/generate-results-from-logs.py`

## Active run

**Log:** `/tmp/kaizen-canary-3-retry.log` — `system-detail`, `question-import`, `question-banks` (yaml fixes)

**Canary:** **3/6** confirmed green; retry in progress for remaining 3

## Update log

| Time (PDT) | Event |
|------------|-------|
| 14:48 | Canary-5 done: 2/5 batch (+ books = 3/6) |
| 14:49 | Yaml fixes; canary-3-retry started |
| 14:51 | **Tick 10:** retry shell priming; matrix still 33/39 |
