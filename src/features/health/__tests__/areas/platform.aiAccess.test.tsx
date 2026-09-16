/**
 * Symply Health — the BYOK / AI-access entry and the legal surface, as REUSE
 * contracts.
 *
 * Health does not own any of this code: the entry hook (`useAIAccessEntry`), the
 * eight `app/ai-access/*` screens and the legal documents are shared platform.
 * What Health owns is the promise that it uses them UNFORKED — the whole reason
 * the hook exists is that every brand used to wire its own destination, gate and
 * copy. So the cases here are the ones nobody else can write:
 *
 *   • the entry must not consult the active brand at all (anti-fork guard,
 *     anchored on real module reads rather than on a grep);
 *   • the destination Health pushes to must exist as a resolvable route;
 *   • Health's legal posture is recorded as the GAP it is.
 *
 * Deliberately NOT here: the row's rendering, its gate on the More tab and its
 * subtitle — `src/features/health/screens/__tests__/HealthMoreScreen.test.tsx`
 * drives the real screen with a mutable entry mock, and
 * `src/components/ai/__tests__/useAIAccessEntry.test.ts` drives the hook against
 * every entitlement shape. Re-rendering that screen here would duplicate both.
 *
 * No shared source is modified.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- the guards below resolve modules deliberately, at run time */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { AI_ACCESS_ROUTE, useAIAccessEntry } from '@components/ai/useAIAccessEntry';
import { getLegalContent } from '@config/brandContent';

const HEALTH_BRAND_ID = 'symply-health';

/**
 * `@brand` pinned to the Health pack AND instrumented: every property read is
 * recorded on a global (a module-scoped array would be in its temporal dead zone
 * when the hoisted factory first runs). `brandReads()` is cleared per test, so
 * what it holds is exactly what the code under test read.
 */
jest.mock('@brand', () => {
  const g = globalThis as unknown as { __healthBrandReads?: string[] };
  g.__healthBrandReads = g.__healthBrandReads ?? [];
  const actual = jest.requireActual('@brand');
  const pack = require('../../../../../brands/symply-health/brand.cjs');
  return new Proxy(actual, {
    get(target, prop) {
      if (typeof prop === 'string') g.__healthBrandReads?.push(prop);
      if (prop === 'brand') return pack;
      if (prop === 'brandId') return pack.id;
      return Reflect.get(target, prop);
    },
  });
});

function brandReads(): string[] {
  const g = globalThis as unknown as { __healthBrandReads?: string[] };
  // Created lazily: if `@brand` is never required at all — which is itself the
  // strongest form of the guard below — the mock factory never runs and the
  // array would otherwise not exist.
  g.__healthBrandReads = g.__healthBrandReads ?? [];
  return g.__healthBrandReads;
}

const mockEntitlement = jest.fn();
jest.mock('@hooks/useAIEntitlement', () => ({
  useAIEntitlement: () => mockEntitlement(),
}));

/** A member with AI available and nothing connected yet. */
const BASE = {
  aiFeaturesEnabled: true,
  bringYourOwnAIEnabled: true,
  subscriptionsEnabled: false,
  source: null as string | null,
  provider: null as string | null,
  byokConnections: [] as Array<{ provider: string }>,
};

/** Render the hook through a probe and return the resolved entry. */
function resolveEntry() {
  let captured!: ReturnType<typeof useAIAccessEntry>;
  function Probe() {
    captured = useAIAccessEntry();
    return null;
  }
  act(() => {
    ReactTestRenderer.create(createElement(Probe));
  });
  return captured;
}

beforeEach(() => {
  jest.clearAllMocks();
  brandReads().length = 0;
  mockEntitlement.mockReturnValue({ ...BASE });
});

describe('Health AI entry — one entry for every brand (HEALTH-MORE-085..086)', () => {
  it('HEALTH-MORE-085: never consults the active brand while resolving the entry', () => {
    // The anti-fork guard, stated as behaviour rather than as a string search:
    // the moment someone adds `if (isHealthBrand())` to the entry, this records
    // a read of the brand module and fails. Per-brand AI entries are exactly
    // what this hook was built to delete.
    const entry = resolveEntry();

    expect(entry.show).toBe(true);
    expect(brandReads()).toEqual([]);
  });

  it('HEALTH-MORE-086: resolves the same route, title and icon Health’s More tab renders', () => {
    const entry = resolveEntry();

    // These four values are what `HealthMoreScreen` passes straight into its row
    // primitive; the screen is required to use them verbatim.
    expect(entry.route).toBe(AI_ACCESS_ROUTE);
    expect(AI_ACCESS_ROUTE).toBe('/ai-access');
    expect(entry.title).toBe('AI assistance');
    expect(entry.icon).toBe('sparkles-outline');
    expect(entry.subtitle).toBe('Connect OpenAI, Claude, or Gemini');
  });

  it('HEALTH-MORE-087: the gate is the entitlement’s, not Health’s', () => {
    // Health has no say in this: an AI-less member sees no entry, and the brand
    // module is still never read on either path.
    mockEntitlement.mockReturnValue({ ...BASE, aiFeaturesEnabled: false });
    expect(resolveEntry().show).toBe(false);
    expect(brandReads()).toEqual([]);

    mockEntitlement.mockReturnValue({
      ...BASE,
      bringYourOwnAIEnabled: false,
      subscriptionsEnabled: true,
    });
    expect(resolveEntry().show).toBe(true);
    expect(brandReads()).toEqual([]);
  });
});

describe('Health AI entry — the destination exists (HEALTH-MORE-088)', () => {
  it('HEALTH-MORE-088: every screen of the shared /ai-access hub resolves as a route module', () => {
    // Health's row pushes `/ai-access`, and the hub pushes on to the rest.
    // expo-router derives each route from a FILE, so a renamed or deleted screen
    // is a dead end at run time and nothing else in the type system notices.
    // Resolution (not import) on purpose: these screens pull RevenueCat and the
    // Keychain, which do not belong in this suite.
    const routes = [
      'index',
      'connect',
      'providers',
      'models',
      'manage',
      'change-key',
      'paywall',
      'provider/[provider]',
    ];
    for (const route of routes) {
      expect(() =>
        require.resolve(`../../../../../app/ai-access/${route}`),
      ).not.toThrow();
    }
  });
});

/**
 * POSTURE GUARD — Symply Health has the legal ROUTES now, but still no door.
 *
 * The CONTENT exists (`getLegalContent('symply-health')`) and so do the two
 * shared screens. What used to be missing as well was any expo-router file for
 * them: both screens were `SettingsStackScreenProps` screens reachable only
 * through House's react-navigation Settings stack, and Health runs on
 * expo-router. `app/terms-of-service.tsx` and `app/privacy-policy.tsx` landed
 * with the More-tab restructure (House and full Budget both reach the documents
 * from PROFILE now, which is a sibling tab of the one hosting that stack), and
 * they carry no brand gate — so the route half of this gap is closed and the
 * assertion below is inverted rather than loosened.
 *
 * What is STILL missing is the row: `HealthMoreScreen` links to neither path, so
 * a Health member has no way to arrive at a URL that would now work. That is the
 * remaining GAP, and it is what the second half of this test pins.
 *
 * Delete this describe when a Health row lands — do not loosen it. That is also
 * when the matrix rows and the `more-settings-controls.yaml` assertions have to
 * be written.
 */
describe('Health legal posture — routes without a door (HEALTH-MORE-089)', () => {
  it('HEALTH-MORE-089: the legal routes exist, but Health links to neither', () => {
    // The copy is real and brand-specific — the gap is the wiring, not the text.
    const legal = getLegalContent(HEALTH_BRAND_ID);
    expect(legal.serviceDescription).toMatch(/health and wellness application/i);
    expect(legal.dataItems.join(' ')).toMatch(/health metrics/i);
    expect(legal).not.toBe(getLegalContent('symply-house'));

    // …and the shared screens that render it exist.
    expect(() =>
      require.resolve('../../../../screens/settings/TermsOfServiceScreen'),
    ).not.toThrow();
    expect(() =>
      require.resolve('../../../../screens/settings/PrivacyPolicyScreen'),
    ).not.toThrow();

    // Both now have an expo-router file, which is the only kind of route Health
    // can reach, and neither is brand-gated.
    for (const route of ['terms-of-service', 'privacy-policy']) {
      expect(() => require.resolve(`../../../../../app/${route}`)).not.toThrow();
    }

    // But nothing on Health's More tab points at them, so the member still
    // cannot get there. Delete this whole describe when a row lands.
    const moreScreen = readFileSync(
      resolve(__dirname, '../../screens/HealthMoreScreen.tsx'),
      'utf8',
    );
    expect(moreScreen).not.toContain('/terms-of-service');
    expect(moreScreen).not.toContain('/privacy-policy');
  });
});
