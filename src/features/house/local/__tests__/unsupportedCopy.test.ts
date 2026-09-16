/**
 * P4 member-facing copy (plan §9, DoD H7).
 *
 * The DoD line is *"Every P4 feature shows explicit member-facing copy in the
 * House brand voice (no raw error strings)."* Two failure modes make that easy
 * to regress, and each gets a mechanical check rather than a reviewer's memory:
 *
 *  1. **A new disabled method with no copy** — silently falls back to the
 *     generic sentence, which is how "explicit copy per feature" decays into one
 *     shrug for everything. The first suite below walks the actual throw sites
 *     in `src/features/house/local/**` and fails on any that has no entry.
 *  2. **An identifier leaking into copy** — `error.message` is rendered by
 *     screens, so a method name or a code in the string is exactly the raw error
 *     the DoD rules out.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { HouseLocalUnsupportedError } from '../errors';
import {
  HOUSE_UNSUPPORTED_COPY,
  HOUSE_UNSUPPORTED_FALLBACK,
  getHouseUnsupportedCopy,
} from '../unsupportedCopy';

const LOCAL_DIR = join(__dirname, '..');

/** Every literal passed to `new HouseLocalUnsupportedError('…')` in the tree. */
function throwSiteMethods(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(LOCAL_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const src = readFileSync(join(LOCAL_DIR, file), 'utf8');
    for (const m of src.matchAll(/new HouseLocalUnsupportedError\(\s*'([^']+)'/g)) {
      found.add(m[1]!);
    }
  }
  return [...found].sort();
}

describe('every P4 throw site has explicit copy', () => {
  it('finds the throw sites at all (guards the guard)', () => {
    // If the regex ever stops matching, every assertion below passes vacuously.
    expect(throwSiteMethods().length).toBeGreaterThan(0);
  });

  it.each(throwSiteMethods())('%s has its own entry, not the fallback', (method) => {
    expect(HOUSE_UNSUPPORTED_COPY[method]).toBeDefined();
    expect(getHouseUnsupportedCopy(method)).not.toBe(HOUSE_UNSUPPORTED_FALLBACK);
  });

  it('has no copy for a method that no longer throws', () => {
    // Dead copy is a smaller problem than missing copy, but it still means the
    // map and the code have drifted.
    const live = new Set(throwSiteMethods());
    expect(Object.keys(HOUSE_UNSUPPORTED_COPY).filter((k) => !live.has(k))).toEqual([]);
  });
});

describe('copy contains nothing a member should not read', () => {
  const entries = [...Object.entries(HOUSE_UNSUPPORTED_COPY), ['<fallback>', HOUSE_UNSUPPORTED_FALLBACK] as const];

  it.each(entries)('%s reads as product copy', (_key, copy) => {
    const text = `${copy.title} ${copy.message}`;
    // No identifiers: dotted method names, snake_case codes, or the error name.
    expect(text).not.toMatch(/[a-z]+\.[a-zA-Z]+\(/);
    expect(text).not.toMatch(/[a-z]+_[a-z]+/);
    expect(text).not.toContain('HouseLocal');
    expect(text).not.toContain('undefined');
    // No jargon that means nothing to a member.
    expect(text.toLowerCase()).not.toContain('unsupported');
    expect(text.toLowerCase()).not.toContain('e2ee');
    expect(text.toLowerCase()).not.toContain('ciphertext');
  });

  it.each(entries)('%s says what still works, not just what does not', (_key, copy) => {
    // The half that makes it usable copy rather than a dead end. Every entry
    // names an alternative or something that keeps working.
    expect(copy.message.length).toBeGreaterThan(80);
    expect(copy.message).toMatch(/still|instead|can|work|keep/i);
  });

  it.each(entries)('%s has a title short enough for a sheet header', (_key, copy) => {
    expect(copy.title.length).toBeLessThanOrEqual(60);
    expect(copy.title).not.toMatch(/[.]$/);
  });
});

describe('HouseLocalUnsupportedError surfaces the copy, not the identifier', () => {
  it('puts member-facing text in `message`, where screens read it', () => {
    const error = new HouseLocalUnsupportedError('garbage-collection.aiDetect');
    expect(error.message).toBe(HOUSE_UNSUPPORTED_COPY['garbage-collection.aiDetect']!.message);
    // The regression this prevents: the old message embedded the identifier.
    expect(error.message).not.toContain('garbage-collection.aiDetect');
  });

  it('keeps the identifier available for logs', () => {
    const error = new HouseLocalUnsupportedError('tasks.getTaskQuotes');
    expect(error.method).toBe('tasks.getTaskQuotes');
    expect(error.title).toBe(HOUSE_UNSUPPORTED_COPY['tasks.getTaskQuotes']!.title);
  });

  it('still classifies as its own error, so callers can branch on it', () => {
    const error = new HouseLocalUnsupportedError('tasks.getTaskQuotes');
    expect(error).toBeInstanceOf(HouseLocalUnsupportedError);
    expect(error.code).toBe('house_local_unsupported');
  });

  it('falls back safely for an unknown method without leaking its name', () => {
    const error = new HouseLocalUnsupportedError('something.brandNew');
    expect(error.message).toBe(HOUSE_UNSUPPORTED_FALLBACK.message);
    expect(error.message).not.toContain('something.brandNew');
    expect(error.method).toBe('something.brandNew');
  });
});
