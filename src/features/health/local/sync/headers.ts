/**
 * The one header every Health `/v2` call must carry (plan §2 item 3, §5 He4).
 *
 * `rejectHealthWritesForLocalFirstEarly` on the Worker stays **unarmed** until
 * it sees `X-Health-Local-First`. That is the whole point of the header: it is
 * the client saying "my ledger is the system of record, so 410 my Wave A D1
 * surfaces". A `/v2` call that forgets it is not a cosmetic slip — it is a
 * client that has silently opted itself back into the dual-world state §1.3
 * rejects, and nothing fails loudly when it does.
 *
 * Declared here rather than privately in `controlPlaneClient.ts` (as House does
 * at `src/features/house/local/controlPlaneClient.ts:32`) so the sync layer and
 * the control-plane client cannot drift onto two spellings of the same header,
 * and so `__tests__/syncClient.test.ts` can assert one constant instead of a
 * string literal per call site.
 */
export const HEALTH_LOCAL_FIRST_HEADER = 'X-Health-Local-First';

/** Spread into every `apiClient` call that targets `/v2`. */
export const HEALTH_LOCAL_FIRST_HEADERS = { [HEALTH_LOCAL_FIRST_HEADER]: '1' } as const;

/* ------------------------------------------------------------------ */
/* Arming — the half that makes the 410 gate more than decoration       */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ The header above, spread by hand at each `/v2` call site, is NOT enough to
 * arm the Worker's gate — and the gap is easy to miss because the constant
 * exists and looks used.
 *
 * `rejectHealthWritesForLocalFirstEarly` matches `/health/*` paths. Every
 * hand-spread use of `HEALTH_LOCAL_FIRST_HEADERS` targets `/v2`. HTTP gates are
 * per-request, so a `POST /health/weight/entries` that carries no header is
 * simply not gated, no matter how many `/v2` calls the same client made a
 * second earlier. Before this arming existed, the entire Wave A reject-list was
 * inert for exactly the traffic it was written to stop.
 *
 * That traffic is real even with the Proxy in place. The Proxy only covers
 * calls that go THROUGH `healthApi`; `healthRepository.ts`'s `writeThrough` /
 * `readThrough` and the legacy outbox `syncPush` reach `apiClient` directly. On
 * a flag-1 device those are precisely the writes that must 410 rather than
 * quietly making D1 a second system of record (plan §1.3).
 *
 * ORDERING — this is the constraint plan §1.3a is built around. The
 * export-before-upgrade CSV must be offered and completed BEFORE the first
 * armed request, because arming is what starts the 410s. Hence a mutable flag
 * flipped by `ensureHealthLocalSession()` rather than a constant derived from
 * `isHealthLocalFirst()`: the flag is off during the export window even on a
 * build whose flag is 1.
 */
let armed = false;

/**
 * Called by `ensureHealthLocalSession()` once the ledger session is genuinely
 * open. Not called from the flag check — a flag-1 binary whose session failed
 * to open must keep talking to D1, or the user has no app at all.
 */
export function armHealthLocalFirstHeader(): void {
  armed = true;
}

/**
 * Called on teardown / sign-out. A disarmed client is an ordinary flag-0 client
 * again, which is what makes account-switch and wipe-and-reopen survivable.
 */
export function disarmHealthLocalFirstHeader(): void {
  armed = false;
}

export function isHealthLocalFirstHeaderArmed(): boolean {
  return armed;
}
