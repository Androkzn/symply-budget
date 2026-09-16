import { Asset } from 'expo-asset';
import * as Linking from 'expo-linking';

export type E2EDocumentPickResult = {
  uri: string;
  name: string;
  mime: string;
  size?: number;
};

type FixtureSpec = {
  moduleId: number;
  name: string;
  mime: string;
};

type DeliverFn = (file: E2EDocumentPickResult) => void | Promise<void>;

const VALID_KEYS = new Set([
  'kaizen-book',
  'kaizen-resume',
  'kaizen-questions-technical',
]);

let pendingKey: string | null = null;
let deliverCallback: DeliverFn | null = null;

function parseQueryParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

function isE2EPickUrl(parsed: Linking.ParsedURL): boolean {
  return (
    parsed.hostname === 'e2e-pick' ||
    parsed.path === '/e2e-pick' ||
    parsed.path === 'e2e-pick'
  );
}

function loadFixtureSpec(key: string): FixtureSpec | null {
  switch (key) {
    case 'kaizen-book':
      return {
        moduleId: require('../../assets/e2e/kaizen/book.pdf'),
        name: 'book.pdf',
        mime: 'application/pdf',
      };
    case 'kaizen-resume':
      return {
        moduleId: require('../../assets/e2e/kaizen/resume.pdf'),
        name: 'resume.pdf',
        mime: 'application/pdf',
      };
    case 'kaizen-questions-technical':
      // Plain .txt assets are flaky in Metro dev bundles on House sims — reuse a
      // bundled PDF fixture; Kaizen question-import E2E only needs a pickable file.
      return {
        moduleId: require('../../assets/e2e/kaizen/resume.pdf'),
        name: 'technical-questions.txt',
        mime: 'application/pdf',
      };
    default:
      return null;
  }
}

async function resolvePendingPick(): Promise<E2EDocumentPickResult | null> {
  if (!__DEV__ || !pendingKey) return null;

  const key = pendingKey;
  const spec = loadFixtureSpec(key);
  if (!spec) {
    pendingKey = null;
    return null;
  }

  const asset = Asset.fromModule(spec.moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) return null;

  pendingKey = null;
  return {
    uri,
    name: spec.name,
    mime: spec.mime,
  };
}

async function flushPendingPick(): Promise<boolean> {
  if (!deliverCallback || !pendingKey) return false;
  const file = await resolvePendingPick();
  if (!file) return false;
  await deliverCallback(file);
  return true;
}

function scheduleFlushRetries(): void {
  let attempts = 0;
  const tick = (): void => {
    if (!pendingKey) return;
    void flushPendingPick().then(applied => {
      if (applied || !pendingKey) return;
      attempts += 1;
      if (attempts < 16) {
        setTimeout(tick, 500);
      }
    });
  };
  tick();
}

export function buildE2EDocumentPickUrl(key: string): string {
  return `kaizen://e2e-pick?key=${encodeURIComponent(key)}`;
}

/** Dev-only: register the active upload panel deliver() for auto-apply picks. */
export function registerE2EUploadDeliver(callback: DeliverFn | null): void {
  if (!__DEV__) return;
  deliverCallback = callback;
  if (callback && pendingKey) {
    scheduleFlushRetries();
  }
}

  /** Dev-only: queue the next Upload File tap to use a bundled fixture. */
export function tryQueueE2EDocumentPickFromUrl(url: string | null | undefined): boolean {
  if (!__DEV__ || !url) return false;

  const parsed = Linking.parse(url);
  if (!isE2EPickUrl(parsed)) return false;

  const key = parseQueryParam(parsed.queryParams?.key);
  if (!key || !VALID_KEYS.has(key)) return false;

  pendingKey = key;
  scheduleFlushRetries();
  return true;
}

export function hasPendingE2EDocumentPick(): boolean {
  return pendingKey != null;
}

/** Dev-only: resolve a queued pick into a file:// URI the upload handlers accept. */
export async function consumeE2EDocumentPick(): Promise<E2EDocumentPickResult | null> {
  return resolvePendingPick();
}

/** @internal test helper */
export function __resetE2EDocumentPickStateForTests(): void {
  pendingKey = null;
  deliverCallback = null;
}
