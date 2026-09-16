/**
 * Health local-first error codes.
 *
 * Named errors, not string matching: the client error handlers key on `name`,
 * and the sync status card renders copy per code.
 *
 * Note for He3: `HealthLocalUnsupportedError` thrown from a Home summary method
 * is NOT an acceptable He3 exit — He7-lite must land in the same ship (plan §7).
 * These exist for genuinely remote-by-design surfaces (Tier B), not as a way to
 * defer the summary port.
 */
export class HealthLocalUnsupportedError extends Error {
  readonly code = 'health_local_unsupported';
  constructor(method: string) {
    super(
      `Health local-first: "${method}" is not available offline. Your logs work without the network.`,
    );
    this.name = 'HealthLocalUnsupportedError';
  }
}

export class HealthLocalNotReadyError extends Error {
  readonly code = 'health_local_not_ready';
  constructor() {
    super('Health local-first session is not open. Sign in once to provision the local ledger.');
    this.name = 'HealthLocalNotReadyError';
  }
}

/**
 * Raised for writes attempted between claiming a device-enrolment invite and
 * receiving the household data key. Ops sealed under this device's pre-join key
 * would be undecryptable by the other device AND by this one once the real key
 * installs, so the write is refused rather than silently lost.
 */
export class HealthLocalEnrolmentPendingError extends Error {
  readonly code = 'health_local_enrolment_pending';
  constructor() {
    super('Waiting for your other device to approve this one. Changes are paused until then.');
    this.name = 'HealthLocalEnrolmentPendingError';
  }
}

/**
 * Detectable "SecureStore wiped, SQLite survived" — ciphertext orphan.
 *
 * Reachable on iOS because the Keychain can outlive an uninstall while the
 * container does not (plan §1.3). The first-launch sweep is what prevents it;
 * this error is the backstop, and the caller should route to recovery rather
 * than crash.
 */
export class HealthLedgerDekMissingError extends Error {
  readonly code = 'health_ledger_dek_missing';
  constructor() {
    super('Health ledger key missing from the keychain while a local database exists');
    this.name = 'HealthLedgerDekMissingError';
  }
}
