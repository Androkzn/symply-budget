/** Dev-only: block outbound HTTP until cleared (iOS sim has no airplane-mode effect in Maestro). */
let networkBlocked = false;

export function setE2ENetworkBlocked(blocked: boolean): void {
  if (!__DEV__) return;
  networkBlocked = blocked;
}

export function isE2ENetworkBlocked(): boolean {
  return __DEV__ && networkBlocked;
}

/** @internal test helper */
export function __resetE2ENetworkBlockForTests(): void {
  networkBlocked = false;
}
