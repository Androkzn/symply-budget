import { describe, expect, it } from 'vitest';

import { deriveEnrolmentSas, formatEnrolmentSas } from '../src/index';

/**
 * The enrolment SAS is the only thing standing between "the control plane told
 * my device which key to wrap the household to" and "that key belongs to the
 * person I am talking to". These tests pin the properties that make that true;
 * breaking one breaks the guarantee, not just a format.
 */

const BASE = {
  inviteId: 'inv_7c1f',
  inviteSecret: 'e6f1a2b3c4d5e6f708192a3b4c5d6e7f',
  signingPublicKeyHex: 'aa'.repeat(32),
  agreementPublicKeyHex: 'bb'.repeat(32),
};

describe('deriveEnrolmentSas', () => {
  it('is stable for the same enrolment — both devices must land on one answer', () => {
    expect(deriveEnrolmentSas(BASE)).toBe(deriveEnrolmentSas({ ...BASE }));
  });

  it('is six digits, so it can be read aloud without ambiguity', () => {
    expect(deriveEnrolmentSas(BASE)).toMatch(/^\d{6}$/);
  });

  it('pads a small value rather than emitting a short string', () => {
    // The padding branch is reached for ~10% of inputs, so it is searched for
    // rather than left to chance on one fixture.
    let padded: string | null = null;
    for (let i = 0; i < 5000 && !padded; i += 1) {
      const candidate = deriveEnrolmentSas({ ...BASE, inviteId: `inv_${i}` });
      if (candidate.startsWith('0')) padded = candidate;
    }
    expect(padded).not.toBeNull();
    expect(padded).toHaveLength(6);
  });

  // The whole point: a different enrolment key must change the digits, or a
  // substituted key would pass the comparison unnoticed.
  it('changes when the agreement key changes', () => {
    expect(deriveEnrolmentSas({ ...BASE, agreementPublicKeyHex: 'cc'.repeat(32) })).not.toBe(
      deriveEnrolmentSas(BASE),
    );
  });

  it('changes when the signing key changes', () => {
    expect(deriveEnrolmentSas({ ...BASE, signingPublicKeyHex: 'cc'.repeat(32) })).not.toBe(
      deriveEnrolmentSas(BASE),
    );
  });

  it('changes when the invite changes, so digits cannot be replayed onto another enrolment', () => {
    expect(deriveEnrolmentSas({ ...BASE, inviteId: 'inv_other' })).not.toBe(deriveEnrolmentSas(BASE));
  });

  /**
   * The secret is what stops an adversary that can see the claimed keys from
   * grinding its own keypair to a matching SAS: without it, six digits is ~10^6
   * tries. If the derivation ever stopped depending on it, that defence would be
   * gone while every other test here still passed.
   */
  it('changes when the invite secret changes', () => {
    expect(deriveEnrolmentSas({ ...BASE, inviteSecret: 'f'.repeat(32) })).not.toBe(
      deriveEnrolmentSas(BASE),
    );
  });

  it('ignores hex case and surrounding whitespace — only the bytes are meaningful', () => {
    expect(
      deriveEnrolmentSas({
        ...BASE,
        signingPublicKeyHex: BASE.signingPublicKeyHex.toUpperCase(),
        agreementPublicKeyHex: ` ${BASE.agreementPublicKeyHex.toUpperCase()} `,
      }),
    ).toBe(deriveEnrolmentSas(BASE));
  });

  /**
   * Field boundaries must be unambiguous: concatenated without a separator,
   * moving a character from one field into the next would produce the same
   * digest and two different enrolments would verify alike.
   */
  it('does not collide when a character moves across a field boundary', () => {
    const a = deriveEnrolmentSas({
      ...BASE,
      inviteId: 'inv_ab',
      inviteSecret: `cd${'e'.repeat(30)}`,
    });
    const b = deriveEnrolmentSas({
      ...BASE,
      inviteId: 'inv_abc',
      inviteSecret: `d${'e'.repeat(30)}`,
    });
    expect(a).not.toBe(b);
  });
});

describe('formatEnrolmentSas', () => {
  it('groups for reading aloud without changing the value', () => {
    expect(formatEnrolmentSas('123456')).toBe('123 456');
  });

  it('keeps a leading zero visible', () => {
    expect(formatEnrolmentSas('012345')).toBe('012 345');
  });
});
