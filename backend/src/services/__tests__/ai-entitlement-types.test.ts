/**
 * AI denial → HTTP mapping.
 *
 * This table is what the app sees when AI is refused, and each status drives a
 * different client behaviour: 403 means "you can't have this yet" (show the
 * paywall / connect flow), 409 means "fix your connection", 422 means "this
 * feature can't run on your provider", 503 means "try again later". Collapsing
 * any of them onto a generic 500 turns an actionable message into a dead end.
 */
import { describe, expect, it } from 'vitest';

import { AIAccessError } from '../../utils/errors';
import {
  PAID_BILLING_STATES,
  denialToHttp,
  type AIDenialReason,
} from '../ai-entitlement-types';

const ALL_REASONS: AIDenialReason[] = [
  'AI_DISABLED',
  'AI_ACCESS_REQUIRED',
  'PROVIDER_NOT_CONNECTED',
  'PROVIDER_KEY_INVALID',
  'PROVIDER_CAPABILITY_UNSUPPORTED',
  'MODEL_NOT_AVAILABLE_FOR_KEY',
  'NO_PROVIDER_AVAILABLE',
];

describe('denialToHttp', () => {
  it.each([
    ['AI_DISABLED', 403, 'ai_features_disabled'],
    ['AI_ACCESS_REQUIRED', 403, 'ai_access_required'],
    ['PROVIDER_NOT_CONNECTED', 409, 'ai_provider_not_connected'],
    ['PROVIDER_KEY_INVALID', 409, 'ai_provider_key_invalid'],
    ['PROVIDER_CAPABILITY_UNSUPPORTED', 422, 'ai_provider_capability_unsupported'],
    ['MODEL_NOT_AVAILABLE_FOR_KEY', 409, 'ai_model_not_available_for_key'],
    ['NO_PROVIDER_AVAILABLE', 503, 'ai_provider_unavailable'],
  ] as Array<[AIDenialReason, number, string]>)(
    'maps %s to %i %s',
    (reason, status, code) => {
      expect(denialToHttp(reason)).toEqual({ status, code });
    }
  );

  it('maps every reason to a client-error or service-unavailable status, never a 500', () => {
    // A 5xx other than 503 would read to the client as "we broke", not "here is
    // what to do about it".
    for (const reason of ALL_REASONS) {
      const { status } = denialToHttp(reason);
      expect([403, 409, 422, 503]).toContain(status);
    }
  });

  it('gives every reason a distinct, stable error code', () => {
    const codes = ALL_REASONS.map((r) => denialToHttp(r).code);
    expect(new Set(codes).size).toBe(ALL_REASONS.length);
    for (const code of codes) expect(code).toMatch(/^ai_[a-z_]+$/);
  });
});

describe('AIAccessError.fromReason', () => {
  it('carries the mapped status and code for every reason', () => {
    for (const reason of ALL_REASONS) {
      const { status, code } = denialToHttp(reason);
      const err = AIAccessError.fromReason(reason);
      expect(err).toBeInstanceOf(AIAccessError);
      expect(err.statusCode).toBe(status);
      expect(err.code).toBe(code);
    }
  });

  it('gives every reason a member-readable message with no system detail', () => {
    // These strings reach the UI verbatim via app.onError.
    for (const reason of ALL_REASONS) {
      const { message } = AIAccessError.fromReason(reason);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/undefined|null|error:|stack|http \d|\bsk-/i);
      // Not the raw enum leaking through as the copy.
      expect(message).not.toBe(reason);
      expect(message[0]).toBe(message[0].toUpperCase());
    }
  });
});

describe('PAID_BILLING_STATES', () => {
  it('grants AI only in the normal billing state', () => {
    // Plan default is strict: grace/paused lose AI until billing recovers.
    expect(PAID_BILLING_STATES.has('normal')).toBe(true);
    expect(PAID_BILLING_STATES.has('grace')).toBe(false);
    expect(PAID_BILLING_STATES.has('paused')).toBe(false);
  });
});
