/**
 * Symply Health — DeskHero POSTURE guard.
 *
 * ## What DeskHero is, and why there are no feature tests here
 *
 * DeskHero is the donor's standing-time coach: 7 files / 1,615 lines under
 * `Simply Health/.../DeskHero/` — a stand ring, a streak, achievements, an
 * hourly standing chart, a weekly standing chart, work-hours settings and
 * break reminders. **None of it is ported.**
 * `documents/apps/symply-health/UI_PARITY_AUDIT.md` scores the area 0 % (rows
 * 33, 489, 556, 770) and names the blocker precisely: it needs HealthKit
 * *stand hours* (`HKCategoryTypeIdentifierAppleStandHour`), i.e. a SIXTH
 * scoped read type — and widening the HealthKit request is a product +
 * privacy decision, not a code one (`healthKitTypes.ts` header).
 *
 * There is therefore no DeskHero screen, route, component, store, backend
 * table, backend route or HealthKit type to test, and this file deliberately
 * contains **no** test pretending otherwise. What it contains instead is the
 * guard the donor's own dead code earns us, plus the two properties that must
 * still hold on the day someone does port it.
 *
 * ## The defect this generalises
 *
 * `components/HealthDashboardCards.tsx:24` records why only three of the
 * donor's nine dashboard widget kinds came across, and notes that `deskHero`
 * is *"dead code there — renders nothing"*: it sits in the donor's catalogue,
 * it occupies a slot, and the renderer has no arm for it, so the user gets a
 * hole where a tile should be. That is a catalogue/renderer split that
 * drifted, and it is exactly what a future porter can reintroduce here the
 * moment they add a `deskHero` tile ahead of the surface that fills it.
 *
 * So the guard below is NOT "assert the string `deskHero` is absent" — that is
 * a grep in a trench coat and it drifts the day someone renames it. It asserts
 * the property the donor lost, on the code that actually ships:
 *
 *   **the Home dashboard's renderers are TOTAL over their catalogue.**
 *
 * Every entry handed in comes back out as exactly one addressable, describable,
 * reachable node — including an entry of a kind the renderer has never heard
 * of, carrying an icon slug no brand kit ships. `HealthDashboardCards`,
 * `HealthDayRings` and `HealthActivityFeed` are total today because each is a
 * bare `.map`. The moment one becomes `switch (card.key)` — the shape the donor
 * had — an unhandled kind renders nothing and these tests go red. That protects
 * every future card, not just this one.
 *
 * The companion half is `HEALTH-DESK-030`: a tile that renders but points at a
 * route that does not exist is the same defect one layer down — it looks alive
 * and does nothing.
 *
 * ## When to delete this file
 *
 * `HEALTH-DESK-040/041` pin the *absence* of stand hours end-to-end. They are
 * the ones a DeskHero port must consciously break. When stand hours become a
 * sixth scoped type (with a purpose string, an `Info.plist` entry and matrix
 * rows), delete those two, keep the catalogue-totality group — it is not about
 * DeskHero at all — and write the real `HEALTH-DESK-1xx` rows from
 * `<scratch>/matrix-deskhero.md`.
 *
 * Existing coverage this file deliberately does NOT repeat:
 *   · per-card accessibility labels, captions and routing — `HEALTH-HOME-114…117`,
 *     `121`, `122` in `components/__tests__/HealthBodyDashboard.test.tsx`;
 *   · the five-type HealthKit scope and the absence of the donor's ~30 reads —
 *     `HEALTH-HK-001…003`; the Swift allow-list — `HEALTH-HK-340`.
 * Those check single layers. This file checks totality, and the composition.
 */

import fs from 'fs';
import path from 'path';

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  HealthActivityFeed,
  HealthDashboardCards,
  HealthDayRings,
  type HealthActivityItem,
  type HealthDayRing,
  type HealthGlanceCard,
} from '../../components/HealthDashboardCards';
import { createHealthKitService, createInMemoryHealthKitStore } from '../../healthKit';
import { createNativeHealthKitBridge, type HealthKitNativeModule } from '../../healthKitBridge';
import {
  HEALTHKIT_DATA_TYPES,
  HEALTHKIT_READ_IDENTIFIERS,
  HEALTHKIT_WORKOUT_IDENTIFIER,
  descriptorForIdentifier,
  isHealthKitDataType,
  isScopedIdentifier,
} from '../../healthKitTypes';

type Rendered = ReactTestRenderer.ReactTestRenderer;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

/**
 * Every host node that is BOTH addressable (`testID`) and describable
 * (`accessibilityLabel`) — this repo's working definition of a tile a member
 * can find and a screen reader can announce.
 *
 * De-duplicated by id, so the assertion survives a Pressable that renders more
 * than one host node, and sorted so it reads as a SET comparison: nothing
 * dropped, nothing invented.
 */
function tileIds(tree: Rendered): string[] {
  const rendered = tree.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props?.testID === 'string' &&
        typeof node.props?.accessibilityLabel === 'string',
    )
    .map((node) => node.props.testID as string);
  return [...new Set(rendered)].sort();
}

/** Fire onPress on the composite carrying `testID`, if it has one. */
function press(tree: Rendered, testID: string): void {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
  act(() => node.props.onPress());
}

/** Flatten every string in the rendered host tree, preserving concatenation. */
function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function ids<T extends { testID: string }>(catalogue: readonly T[]): string[] {
  return catalogue.map((entry) => entry.testID).sort();
}

/**
 * The unknown icon slugs below are the POINT of these fixtures, and `<Icon>`
 * degrades them to a tinted Ionicons glyph — which `@expo/vector-icons` warns
 * about once per name. That warning is the expected, non-throwing path, so it
 * is silenced here rather than left to look like a failure in the run output.
 */
let warnSpy: jest.SpyInstance;

beforeAll(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  warnSpy.mockRestore();
});

/* ==================================================================== */
/* The catalogue fixtures                                               */
/* ==================================================================== */

/**
 * A glance catalogue shaped like the one `HealthHomeScreen` builds, plus the
 * donor's dead kind.
 *
 * `deskHero` carries an icon slug (`desk-hero`) that NO brand kit ships, so it
 * also proves the second half of the property: an unknown icon falls through
 * to the Ionicons fallback in `<Icon>` rather than throwing and taking the
 * whole grid — one bad tile must not render the other three as nothing.
 */
const GLANCE_CATALOGUE: HealthGlanceCard[] = [
  {
    key: 'water',
    icon: 'hydration',
    label: 'Water',
    value: '3',
    caption: 'of 8 cups',
    route: '/health-trends',
    testID: 'desk-card-water',
  },
  {
    key: 'habits',
    icon: 'streak',
    label: 'Habits',
    value: '2/5',
    caption: 'done today',
    route: '/health-habits',
    testID: 'desk-card-habits',
  },
  {
    key: 'deskHero',
    icon: 'desk-hero',
    label: 'Stand',
    value: '9/12',
    caption: 'hours',
    route: '/health-activity',
    testID: 'desk-card-desk-hero',
  },
];

describe('the Home dashboard card catalogue has no card that renders nothing', () => {
  it('HEALTH-DESK-001: every catalogue entry becomes exactly one tile, unknown kinds included', () => {
    const tree = render(
      <HealthDashboardCards cards={GLANCE_CATALOGUE} onOpen={jest.fn()} />,
    );

    // Set equality both ways: no entry silently skipped, no tile invented.
    expect(tileIds(tree)).toEqual(ids(GLANCE_CATALOGUE));

    // And the unknown kind renders its CONTENT, not an empty box — a tile that
    // is present but blank is the donor's defect with extra steps.
    const rendered = allText(tree.toJSON());
    expect(rendered).toContain('Stand');
    expect(rendered).toContain('9/12');
    expect(rendered).toContain('hours');
  });

  it('HEALTH-DESK-002: every tile is a way into its own tab — none is inert decoration', () => {
    const onOpen = jest.fn();
    const tree = render(<HealthDashboardCards cards={GLANCE_CATALOGUE} onOpen={onOpen} />);

    for (const card of GLANCE_CATALOGUE) {
      press(tree, card.testID);
    }

    // The donor's deskHero tile went nowhere. Every tile here routes, and to
    // its OWN route — a shared destination would make the grid a lie.
    expect(onOpen.mock.calls).toEqual(GLANCE_CATALOGUE.map((card) => [card.route]));
  });

  it('HEALTH-DESK-003: an empty catalogue draws nothing at all, not a placeholder tile', () => {
    const tree = render(<HealthDashboardCards cards={[]} onOpen={jest.fn()} />);
    expect(tileIds(tree)).toEqual([]);
  });

  it('HEALTH-DESK-010: every goal ring is rendered, including one with nowhere to go', () => {
    // A ring without a `route` is a real shipped state (Home only routes three
    // of them today), and the renderer must still DRAW it — just not announce
    // it as a button. Dropping it would be the deskHero hole in ring form.
    const rings: HealthDayRing[] = [
      {
        key: 'calories',
        label: 'Calories',
        value: 1200,
        target: 2000,
        suffix: 'kcal',
        route: '/health-nutrition',
        testID: 'desk-ring-calories',
      },
      {
        key: 'standHours',
        label: 'Stand',
        value: 9,
        target: 12,
        suffix: 'hrs',
        testID: 'desk-ring-stand',
      },
    ];
    const onOpen = jest.fn();
    const tree = render(<HealthDayRings rings={rings} onOpen={onOpen} />);

    expect(tileIds(tree)).toEqual(ids(rings));
    expect(allText(tree.toJSON())).toContain('Stand');

    const routeless = tree.root.find(
      (n) => typeof n.type === 'string' && n.props?.testID === 'desk-ring-stand',
    );
    expect(routeless.props.accessibilityRole).toBeUndefined();
    expect(routeless.props.onPress).toBeUndefined();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('HEALTH-DESK-020: the activity feed renders one row per item, unknown icons included', () => {
    const items: HealthActivityItem[] = [
      {
        id: 'meal-m1',
        icon: 'lunch',
        title: 'Chicken salad',
        detail: '520 kcal · Lunch',
        at: '2026-07-25T12:00:00.000Z',
        route: '/health-nutrition',
      },
      {
        id: 'stand-s1',
        icon: 'desk-hero',
        title: 'Stood up',
        detail: '9 of 12 hours',
        at: '2026-07-25T11:00:00.000Z',
        route: '/health-activity',
      },
    ];
    const tree = render(
      <HealthActivityFeed
        items={items}
        onOpen={jest.fn()}
        formatAt={() => 'Today'}
        testID="desk-feed"
        emptyLabel="Nothing logged yet."
      />,
    );

    expect(tileIds(tree)).toEqual(items.map((item) => `desk-feed-item-${item.id}`).sort());
    expect(allText(tree.toJSON())).toContain('Stood up');
  });
});

/* ==================================================================== */
/* No dead links out of the dashboard                                    */
/* ==================================================================== */

/**
 * Every `/health-…` destination a Home dashboard entry can carry, read out of
 * the two modules that produce them: the screen that BUILDS the catalogue and
 * the module that builds the activity feed's routes.
 */
function healthRoutesDeclaredIn(...segments: string[]): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');
  const literals = source.match(/'\/health-[a-z-]+'/g) ?? [];
  return literals.map((literal) => literal.slice(1, -1));
}

describe('no dashboard card points somewhere that does not exist', () => {
  it('HEALTH-DESK-030: every route the Home catalogue can emit is a real expo-router file', () => {
    const routes = [
      ...new Set([
        ...healthRoutesDeclaredIn('src', 'features', 'health', 'screens', 'HealthHomeScreen.tsx'),
        ...healthRoutesDeclaredIn(
          'src',
          'features',
          'health',
          'components',
          'HealthDashboardCards.tsx',
        ),
      ]),
    ].sort();

    // Self-check first: an extraction that silently found nothing would make
    // the loop below vacuously green. Home ships four distinct destinations
    // (Nutrition/Activity/Trends/Challenges — Weight moved to its own tab-only
    // entry point, dropped from the Home catalogue).
    expect(routes.length).toBeGreaterThanOrEqual(4);

    const missing = routes.filter(
      (route) => !fs.existsSync(path.join(REPO_ROOT, 'app', '(tabs)', `${route.slice(1)}.tsx`)),
    );
    expect(missing).toEqual([]);
  });
});

/* ==================================================================== */
/* DeskHero's blocker: stand hours are not in the request               */
/* ==================================================================== */

/** The read type DeskHero needs, and the only reason the area is 0 %. */
const STAND_HOUR = 'HKCategoryTypeIdentifierAppleStandHour';

/**
 * A native module that VOLUNTEERS stand hours: it reports the type authorised
 * whether or not it was asked about it, and it answers any query it is handed.
 *
 * This is not paranoia about Apple. It is the shape a half-finished DeskHero
 * port takes: someone adds `.appleStandHour` to `SymplyHealthKitModule.swift`
 * to start prototyping, and the JS side must not begin reading — or claiming a
 * grant for — a type that never went through the privacy review.
 */
function hostileNativeModule(): {
  native: HealthKitNativeModule;
  asked: string[];
  queried: string[];
} {
  const asked: string[] = [];
  const queried: string[] = [];

  const answer = async (identifiers: string[]): Promise<Record<string, string>> => {
    asked.push(...identifiers);
    return Object.fromEntries(
      [...identifiers, STAND_HOUR].map((identifier) => [identifier, 'sharingAuthorized']),
    );
  };

  const native: HealthKitNativeModule = {
    isAvailable: async () => true,
    getAuthorizationStatus: answer,
    requestAuthorization: answer,
    querySamples: async (identifier, startMs) => {
      queried.push(identifier);
      const unit = descriptorForIdentifier(identifier)?.unit;
      // An out-of-scope identifier has no descriptor; answer anyway, so the
      // test proves the query never HAPPENS rather than that it came back empty.
      return [
        { startedAt: startMs + 1, endedAt: startMs + 1, value: 1, unit: unit ?? 'count' },
      ];
    },
    queryWorkouts: async () => [],
    consumePendingSync: async () => false,
    addListener: () => ({ remove: () => {} }),
  };

  return { native, asked, queried };
}

describe('stand hours — the DeskHero blocker — cannot arrive by accident', () => {
  it('HEALTH-DESK-040: stand hours are unknown to the scoped type contract', () => {
    // Three independent refusals, because a port will touch these one at a time.
    expect(descriptorForIdentifier(STAND_HOUR)).toBeNull();
    expect(isScopedIdentifier(STAND_HOUR)).toBe(false);
    expect(isHealthKitDataType('standHours')).toBe(false);
    expect(HEALTHKIT_READ_IDENTIFIERS).not.toContain(STAND_HOUR);
  });

  it('HEALTH-DESK-041: native module + bridge + service composed still ask only the scoped types', async () => {
    // `healthKit.test.ts` proves the service against a fake BRIDGE and
    // `healthKitBridge.test.ts` proves the bridge against a fake NATIVE module.
    // Nothing composes the two, which is where a widened scope would actually
    // land: the service asks, the bridge filters, the module over-answers.
    const { native, asked, queried } = hostileNativeModule();
    const service = createHealthKitService({
      bridge: createNativeHealthKitBridge(native),
      store: createInMemoryHealthKitStore(),
      now: () => new Date(2026, 6, 25, 12, 0, 0),
    });

    const status = await service.requestPermission();

    // Nothing outside the published five is ever handed to iOS…
    expect(asked).not.toContain(STAND_HOUR);
    expect([...new Set(asked)].sort()).toEqual([...HEALTHKIT_READ_IDENTIFIERS].sort());
    // …and a stand-hour grant the module volunteered does not become state.
    expect(Object.keys(status.perType).sort()).toEqual([...HEALTHKIT_DATA_TYPES].sort());

    for (const type of HEALTHKIT_DATA_TYPES) {
      await service.readWindow(type);
    }

    // Every scalar scoped read happens, in card order — EXCEPT the workout
    // sentinel, which `readWindow`/`querySamples` never carries: workouts have
    // their own query method (`queryWorkouts`), never exercised by this loop.
    // Stand hours never appear either way.
    expect(queried).toEqual(
      HEALTHKIT_READ_IDENTIFIERS.filter((id) => id !== HEALTHKIT_WORKOUT_IDENTIFIER),
    );
    expect(queried).not.toContain(STAND_HOUR);
  });
});
