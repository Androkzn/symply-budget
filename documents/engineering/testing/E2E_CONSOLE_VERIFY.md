# E2E Console Observability — Symply Ecosystem

| Field | Value |
|-------|-------|
| **Doc type** | Engineering test harness |
| **Status** | implemented — 2026-07-18 |
| **Scope** | Debug / `__DEV__` Maestro + manual QA only |
| **Implementation** | `src/api/e2eTestObservability.ts`, `src/services/e2e-test-deeplinks.ts` |
| **Strategy** | [FLEET_TEST_STRATEGY.md](./FLEET_TEST_STRATEGY.md) §5.3 |
| **Matrix contract** | [matrices/COVERAGE_CONTRACT.md](./matrices/COVERAGE_CONTRACT.md) §4 |

---

## 1. Purpose

Fleet acceptance matrices include a **Console verify** column for every network mutation and many load rows. This harness lets testers and Maestro flows prove that a real HTTP call (or local persist write) happened during a simulator run — without `runScript` staging probes or printing secrets.

**Gated on `__DEV__` only.** Release / EAS production builds are no-ops; nothing ships to App Store builds.

Sources:

| Layer | Module | What it logs |
|-------|--------|--------------|
| Shared HTTP | `src/api/client.ts` (axios) | House, Budget, Kaizen API, platform — with `detail=` summaries |
| Language HTTP | `src/features/language/api/languageClient.ts` | Language Worker calls + `detail=` |
| R2 presigned PUT | `src/api/e2ePutUpload.ts` | Reports, floor plans, garden, task photos, chat images |
| Worker PUT upload | `src/api/e2ePutUpload.ts` (`logKind: network`) | Household profile photo |
| Chat WebSocket | `useChatSocket`, `useBudgetChatSocket` | House + Budget live feed events |
| Kaizen persist | `src/features/kaizen/services/sync.ts` | SQLite / local sync writes |
| Health persist | `src/features/health/healthLocalStorage.ts` | MMKV weight / water / note keys |
| Deep links | `src/services/e2e-test-deeplinks.ts` | clear, dump, tag, verify |
| App bootstrap | `app/_layout.tsx` | installs global probe + deep-link handler |

Legacy import shim: `src/api/e2eNetworkLog.ts` re-exports network helpers from `e2eTestObservability.ts`.

---

## 2. Console prefixes (Metro grep)

Every event is stored in an in-memory ring buffer **and** printed to Metro with a stable prefix. Grep Maestro / Metro output during a run:

| Prefix | Kind | Example line | Grep pattern |
|--------|------|--------------|--------------|
| `[E2E-NET]` | HTTP | `[E2E-NET] POST /households/h1/tasks → 201 ok detail=hasId matrix=HOUSE-TASK-002` | `grep '\[E2E-NET\]'` |
| `[E2E-R2]` | Presigned PUT | `[E2E-R2] PUT bucket.r2…/reports/… → 200 ok label=report detail=hasReportId` | `grep '\[E2E-R2\]'` |
| `[E2E-WS]` | Chat socket | `[E2E-WS] message house-chat /households/h1/chat-rooms/r1/ws detail=type=message` | `grep '\[E2E-WS\]'` |
| `[E2E-DB]` | Local persist | `[E2E-DB] INSERT @health/weight weight=68kg matrix=HEALTH-HOME-016` | `grep '\[E2E-DB\]'` |
| `[E2E-UI]` | Instrumented UI tap | `[E2E-UI] tap testID=save-button screen=TaskEdit` | `grep '\[E2E-UI\]'` |
| `[E2E-TAG]` | Active matrix row set | `[E2E-TAG] active matrix row → HOUSE-TASK-002` | `grep '\[E2E-TAG\]'` |
| `[E2E-DUMP]` | Snapshot / clear | `[E2E-DUMP] --- observability snapshot start ---` | `grep '\[E2E-DUMP\]'` |
| `[E2E-VERIFY]` | Deep-link assertion | `[E2E-VERIFY] PASS POST /tasks status=201 ok=true` | `grep '\[E2E-VERIFY\]'` |

### 2.1 Network line format

```text
[E2E-NET] {METHOD} {path-without-query} → {status|—|ERR} {ok|FAIL} [detail={safe-summary}] [matrix={ID}]
```

**Safe `detail` values (no bodies/tokens):** `count=N`, `hasId`, `hasImageKey`, `hasReportId`, `errorCode=…`, upload labels (`report`, `floor-plan`, `chat-image`, …).

### 2.2 R2 upload line format

```text
[E2E-R2] PUT {redacted-host+path} → {status} {ok|FAIL} [label=…] [detail=…] [matrix={ID}]
```

Presigned query strings (signatures) are **never** logged.

### 2.3 WebSocket line format

```text
[E2E-WS] {connect|open|message|send|error|close} {house-chat|budget-chat} {path-without-token} [detail=…]
```

### 2.4 Network line format (legacy reference)

- Query strings are **stripped** before logging (no `?token=…` in console).
- `status=—` means the request succeeded but no numeric status was captured.
- `FAIL` means `ok: false` (network error or non-2xx handled as failure).

Useful one-liners during a matrix row:

```bash
# All network traffic for one matrix id
grep '\[E2E-NET\].*matrix=HOUSE-TASK-002'

# Specific mutation
grep '\[E2E-NET\].*POST.*/tasks.*201'

# Verify deep link result
grep '\[E2E-VERIFY\]'

# Local Health / Kaizen writes
grep '\[E2E-DB\]'
```

### 2.2 Persist line format

```text
[E2E-DB] {OPERATION} {store} {detail} [matrix={ID}]
```

Operations: `READ`, `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `SYNC`.

For matrix rows marked `n/a (local)` in **Console verify**, assert `[E2E-DB]` lines (or Jest on the storage helper) instead of `[E2E-NET]`.

---

## 3. Matrix **Console verify** column → lookup

Matrix cells use shorthand. Map them to `findE2ENetworkEntryBySpec` or the `e2e-verify-network` deep link.

| Matrix cell | Meaning | `findE2ENetworkEntryBySpec` | Deep link query |
|-------------|---------|----------------------------|-----------------|
| `GET /households 200` | GET whose URL contains `/households`, status 200 | `{ method: 'GET', urlIncludes: '/households', status: 200 }` | `?method=GET&path=/households&status=200` |
| `POST /tasks 201` | POST to path containing `/tasks`, status 201 | `{ method: 'POST', urlIncludes: '/tasks', status: 201 }` | `?method=POST&path=/tasks&status=201` |
| `GET …/garden-plans 200` | Ellipsis = any household prefix | `{ method: 'GET', urlIncludes: '/garden-plans', status: 200 }` | `?method=GET&path=/garden-plans&status=200` |
| `{POST,/tasks,201}` | Brace form (Circle-style) | same as `POST /tasks 201` | same |
| `POST …/path 2xx` | Any 2xx on that path | `{ method: 'POST', urlIncludes: '/path', ok: true }` | `?method=POST&path=/path` (omit `status`) |
| `n/a (local)` | No HTTP — MMKV / SQLite | grep `[E2E-DB]` or use `getE2EPersistLog()` | n/a |
| `n/a (UI-only)` | Pure navigation / visibility | grep `[E2E-UI]` if instrumented; else UI assert only | n/a |
| `no /households call before login` | Negative — must **not** appear | assert `findNetwork` returns `undefined` for that path | manual grep absence |

Lookup scans the network ring buffer **newest-first** (`findE2ENetworkEntry`).

Unit tests for spec parsing: `src/api/__tests__/e2eTestObservability.test.ts`.

---

## 4. Maestro workflow — before → interact → after

Use this three-phase pattern inside mutation Maestro flows. Subflows live under `e2e/maestro/subflows/`.

### 4.1 `e2e-matrix-before` (setup)

Run **before** the UI steps that should produce a console line:

1. **`e2e-clear-log.yaml`** — clears network, persist, UI buffers and active matrix tag.
2. **`e2e-tag-matrix.yaml`** *(optional but recommended)* — sets `E2E_MATRIX_ROW` so every subsequent `[E2E-NET]` / `[E2E-DB]` line includes `matrix={ID}`.

Required env (set in brand runner or flow header):

| Env var | Example | Purpose |
|---------|---------|---------|
| `E2E_APP_SCHEME` | `simplehouse` | Brand URL scheme (see §6) |
| `E2E_MATRIX_ROW` | `HOUSE-TASK-002` | Matrix row id for tagging |

Example YAML fragment:

```yaml
- runFlow: subflows/e2e-clear-log.yaml
- runFlow: subflows/e2e-tag-matrix.yaml
# … UI interaction steps …
```

### 4.2 Interact

Execute the matrix **Steps** (tap, type, submit). Assert UI **Expected** outcomes as today.

Network and persist hooks fire automatically from axios / languageClient / healthLocalStorage / kaizen sync — no extra Maestro step unless you add `[E2E-UI]` instrumentation.

### 4.3 `e2e-matrix-after` (verify + artifact)

Run **after** the interaction:

1. **`e2e-verify-network.yaml`** — deep link asserts the latest matching network entry; prints `[E2E-VERIFY] PASS` or `FAIL`, then dumps the full snapshot.
2. **`e2e-dump-log.yaml`** *(optional if verify already ran)* — prints `[E2E-DUMP]` snapshot without assertion.

Env for verify:

| Env var | Required | Example |
|---------|----------|---------|
| `E2E_VERIFY_PATH` | yes | `/tasks` or `/garden-plans` |
| `E2E_VERIFY_METHOD` | no | `POST` |
| `E2E_VERIFY_STATUS` | no | `201` |

Example:

```yaml
- runFlow: subflows/e2e-verify-network.yaml
    env:
      E2E_VERIFY_METHOD: POST
      E2E_VERIFY_PATH: /tasks
      E2E_VERIFY_STATUS: "201"
```

For **local** rows (`n/a (local)`), skip `e2e-verify-network`; grep `[E2E-DB]` in Metro or assert via Jest on the storage module.

---

## 5. Deep links (dev-only)

Handled by `tryHandleE2ETestDeepLink` in `app/_layout.tsx` before autologin links. Scheme is brand-specific (`{scheme}://…`).

| Host | URL | Action |
|------|-----|--------|
| Clear | `{scheme}://e2e-clear-log` | `clearAllE2ETestLogs()` |
| Dump | `{scheme}://e2e-dump-log` | Full console snapshot |
| Tag | `{scheme}://e2e-tag-matrix?row={ID}` | Sets active matrix tag (`row`, `matrix`, or `id` query) |
| Verify | `{scheme}://e2e-verify-network?method=&path=&status=` | PASS/FAIL + dump |

Examples (Symply House):

```text
simplehouse://e2e-clear-log
simplehouse://e2e-tag-matrix?row=HOUSE-TASK-002
simplehouse://e2e-verify-network?method=POST&path=/tasks&status=201
simplehouse://e2e-dump-log
```

---

## 6. Brand scheme table

Maestro subflows use `E2E_APP_SCHEME` — the value from each brand pack's `scheme` field (`brands/*/brand.cjs`).

| Brand id | Display | `E2E_APP_SCHEME` | iOS bundle (Maestro `appId`) |
|----------|---------|------------------|------------------------------|
| `symply-house` | Symply House | `simplehouse` | `com.symply.house` |
| `symply-budget` | Symply Budget | `simplebudget` | `com.symply.budget` |
| `symply-kaizen` | Symply Kaizen | `kaizen` | `com.symply.kaizen` |
| `symply-language` | Symply Language | `simplelanguage` | `com.symply.language` |
| `symply-health` | Symply Health | `simplehealth` | `com.symply.health` |

Deep links work on any brand build as long as the scheme matches the installed app.

---

## 7. `global.__SYMPLY_E2E__` probe

Installed at app startup in `__DEV__` (`installE2EGlobalProbe()` in `app/_layout.tsx`). Use from Metro "Debug JS Remotely" or the in-app console:

```javascript
// Full snapshot (same as e2e-dump-log)
global.__SYMPLY_E2E__.dump();

// Clear all buffers
global.__SYMPLY_E2E__.clear();

// Clear network buffer only
global.__SYMPLY_E2E__.clearNetwork();

// Tag subsequent lines
global.__SYMPLY_E2E__.setMatrixTag('BUDGET-SAVE-003');

// Programmatic lookup (matrix Console verify column)
global.__SYMPLY_E2E__.findNetwork({
  method: 'POST',
  urlIncludes: '/budget/savings',
  status: 201,
});

// Structured snapshot (no extra console noise)
global.__SYMPLY_E2E__.getSnapshot();
// → { matrixTag, network[], persist[], ui[] }

// Optional UI event (when instrumenting controls)
global.__SYMPLY_E2E__.recordUi({ action: 'tap', testId: 'save-btn', screen: 'SavingsEdit' });
```

On first install, Metro prints:

```text
[E2E-DUMP] global probe installed → global.__SYMPLY_E2E__ (dump/clear/findNetwork)
```

---

## 8. Ring buffer limits

| Buffer | Max entries | Eviction |
|--------|-------------|----------|
| Network | 200 | FIFO |
| Persist | 100 | FIFO |
| UI | 100 | FIFO |

Clear before each matrix row in Maestro (`e2e-clear-log`) so `findNetwork` / verify does not match stale traffic.

---

## 9. Security — do not print secrets

**Never** log or paste into matrix docs / RESULTS notes:

- Bearer tokens, refresh tokens, API keys, invite codes
- Full URLs with query strings (the harness strips queries; keep it that way)
- PII in path segments or `[E2E-DB]` detail strings

Maestro env vars should contain **path fragments only** (`/tasks`, `/garden-plans`), not staging hostnames with embedded credentials.

Prefer Unit + Vitest for request-body proofs; use this harness for **method + path + status** (or local store operation) during Debug Maestro runs.

---

## 10. Related docs

| Doc | Role |
|-----|------|
| [matrices/COVERAGE_CONTRACT.md](./matrices/COVERAGE_CONTRACT.md) | Console verify column contract |
| [matrices/README.md](./matrices/README.md) | Matrix scoring + RESULTS |
| [FLEET_TEST_STRATEGY.md](./FLEET_TEST_STRATEGY.md) | Verification layers |
| [e2e/README.md](../../../e2e/README.md) | Brand Maestro runners |
| `src/api/__tests__/e2eTestObservability.test.ts` | Harness unit tests |
