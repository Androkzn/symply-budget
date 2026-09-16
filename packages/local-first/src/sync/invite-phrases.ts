import { randomBytes } from '../crypto/bytes';

/** Short memorable words for OOB invite verification (D-14). */
const WORD_LIST = [
  'amber',
  'birch',
  'cedar',
  'delta',
  'ember',
  'flint',
  'grove',
  'haven',
  'ivory',
  'jade',
  'kite',
  'lotus',
  'maple',
  'nova',
  'orbit',
  'pearl',
  'quartz',
  'river',
  'sage',
  'tide',
  'umbra',
  'vale',
  'willow',
  'zenith',
] as const;

export type OobChallenge = {
  phrases: [string, string, string];
  correctIndex: 0 | 1 | 2;
};

export function generateOobChallenge(): OobChallenge {
  const used = new Set<number>();
  const phrases: string[] = [];
  while (phrases.length < 3) {
    const idx = randomBytes(1)[0]! % WORD_LIST.length;
    if (used.has(idx)) continue;
    used.add(idx);
    phrases.push(WORD_LIST[idx]!);
  }
  const correctIndex = (randomBytes(1)[0]! % 3) as 0 | 1 | 2;
  return {
    phrases: [phrases[0]!, phrases[1]!, phrases[2]!],
    correctIndex,
  };
}

export function generateInviteSecret(): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateShortCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}
