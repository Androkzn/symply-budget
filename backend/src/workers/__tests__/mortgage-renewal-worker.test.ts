import { describe, it, expect } from 'vitest';

import { MortgageRenewalWorker } from '../mortgage-renewal-worker';

const MATURITY = '2028-07-13';

describe('MortgageRenewalWorker.windowStart', () => {
  it('is `monthsBefore` months before maturity', () => {
    expect(MortgageRenewalWorker.windowStart(MATURITY, 3).toISOString().slice(0, 10)).toBe('2028-04-13');
    expect(MortgageRenewalWorker.windowStart(MATURITY, 6).toISOString().slice(0, 10)).toBe('2028-01-13');
  });
});

describe('MortgageRenewalWorker.isInRenewalWindow', () => {
  it('true within [maturity − monthsBefore, maturity]', () => {
    expect(MortgageRenewalWorker.isInRenewalWindow(MATURITY, 3, new Date('2028-05-01'))).toBe(true);
    expect(MortgageRenewalWorker.isInRenewalWindow(MATURITY, 3, new Date('2028-07-13'))).toBe(true);
  });
  it('false before the window opens or after maturity', () => {
    expect(MortgageRenewalWorker.isInRenewalWindow(MATURITY, 3, new Date('2028-01-01'))).toBe(false);
    expect(MortgageRenewalWorker.isInRenewalWindow(MATURITY, 3, new Date('2028-08-01'))).toBe(false);
  });
  it('false for an unparseable maturity date', () => {
    expect(MortgageRenewalWorker.isInRenewalWindow('not-a-date', 3, new Date('2028-05-01'))).toBe(false);
  });
});

describe('MortgageRenewalWorker.shouldSend — idempotency', () => {
  const now = new Date('2028-05-01'); // inside the 3-month window

  it('sends when in-window and never sent', () => {
    expect(MortgageRenewalWorker.shouldSend(null, MATURITY, 3, now)).toBe(true);
  });

  it('does NOT resend when already sent within this window', () => {
    expect(MortgageRenewalWorker.shouldSend('2028-04-20T08:00:00Z', MATURITY, 3, now)).toBe(false);
  });

  it('resends when the last send predates this window (e.g. after a renewal)', () => {
    expect(MortgageRenewalWorker.shouldSend('2025-01-01T08:00:00Z', MATURITY, 3, now)).toBe(true);
  });

  it('does not send outside the window regardless of last-sent', () => {
    expect(MortgageRenewalWorker.shouldSend(null, MATURITY, 3, new Date('2028-01-01'))).toBe(false);
  });

  it('treats an unparseable last-sent as "not yet sent"', () => {
    expect(MortgageRenewalWorker.shouldSend('garbage', MATURITY, 3, now)).toBe(true);
  });
});
