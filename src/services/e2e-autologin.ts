import * as Linking from 'expo-linking';

import { markE2EDrivenInstall } from './e2e-mode';

export type E2ELoginCredentials = {
  email: string;
  password: string;
  autoSubmit: boolean;
};

let pending: E2ELoginCredentials | null = null;
const listeners = new Set<(credentials: E2ELoginCredentials) => void>();

function notifyListeners(credentials: E2ELoginCredentials) {
  listeners.forEach((listener) => listener(credentials));
}

function setPending(credentials: E2ELoginCredentials) {
  pending = credentials;
  notifyListeners(credentials);
}

function parseQueryParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

function isE2ELoginUrl(parsed: Linking.ParsedURL): boolean {
  return (
    parsed.hostname === 'e2e-login' ||
    parsed.path === '/e2e-login' ||
    parsed.path === 'e2e-login'
  );
}

export function buildE2ELoginUrl(email: string, password: string): string {
  const params = new URLSearchParams({
    submit: '1',
    email,
    password,
  });
  return `simplehouse://e2e-login?${params.toString()}`;
}

/** Dev-only: stash credentials from `simplehouse://e2e-login?...` for LoginScreen. */
export function trySetE2ELoginFromUrl(url: string | null | undefined): boolean {
  if (!__DEV__ || !url) return false;

  const parsed = Linking.parse(url);
  if (!isE2ELoginUrl(parsed)) return false;

  // Maestro is driving this install — arm the dev-only chrome the flows grab.
  markE2EDrivenInstall();

  const email = parseQueryParam(parsed.queryParams?.email);
  const password = parseQueryParam(parsed.queryParams?.password);
  if (!email || !password) return false;

  const submitParam = parseQueryParam(parsed.queryParams?.submit);
  setPending({
    email,
    password,
    autoSubmit: submitParam === '1' || submitParam === 'true',
  });
  return true;
}

export function hasPendingE2ELogin(): boolean {
  return pending !== null;
}

export function consumeE2ELogin(): E2ELoginCredentials | null {
  const credentials = pending;
  pending = null;
  return credentials;
}

/** Dev-only: drop stashed e2e-login credentials (e.g. before logged-out auth flows). */
export function clearPendingE2ELogin(): void {
  pending = null;
}

export function subscribeE2ELogin(
  listener: (credentials: E2ELoginCredentials) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
