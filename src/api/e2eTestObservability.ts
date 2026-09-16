/**
 * Debug-only test observability — network, R2 uploads, WebSocket, persistence, UI.
 *
 * Every entry is:
 * 1. Stored in an in-memory ring buffer (for programmatic lookup).
 * 2. Printed to Metro console with a stable prefix (grep during Maestro runs).
 *
 * Production / Release: all exports are no-ops (gated on `__DEV__`).
 *
 * Console grep cheatsheet (Maestro / manual QA):
 *   [E2E-NET]   — HTTP via axios, Language fetch, Worker PUT uploads
 *   [E2E-R2]    — Presigned R2 PUT (reports, floor plans, photos, …)
 *   [E2E-WS]    — Chat WebSocket connect / message / error (House + Budget)
 *   [E2E-DB]    — local MMKV / SQLite persistence (Budget, Health, Kaizen)
 *                 operation=SYNC is mailbox/peer sync, not a row write
 *   [E2E-UI]    — optional control taps (when instrumented)
 *   [E2E-DUMP]  — full snapshot dumps (deep link or global probe)
 */

export type E2ENetworkEntry = {
  kind: 'network';
  method: string;
  url: string;
  status: number | null;
  ok: boolean;
  /** Safe summary — count, errorCode, hasId (no bodies/tokens) */
  detail?: string;
  at: number;
  matrixId?: string;
};

export type E2ER2UploadEntry = {
  kind: 'r2';
  uploadTarget: string;
  status: number | null;
  ok: boolean;
  label?: string;
  detail?: string;
  at: number;
  matrixId?: string;
};

export type E2EWsEntry = {
  kind: 'ws';
  action: 'connect' | 'open' | 'message' | 'send' | 'error' | 'close';
  channel: string;
  path: string;
  detail?: string;
  at: number;
  matrixId?: string;
};

export type E2EPersistEntry = {
  kind: 'persist';
  store: string;
  operation: 'read' | 'insert' | 'update' | 'delete' | 'upsert' | 'sync';
  detail: string;
  at: number;
  matrixId?: string;
};

export type E2EUiEntry = {
  kind: 'ui';
  action: string;
  testId?: string;
  screen?: string;
  at: number;
  matrixId?: string;
};

export type E2ETestLogEntry =
  | E2ENetworkEntry
  | E2ER2UploadEntry
  | E2EWsEntry
  | E2EPersistEntry
  | E2EUiEntry;

const NET_MAX = 200;
const OTHER_MAX = 100;

const networkBuffer: E2ENetworkEntry[] = [];
const r2Buffer: E2ER2UploadEntry[] = [];
const wsBuffer: E2EWsEntry[] = [];
const persistBuffer: E2EPersistEntry[] = [];
const uiBuffer: E2EUiEntry[] = [];

let activeMatrixTag: string | undefined;

function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** Redact presigned upload URL to host + truncated path (no query sig). */
export function redactPresignedUploadUrl(uploadUrl: string): string {
  try {
    const parsed = new URL(uploadUrl);
    const path =
      parsed.pathname.length > 56 ? `${parsed.pathname.slice(0, 56)}…` : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return 'presigned-upload';
  }
}

function pushRing<T>(buffer: T[], entry: T, max: number): void {
  buffer.push(entry);
  while (buffer.length > max) {
    buffer.shift();
  }
}

function formatMatrixSuffix(matrixId?: string): string {
  const tag = matrixId ?? activeMatrixTag;
  return tag ? ` matrix=${tag}` : '';
}

function formatDetailSuffix(detail?: string): string {
  return detail ? ` detail=${detail}` : '';
}

function devConsoleLog(prefix: string, message: string): void {
  if (!__DEV__) return;
  // t=<epoch ms> lets tooling (scripts/e2e/generate-report.mjs) correlate
  // this line against Maestro's commands.json step timestamps, which are
  // also epoch ms — that's how the HTML report matches a network call back
  // to the exact UI action that triggered it.
   
  console.log(`${prefix} [t=${Date.now()}] ${message}`);
}

export function setE2EActiveMatrixTag(matrixId: string | undefined): void {
  if (!__DEV__) return;
  activeMatrixTag = matrixId?.trim() || undefined;
  if (activeMatrixTag) {
    devConsoleLog('[E2E-TAG]', `active matrix row → ${activeMatrixTag}`);
  }
}

export function getE2EActiveMatrixTag(): string | undefined {
  if (!__DEV__) return undefined;
  return activeMatrixTag;
}

export function recordE2ENetworkEntry(entry: {
  method?: string;
  url?: string;
  status?: number | null;
  ok: boolean;
  detail?: string;
  matrixId?: string;
}): void {
  if (!__DEV__) return;
  const normalized: E2ENetworkEntry = {
    kind: 'network',
    method: (entry.method ?? 'GET').toUpperCase(),
    url: stripQuery(entry.url ?? ''),
    status: entry.status ?? null,
    ok: entry.ok,
    detail: entry.detail,
    at: Date.now(),
    matrixId: entry.matrixId ?? activeMatrixTag,
  };
  pushRing(networkBuffer, normalized, NET_MAX);
  const statusPart =
    normalized.status != null ? String(normalized.status) : normalized.ok ? '—' : 'ERR';
  const okPart = normalized.ok ? 'ok' : 'FAIL';
  devConsoleLog(
    '[E2E-NET]',
    `${normalized.method} ${normalized.url} → ${statusPart} ${okPart}${formatDetailSuffix(normalized.detail)}${formatMatrixSuffix(normalized.matrixId)}`,
  );
}

export function recordE2ER2UploadEntry(entry: {
  uploadUrl: string;
  status?: number | null;
  ok: boolean;
  label?: string;
  detail?: string;
  matrixId?: string;
}): void {
  if (!__DEV__) return;
  const normalized: E2ER2UploadEntry = {
    kind: 'r2',
    uploadTarget: redactPresignedUploadUrl(entry.uploadUrl),
    status: entry.status ?? null,
    ok: entry.ok,
    label: entry.label,
    detail: entry.detail,
    at: Date.now(),
    matrixId: entry.matrixId ?? activeMatrixTag,
  };
  pushRing(r2Buffer, normalized, OTHER_MAX);
  const statusPart =
    normalized.status != null ? String(normalized.status) : normalized.ok ? '—' : 'ERR';
  const okPart = normalized.ok ? 'ok' : 'FAIL';
  const labelPart = normalized.label ? ` label=${normalized.label}` : '';
  devConsoleLog(
    '[E2E-R2]',
    `PUT ${normalized.uploadTarget} → ${statusPart} ${okPart}${labelPart}${formatDetailSuffix(normalized.detail)}${formatMatrixSuffix(normalized.matrixId)}`,
  );
}

export function recordE2EWsEvent(entry: {
  action: E2EWsEntry['action'];
  channel: string;
  path: string;
  detail?: string;
  matrixId?: string;
}): void {
  if (!__DEV__) return;
  const normalized: E2EWsEntry = {
    kind: 'ws',
    action: entry.action,
    channel: entry.channel,
    path: stripQuery(entry.path),
    detail: entry.detail,
    at: Date.now(),
    matrixId: entry.matrixId ?? activeMatrixTag,
  };
  pushRing(wsBuffer, normalized, OTHER_MAX);
  devConsoleLog(
    '[E2E-WS]',
    `${normalized.action} ${normalized.channel} ${normalized.path}${formatDetailSuffix(normalized.detail)}${formatMatrixSuffix(normalized.matrixId)}`,
  );
}

export function recordE2EPersistEntry(entry: {
  store: string;
  operation: E2EPersistEntry['operation'];
  detail: string;
  matrixId?: string;
}): void {
  if (!__DEV__) return;
  const normalized: E2EPersistEntry = {
    kind: 'persist',
    store: entry.store,
    operation: entry.operation,
    detail: entry.detail,
    at: Date.now(),
    matrixId: entry.matrixId ?? activeMatrixTag,
  };
  pushRing(persistBuffer, normalized, OTHER_MAX);
  devConsoleLog(
    '[E2E-DB]',
    `${normalized.operation.toUpperCase()} ${normalized.store} ${normalized.detail}${formatMatrixSuffix(normalized.matrixId)}`,
  );
}

export function recordE2EUiEvent(entry: {
  action: string;
  testId?: string;
  screen?: string;
  matrixId?: string;
}): void {
  if (!__DEV__) return;
  const normalized: E2EUiEntry = {
    kind: 'ui',
    action: entry.action,
    testId: entry.testId,
    screen: entry.screen,
    at: Date.now(),
    matrixId: entry.matrixId ?? activeMatrixTag,
  };
  pushRing(uiBuffer, normalized, OTHER_MAX);
  const parts = [normalized.action];
  if (normalized.testId) parts.push(`testID=${normalized.testId}`);
  if (normalized.screen) parts.push(`screen=${normalized.screen}`);
  devConsoleLog('[E2E-UI]', `${parts.join(' ')}${formatMatrixSuffix(normalized.matrixId)}`);
}

export function getE2ENetworkLog(): readonly E2ENetworkEntry[] {
  if (!__DEV__) return [];
  return networkBuffer.slice();
}

export function getE2ER2UploadLog(): readonly E2ER2UploadEntry[] {
  if (!__DEV__) return [];
  return r2Buffer.slice();
}

export function getE2EWsLog(): readonly E2EWsEntry[] {
  if (!__DEV__) return [];
  return wsBuffer.slice();
}

export function getE2EPersistLog(): readonly E2EPersistEntry[] {
  if (!__DEV__) return [];
  return persistBuffer.slice();
}

export function getE2EUiLog(): readonly E2EUiEntry[] {
  if (!__DEV__) return [];
  return uiBuffer.slice();
}

export function getE2ETestObservabilitySnapshot(): {
  matrixTag: string | undefined;
  network: readonly E2ENetworkEntry[];
  r2: readonly E2ER2UploadEntry[];
  ws: readonly E2EWsEntry[];
  persist: readonly E2EPersistEntry[];
  ui: readonly E2EUiEntry[];
} {
  if (!__DEV__) {
    return { matrixTag: undefined, network: [], r2: [], ws: [], persist: [], ui: [] };
  }
  return {
    matrixTag: activeMatrixTag,
    network: getE2ENetworkLog(),
    r2: getE2ER2UploadLog(),
    ws: getE2EWsLog(),
    persist: getE2EPersistLog(),
    ui: getE2EUiLog(),
  };
}

export function clearE2ENetworkLog(): void {
  if (!__DEV__) return;
  networkBuffer.length = 0;
  devConsoleLog('[E2E-NET]', 'buffer cleared');
}

export function clearE2ER2UploadLog(): void {
  if (!__DEV__) return;
  r2Buffer.length = 0;
  devConsoleLog('[E2E-R2]', 'buffer cleared');
}

export function clearE2EWsLog(): void {
  if (!__DEV__) return;
  wsBuffer.length = 0;
  devConsoleLog('[E2E-WS]', 'buffer cleared');
}

export function clearE2EPersistLog(): void {
  if (!__DEV__) return;
  persistBuffer.length = 0;
  devConsoleLog('[E2E-DB]', 'buffer cleared');
}

export function clearE2EUiLog(): void {
  if (!__DEV__) return;
  uiBuffer.length = 0;
  devConsoleLog('[E2E-UI]', 'buffer cleared');
}

export function clearAllE2ETestLogs(): void {
  if (!__DEV__) return;
  networkBuffer.length = 0;
  r2Buffer.length = 0;
  wsBuffer.length = 0;
  persistBuffer.length = 0;
  uiBuffer.length = 0;
  activeMatrixTag = undefined;
  lastVerifyResult = null;
  verifyResultListeners.forEach((listener) => listener());
  devConsoleLog('[E2E-DUMP]', 'all observability buffers cleared');
}

export function dumpE2ETestObservabilityToConsole(): void {
  if (!__DEV__) return;
  const snap = getE2ETestObservabilitySnapshot();
  devConsoleLog('[E2E-DUMP]', '--- observability snapshot start ---');
  if (snap.matrixTag) {
    devConsoleLog('[E2E-DUMP]', `active matrix tag: ${snap.matrixTag}`);
  }
  devConsoleLog('[E2E-DUMP]', `network entries: ${snap.network.length}`);
  for (const e of snap.network) {
    devConsoleLog(
      '[E2E-DUMP]',
      `  NET ${e.method} ${e.url} status=${e.status ?? 'null'} ok=${e.ok}${formatDetailSuffix(e.detail)}${formatMatrixSuffix(e.matrixId)}`,
    );
  }
  devConsoleLog('[E2E-DUMP]', `r2 entries: ${snap.r2.length}`);
  for (const e of snap.r2) {
    devConsoleLog(
      '[E2E-DUMP]',
      `  R2 PUT ${e.uploadTarget} status=${e.status ?? 'null'} ok=${e.ok}${e.label ? ` label=${e.label}` : ''}${formatDetailSuffix(e.detail)}${formatMatrixSuffix(e.matrixId)}`,
    );
  }
  devConsoleLog('[E2E-DUMP]', `ws entries: ${snap.ws.length}`);
  for (const e of snap.ws) {
    devConsoleLog(
      '[E2E-DUMP]',
      `  WS ${e.action} ${e.channel} ${e.path}${formatDetailSuffix(e.detail)}${formatMatrixSuffix(e.matrixId)}`,
    );
  }
  devConsoleLog('[E2E-DUMP]', `persist entries: ${snap.persist.length}`);
  for (const e of snap.persist) {
    devConsoleLog(
      '[E2E-DUMP]',
      `  DB ${e.operation} ${e.store} ${e.detail}${formatMatrixSuffix(e.matrixId)}`,
    );
  }
  devConsoleLog('[E2E-DUMP]', `ui entries: ${snap.ui.length}`);
  for (const e of snap.ui) {
    devConsoleLog(
      '[E2E-DUMP]',
      `  UI ${e.action}${e.testId ? ` testID=${e.testId}` : ''}${formatMatrixSuffix(e.matrixId)}`,
    );
  }
  devConsoleLog('[E2E-DUMP]', '--- observability snapshot end ---');
}

export function findE2ENetworkEntry(
  predicate: (e: E2ENetworkEntry) => boolean,
): E2ENetworkEntry | undefined {
  if (!__DEV__) return undefined;
  for (let i = networkBuffer.length - 1; i >= 0; i -= 1) {
    if (predicate(networkBuffer[i]!)) return networkBuffer[i];
  }
  return undefined;
}

export function findE2ER2UploadEntry(
  predicate: (e: E2ER2UploadEntry) => boolean,
): E2ER2UploadEntry | undefined {
  if (!__DEV__) return undefined;
  for (let i = r2Buffer.length - 1; i >= 0; i -= 1) {
    if (predicate(r2Buffer[i]!)) return r2Buffer[i];
  }
  return undefined;
}

export function findE2EWsEntry(
  predicate: (e: E2EWsEntry) => boolean,
): E2EWsEntry | undefined {
  if (!__DEV__) return undefined;
  for (let i = wsBuffer.length - 1; i >= 0; i -= 1) {
    if (predicate(wsBuffer[i]!)) return wsBuffer[i];
  }
  return undefined;
}

export function findE2EPersistEntry(
  predicate: (e: E2EPersistEntry) => boolean,
): E2EPersistEntry | undefined {
  if (!__DEV__) return undefined;
  for (let i = persistBuffer.length - 1; i >= 0; i -= 1) {
    if (predicate(persistBuffer[i]!)) return persistBuffer[i];
  }
  return undefined;
}

export type E2EVerifyResult = { ok: boolean; detail: string; at: number } | null;

let lastVerifyResult: E2EVerifyResult = null;
const verifyResultListeners = new Set<() => void>();

/**
 * The {scheme}://e2e-verify-network deep link used to only console.log its
 * PASS/FAIL — Maestro can't read Metro's console, so a real backend failure
 * (e.g. a cascading 401 after a token-refresh regression) could sit under a
 * flow that still reports [Passed] because it only ever asserted element
 * visibility. This makes the last verify result assertable via a mounted
 * testID (see E2EVerifyBadge) instead of console-only.
 */
export function setE2ELastVerifyResult(result: E2EVerifyResult): void {
  if (!__DEV__) return;
  lastVerifyResult = result;
  verifyResultListeners.forEach((listener) => listener());
}

export function getE2ELastVerifyResult(): E2EVerifyResult {
  if (!__DEV__) return null;
  return lastVerifyResult;
}

export function subscribeE2ELastVerifyResult(listener: () => void): () => void {
  verifyResultListeners.add(listener);
  return () => verifyResultListeners.delete(listener);
}

export function findE2ENetworkEntryBySpec(spec: {
  method?: string;
  urlIncludes: string;
  status?: number;
  ok?: boolean;
  /**
   * Plain substring match (the default) is too loose for a bare collection
   * route like `/households` — it also matches every nested sub-resource
   * (`/households/:id/join-requests`, `/households/:id/budget/monthly-overview`,
   * …), so a caller asserting "no /households 401" gets false positives from
   * unrelated endpoints that merely happen to share the prefix. Set `exact` to
   * require `e.url === spec.urlIncludes` instead.
   */
  exact?: boolean;
}): E2ENetworkEntry | undefined {
  const method = spec.method?.toUpperCase();
  return findE2ENetworkEntry((e) => {
    if (method && e.method !== method) return false;
    if (spec.exact ? e.url !== spec.urlIncludes : !e.url.includes(spec.urlIncludes)) return false;
    if (spec.status != null && e.status !== spec.status) return false;
    if (spec.ok != null && e.ok !== spec.ok) return false;
    return true;
  });
}

export function findE2EPersistEntryBySpec(spec: {
  store: string;
  /** Plain string, not narrowed to `E2EPersistEntry['operation']` — mirrors `findE2ENetworkEntryBySpec`'s `method?: string`, since callers (the `e2e-verify-persist` deep link) pass an untyped query param. */
  operation?: string;
  detailIncludes?: string;
}): E2EPersistEntry | undefined {
  return findE2EPersistEntry((e) => {
    if (!e.store.includes(spec.store)) return false;
    if (spec.operation && e.operation !== spec.operation) return false;
    if (spec.detailIncludes && !e.detail.includes(spec.detailIncludes)) return false;
    return true;
  });
}

export type E2EGlobalProbe = {
  getSnapshot: typeof getE2ETestObservabilitySnapshot;
  dump: typeof dumpE2ETestObservabilityToConsole;
  clear: typeof clearAllE2ETestLogs;
  clearNetwork: typeof clearE2ENetworkLog;
  findNetwork: typeof findE2ENetworkEntryBySpec;
  findR2: typeof findE2ER2UploadEntry;
  findWs: typeof findE2EWsEntry;
  findPersist: typeof findE2EPersistEntryBySpec;
  setMatrixTag: typeof setE2EActiveMatrixTag;
  getMatrixTag: typeof getE2EActiveMatrixTag;
  recordUi: typeof recordE2EUiEvent;
};

declare global {
  // eslint-disable-next-line no-var
  var __SYMPLY_E2E__: E2EGlobalProbe | undefined;
}

export function installE2EGlobalProbe(): void {
  if (!__DEV__) return;
  global.__SYMPLY_E2E__ = {
    getSnapshot: getE2ETestObservabilitySnapshot,
    dump: dumpE2ETestObservabilityToConsole,
    clear: clearAllE2ETestLogs,
    clearNetwork: clearE2ENetworkLog,
    findNetwork: findE2ENetworkEntryBySpec,
    findR2: findE2ER2UploadEntry,
    findWs: findE2EWsEntry,
    findPersist: findE2EPersistEntryBySpec,
    setMatrixTag: setE2EActiveMatrixTag,
    getMatrixTag: getE2EActiveMatrixTag,
    recordUi: recordE2EUiEvent,
  };
  devConsoleLog(
    '[E2E-DUMP]',
    'global probe installed → global.__SYMPLY_E2E__ (dump/clear/findNetwork/findR2/findWs/findPersist)',
  );
}
