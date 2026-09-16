import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSession,
  resetLocalBudgetSession,
} from '../engine';

/**
 * Account switching must never hand one user another user's ledger.
 *
 * `openLocalBudgetSession` used to early-return `engine.ledger` whenever an
 * engine existed, ignoring the userId it was called with. Both call sites in
 * authStore are floated promises (`void import(...).then(...)`) — one on sign-in,
 * one on logout — so a fast sign-out/sign-in could reach the open before teardown
 * had finished, and the new user received the previous user's household, their
 * spending, and their sync keys. The disk-level different-user guard could not
 * help: the early return fired before it.
 *
 * These exercise the REAL `openLocalBudgetSession`, not the test helper — the
 * helper unconditionally tears down first, so it cannot reproduce the bug.
 */
describe('local budget session — account isolation', () => {
  beforeEach(async () => {
    await resetLocalBudgetSession();
  });

  afterEach(async () => {
    await resetLocalBudgetSession();
  });

  it('does not hand an open ledger to a different user', async () => {
    const a = await openLocalBudgetSession({ userId: 'user-a' });
    expect(a.memberId).toBe('user-a');
    const householdA = a.household.id;

    // The race: user A's session is still open when user B signs in.
    const b = await openLocalBudgetSession({ userId: 'user-b' });

    expect(b.memberId).toBe('user-b');
    expect(b.household.id).not.toBe(householdA);
    expect(getLocalLedger().memberId).toBe('user-b');
  });

  it('reuses the open ledger for the SAME user', async () => {
    const first = await openLocalBudgetSession({ userId: 'user-a' });
    const second = await openLocalBudgetSession({ userId: 'user-a' });

    // Re-opening for the same user is the common path (a re-render, a resumed
    // app) and must not tear down and re-mint the household.
    expect(second.household.id).toBe(first.household.id);
    expect(second).toBe(first);
  });

  it('serializes overlapping close/open so neither observes a half-torn session', async () => {
    await openLocalBudgetSession({ userId: 'user-a' });

    // Both authStore call sites float their promises, so these genuinely overlap
    // in production. Without the queue the open could run against an engine that
    // close was in the middle of dismantling.
    const closing = closeLocalBudgetSession();
    const opening = openLocalBudgetSession({ userId: 'user-b' });
    const [, b] = await Promise.all([closing, opening]);

    expect(b.memberId).toBe('user-b');
    expect(getLocalLedger().memberId).toBe('user-b');
  });

  it('serializes a burst of interleaved sign-outs and sign-ins', async () => {
    await openLocalBudgetSession({ userId: 'user-a' });

    await Promise.all([
      closeLocalBudgetSession(),
      openLocalBudgetSession({ userId: 'user-b' }),
      closeLocalBudgetSession(),
      openLocalBudgetSession({ userId: 'user-c' }),
    ]);

    // Whatever the interleaving, the surviving session is the last opened one
    // and it belongs to exactly one user.
    expect(getLocalLedger().memberId).toBe('user-c');
  });
});
