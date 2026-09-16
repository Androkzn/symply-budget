/** Dev-only: next Kaizen file import throws (Maestro SYS-139 / offline ERROR paths). */
let pendingForceImportFail = false;

export function queueE2EForceImportFail(): void {
  if (!__DEV__) return;
  pendingForceImportFail = true;
}

export function consumeE2EForceImportFail(): boolean {
  if (!__DEV__ || !pendingForceImportFail) return false;
  pendingForceImportFail = false;
  return true;
}

/** @internal test helper */
export function __resetE2EForceImportFailForTests(): void {
  pendingForceImportFail = false;
}
