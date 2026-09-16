/**
 * Symply Health — Men's Health "What to show": the donor's settings sheet,
 * ported against `/health/mens-health/settings`.
 *
 * This is a display preference, and on this tab that matters more than anywhere
 * else in the app: it is what lets someone keep a vitality log without being
 * asked, every single day, about the one thing they would rather not be asked
 * about. Three properties therefore have to hold, and none of them had a test:
 *
 *   1. **Switching a section off hides it and NOTHING else.** The card promises
 *      "Anything you already logged stays exactly as it was". If hiding the
 *      ENERGY & MIND card also dropped its values out of the entry — or out of
 *      the score — the promise would be false and the ring would move for a
 *      reason the person never chose.
 *   2. **A partial patch writes the WHOLE column set.** The route spreads the
 *      body straight into the UPDATE, so `saveMensTrackSettings` builds every
 *      key from a fixed column map. Sending only the changed key would work
 *      until the day someone added a column; sending an unmapped key fails the
 *      whole write.
 *   3. **A missing column keeps its DEFAULT, not `false`.** The settings row is
 *      created lazily and D1 returns booleans as 0/1 through some paths. Reading
 *      "absent" as "off" would silently blank the tab for anyone whose row
 *      predates a new section.
 *
 * Everything below runs against the REAL store and the REAL screen, with only
 * `@api/health` mocked — the whole point is the round trip from a toggle to a
 * wire body and back to a hidden card.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { healthApi, type HealthMensSettings } from '@api/health';
import { ThemeProvider } from '@contexts/ThemeContext';
import { storageHelpers } from '@services/storage';

import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../../healthRepository';
import {
  DEFAULT_MENS_TRACK_SETTINGS,
  HEALTH_MENS_SETTINGS_KEY,
  loadMensTrackSettings,
  MENS_TRACK_COLUMN,
  MENS_TRACK_LABELS,
  MENS_TRACK_PRESETS,
  MENS_TRACK_SECTIONS,
  saveMensTrackSettings,
} from '../../healthVitalityStorage';
import { HealthVitalityScreen } from '../../screens/HealthVitalityScreen';
import {
  installHealthApiDefaults,
  mensRow,
  NETWORK_ERROR,
  ok,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// This suite renders the screen standalone, with no real NavigationContainer,
// so the real `useFocusEffect` (used to re-hydrate on focus/HealthKit sync)
// would throw the instant it mounts. Same inert-callback shim
// HealthSectionScreens.test.tsx uses.
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

/** The eight columns the screen owns, in `MENS_TRACK_SECTIONS` order. */
const OWNED_COLUMNS = [
  'track_libido',
  'track_sexual_desire',
  'track_sexual_activity',
  'track_morning_erection',
  'track_erotic_dreams',
  'track_issues',
  'track_energy',
  'track_kegels',
];

/** A `mens_health_settings` row, defaulting every column ON like the DDL. */
function settingsRow(over: Record<string, unknown> = {}): HealthMensSettings {
  return {
    id: 'mhs-1',
    user_id: 'user-1',
    track_libido: true,
    track_sexual_activity: true,
    track_sexual_desire: true,
    track_night_erection: true,
    track_morning_erection: true,
    track_day_erection: true,
    track_erotic_dreams: true,
    track_issues: true,
    track_energy: true,
    track_kegels: true,
    track_exercise: true,
    reminder_enabled: false,
    reminder_time: null,
    updated_at: '2026-07-13T09:00:00.000Z',
    ...over,
  } as HealthMensSettings;
}

/** Install the two settings stubs the shared kit does not yet carry. */
function installSettingsDefaults(row: HealthMensSettings | null = null) {
  api.getMensHealthSettings.mockResolvedValue(ok({ settings: row }));
  api.saveMensHealthSettings.mockResolvedValue(ok({ settings: settingsRow() }));
}

/**
 * The timer calls `.catch()` on whatever `impactAsync` returns, so the haptics
 * stubs must resolve rather than merely exist.
 */
function installHapticsDefaults() {
  const haptics = jest.requireMock('expo-haptics') as {
    impactAsync: jest.Mock;
    notificationAsync: jest.Mock;
  };
  haptics.impactAsync.mockResolvedValue(undefined);
  haptics.notificationAsync.mockResolvedValue(undefined);
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  // CLEAR, not reset: these specs render the real screen, and `resetAllMocks`
  // also strips the expo-font / expo-asset stubs `jest.setup.js` installs —
  // every `<Icon>` then throws "Module 1 is missing from the asset registry"
  // and the whole tree fails to mount for a reason that has nothing to do with
  // the test. Implementations are re-installed below regardless.
  jest.clearAllMocks();
  installHealthApiDefaults(api);
  installSettingsDefaults();
  installHapticsDefaults();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

describe('mens tracking settings — the wire contract', () => {
  it('HEALTH-VITALITY-350: every section has a label and a real column, and nothing else is written', () => {
    // `mens_health_settings` also carries `track_night_erection`,
    // `track_day_erection` and `track_exercise`. The RN entry form has no
    // night/day erection or workout field, so a switch for them would hide
    // nothing — they are deliberately left at their stored values and never
    // written. This spec is what stops one being added to the map without a
    // section to go with it.
    expect(MENS_TRACK_SECTIONS).toHaveLength(8);
    for (const section of MENS_TRACK_SECTIONS) {
      expect(MENS_TRACK_LABELS[section]).toBeTruthy();
      expect(MENS_TRACK_COLUMN[section]).toMatch(/^track_[a-z_]+$/);
    }
    expect(MENS_TRACK_SECTIONS.map((s) => MENS_TRACK_COLUMN[s])).toEqual(OWNED_COLUMNS);
    // Every default is ON — matching the DDL, so a fresh account sees the whole
    // tab and opts OUT rather than having to discover the switches.
    expect(Object.values(DEFAULT_MENS_TRACK_SETTINGS).every(Boolean)).toBe(true);
  });

  it('HEALTH-VITALITY-351: no stored row means every section shows', async () => {
    installSettingsDefaults(null);

    expect(await loadMensTrackSettings()).toEqual(DEFAULT_MENS_TRACK_SETTINGS);
    expect(healthSyncStateFor(HEALTH_MENS_SETTINGS_KEY)).toBe('synced');
  });

  it('HEALTH-VITALITY-352: D1 integer booleans are read as booleans', async () => {
    // The same 0/1 problem the entries mapper has. A truthy `0` left as a number
    // would reach a checkbox as a number and gate a card on it.
    installSettingsDefaults(
      settingsRow({ track_issues: 0, track_kegels: 1, track_energy: 0 })
    );

    const loaded = await loadMensTrackSettings();
    expect(loaded.trackIssues).toBe(false);
    expect(loaded.trackKegels).toBe(true);
    expect(loaded.trackEnergy).toBe(false);
    expect(loaded.trackLibido).toBe(true);
  });

  it('HEALTH-VITALITY-353: a MISSING column keeps its default rather than becoming false', async () => {
    // The row is created lazily, and a section added later has no column on an
    // old row. Coercing `undefined`/`null` to `false` would blank part of the
    // tab for every existing user the day a section was added.
    const partial = settingsRow();
    delete (partial as unknown as Record<string, unknown>).track_kegels;
    (partial as unknown as Record<string, unknown>).track_issues = null;
    installSettingsDefaults(partial);

    const loaded = await loadMensTrackSettings();
    expect(loaded.trackKegels).toBe(true);
    expect(loaded.trackIssues).toBe(true);
  });

  it('HEALTH-VITALITY-354: a partial patch writes ALL EIGHT columns', async () => {
    // The route spreads the body straight into the UPDATE, so the body is built
    // from the fixed column map rather than from the patch. Sending only the
    // changed key would leave the other seven to the route's own defaults on the
    // INSERT path — i.e. a first-ever write of one `false` would silently reset
    // everything else.
    await saveMensTrackSettings({ trackIssues: false });

    const [body] = api.saveMensHealthSettings.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual([...OWNED_COLUMNS].sort());
    expect(body.track_issues).toBe(false);
    expect(body.track_libido).toBe(true);
    // The three columns with no section are NEVER touched.
    for (const untouched of ['track_night_erection', 'track_day_erection', 'track_exercise']) {
      expect([untouched, untouched in body]).toEqual([untouched, false]);
    }
    // …and every value is a real boolean, which the route's
    // `z.union([boolean, string, null])` requires (a 0/1 would be a 400).
    expect(Object.values(body).every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('HEALTH-VITALITY-355: a patch MERGES over what is stored, it does not replace it', async () => {
    installSettingsDefaults(settingsRow({ track_energy: false }));

    const next = await saveMensTrackSettings({ trackKegels: false });

    expect(next.trackEnergy).toBe(false); // preserved from the server row
    expect(next.trackKegels).toBe(false); // the patch
    expect(next.trackLibido).toBe(true);
    expect(api.saveMensHealthSettings.mock.calls[0][0]).toMatchObject({
      track_energy: false,
      track_kegels: false,
      track_libido: true,
    });
  });

  it('HEALTH-VITALITY-356: each preset is a COMPLETE settings object', async () => {
    // A preset with a missing key would leave that section at whatever it
    // happened to be, so "Minimal" would not be minimal for everyone.
    expect(MENS_TRACK_PRESETS.map((p) => p.key)).toEqual(['all', 'minimal', 'erection']);
    for (const preset of MENS_TRACK_PRESETS) {
      expect([preset.key, Object.keys(preset.settings).sort()]).toEqual([
        preset.key,
        [...MENS_TRACK_SECTIONS].sort(),
      ]);
      expect(preset.label).toBeTruthy();
    }
    // "Show everything" is exactly the defaults, and is a distinct OBJECT so a
    // caller mutating it cannot poison the defaults.
    const all = MENS_TRACK_PRESETS[0];
    expect(all.settings).toEqual(DEFAULT_MENS_TRACK_SETTINGS);
    expect(all.settings).not.toBe(DEFAULT_MENS_TRACK_SETTINGS);
    // No preset hides EVERY section — a blank tab is not a layout.
    for (const preset of MENS_TRACK_PRESETS) {
      expect([preset.key, Object.values(preset.settings).some(Boolean)]).toEqual([preset.key, true]);
    }
  });

  it('HEALTH-VITALITY-357: a failed read falls back to the cached preferences', async () => {
    // Offline, the tab must keep the layout the person chose. Falling back to
    // "everything on" would put the section they hid back on screen at exactly
    // the moment they cannot switch it off again.
    await storageHelpers.setObject(HEALTH_MENS_SETTINGS_KEY, { trackIssues: false });
    api.getMensHealthSettings.mockRejectedValue(NETWORK_ERROR);

    const loaded = await loadMensTrackSettings();
    expect(loaded.trackIssues).toBe(false);
    expect(loaded.trackLibido).toBe(true); // the rest default back on
    expect(healthSyncStateFor(HEALTH_MENS_SETTINGS_KEY)).toBe('offline');
  });

  it('HEALTH-VITALITY-358: a corrupt cached snapshot degrades to the defaults', async () => {
    // The merge reads `typeof stored[section] === 'boolean'` per key, so junk
    // values are skipped one at a time rather than taking the whole object down.
    await storageHelpers.setObject(HEALTH_MENS_SETTINGS_KEY, {
      trackIssues: 'nope',
      trackKegels: false,
      bogusSection: true,
    });
    __setHealthOfflineForTests(true);

    const loaded = await loadMensTrackSettings();
    expect(loaded).toEqual({ ...DEFAULT_MENS_TRACK_SETTINGS, trackKegels: false });
    expect(loaded).not.toHaveProperty('bogusSection');
  });
});

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function tap(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => node.props.onPress());
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthVitalityScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

/** The six cards a preference can hide, by testID. */
const GATED_CARDS = {
  drive: 'health-vitality-card-drive',
  activity: 'health-vitality-card-activity',
  erection: 'health-vitality-card-erection',
  issues: 'health-vitality-card-issues',
  energy: 'health-vitality-card-energy',
  kegels: 'health-vitality-card-kegels',
} as const;

function visibleCards(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return Object.entries(GATED_CARDS)
    .filter(([, id]) => byTestId(tree, id).length > 0)
    .map(([name]) => name);
}

describe('HealthVitalityScreen — section preferences', () => {
  it('HEALTH-VITALITY-360: everything on shows all six gated cards', async () => {
    const tree = await render();

    expect(visibleCards(tree)).toEqual([
      'drive',
      'activity',
      'erection',
      'issues',
      'energy',
      'kegels',
    ]);
    expect(allText(byTestId(tree, 'health-vitality-tracking-count')[0])).toBe('8 of 8');
  });

  it('HEALTH-VITALITY-361: the score, week and disclaimer cards can NEVER be hidden', async () => {
    // The ring is the tab's headline, the week card carries the "averaged over N
    // days you logged" basis line, and the disclaimer is a product requirement
    // (wellness, not diagnosis). None of the three is behind a preference, and a
    // future section must not put them there.
    const everythingOff = Object.fromEntries(
      MENS_TRACK_SECTIONS.map((s) => [MENS_TRACK_COLUMN[s], false])
    );
    installSettingsDefaults(settingsRow(everythingOff));
    const tree = await render();

    expect(visibleCards(tree)).toEqual([]);
    expect(byTestId(tree, 'health-vitality-score').length).toBe(1);
    expect(byTestId(tree, 'health-vitality-sub-sexual').length).toBe(1);
    expect(byTestId(tree, 'health-vitality-week-days').length).toBe(1);
    expect(byTestId(tree, 'health-vitality-week-basis').length).toBe(1);
    expect(byTestId(tree, 'health-vitality-disclaimer').length).toBe(1);
    // …and the way back is always reachable.
    expect(byTestId(tree, 'health-vitality-tracking-toggle').length).toBe(1);
    expect(allText(byTestId(tree, 'health-vitality-tracking-count')[0])).toBe('0 of 8');
  });

  it('HEALTH-VITALITY-362: the two-row cards need only ONE of their rows enabled', async () => {
    // DRIVE is `(trackLibido || trackSexualDesire)` and ERECTION HEALTH is
    // `(trackMorningErection || trackEroticDreams)`. A card gated on the wrong
    // operand would vanish while one of its rows was still switched on.
    installSettingsDefaults(
      settingsRow({ track_sexual_desire: false, track_erotic_dreams: false })
    );
    const withFirst = await render();
    expect(byTestId(withFirst, GATED_CARDS.drive).length).toBe(1);
    expect(byTestId(withFirst, 'health-vitality-libido').length).toBe(1);
    expect(byTestId(withFirst, 'health-vitality-desire').length).toBe(0);
    expect(byTestId(withFirst, GATED_CARDS.erection).length).toBe(1);
    expect(byTestId(withFirst, 'health-vitality-morning').length).toBe(1);
    expect(byTestId(withFirst, 'health-vitality-erotic-dream').length).toBe(0);

    installSettingsDefaults(
      settingsRow({ track_libido: false, track_morning_erection: false })
    );
    const withSecond = await render();
    expect(byTestId(withSecond, GATED_CARDS.drive).length).toBe(1);
    expect(byTestId(withSecond, 'health-vitality-libido').length).toBe(0);
    expect(byTestId(withSecond, 'health-vitality-desire').length).toBe(1);
    expect(byTestId(withSecond, GATED_CARDS.erection).length).toBe(1);
    expect(byTestId(withSecond, 'health-vitality-erotic-dream').length).toBe(1);
    // `trackMorningErection` gates the quality row BELOW the toggle too — the
    // whole fragment goes, not just the checkbox.
    expect(byTestId(withSecond, 'health-vitality-quality').length).toBe(0);
  });

  it('HEALTH-VITALITY-363: hiding a section takes its CONTROLS, never its data', async () => {
    // The card says "Anything you already logged stays exactly as it was". The
    // proof is the sub-score tile: energy 9 was logged, the ENERGY & MIND card is
    // switched off, and `Energy` still reads 90.
    api.listMensHealth.mockResolvedValue(
      ok({
        entries: [
          mensRow({
            date: TODAY,
            energy_level: 9,
            mental_clarity: 8,
            mood: 8,
            stress_level: 5,
            kegel_sets: 4,
            updated_at: '2026-07-13T10:00:00.000Z',
          }),
        ],
      })
    );
    installSettingsDefaults(settingsRow({ track_energy: false, track_kegels: false }));
    const tree = await render();

    expect(byTestId(tree, GATED_CARDS.energy).length).toBe(0);
    expect(byTestId(tree, 'health-vitality-energy').length).toBe(0);
    expect(byTestId(tree, GATED_CARDS.kegels).length).toBe(0);

    // …but the score is computed from the entry, not from what is on screen.
    expect(allText(byTestId(tree, 'health-vitality-sub-energy')[0])).toContain('90');
    expect(allText(byTestId(tree, 'health-vitality-sub-mental')[0])).toContain('80');
    // …and the week card still counts the kegel sets whose card is hidden.
    expect(allText(byTestId(tree, 'health-vitality-week-kegels')[0])).toContain('4');
  });

  it('HEALTH-VITALITY-364: the switches are behind a disclosure that starts CLOSED', async () => {
    // Eight more toggles permanently on screen would bury the disclaimer. The
    // count is visible while collapsed, so the state is legible without opening.
    const tree = await render();

    for (const section of MENS_TRACK_SECTIONS) {
      expect([section, byTestId(tree, `health-vitality-track-${section}`).length]).toEqual([
        section,
        0,
      ]);
    }
    expect(byTestId(tree, 'health-vitality-preset-minimal').length).toBe(0);

    tap(tree, 'health-vitality-tracking-toggle');

    for (const section of MENS_TRACK_SECTIONS) {
      expect([section, byTestId(tree, `health-vitality-track-${section}`).length]).toEqual([
        section,
        1,
      ]);
    }
    expect(byTestId(tree, 'health-vitality-preset-all').length).toBe(1);
    expect(allText(tree.toJSON())).toContain('Anything you already logged stays exactly as it was');

    tap(tree, 'health-vitality-tracking-toggle');
    expect(byTestId(tree, 'health-vitality-track-trackIssues').length).toBe(0);
  });

  it('HEALTH-VITALITY-365: flipping a switch hides its card and writes the whole column set', async () => {
    // The round trip this whole surface exists for, driven end to end.
    const tree = await render();
    tap(tree, 'health-vitality-tracking-toggle');
    expect(byTestId(tree, GATED_CARDS.issues).length).toBe(1);

    api.saveMensHealthSettings.mockResolvedValue(
      ok({ settings: settingsRow({ track_issues: false }) })
    );
    await act(async () => tap(tree, 'health-vitality-track-trackIssues'));

    expect(byTestId(tree, GATED_CARDS.issues).length).toBe(0);
    expect(allText(byTestId(tree, 'health-vitality-tracking-count')[0])).toBe('7 of 8');

    const [body] = api.saveMensHealthSettings.mock.calls[0];
    expect(body.track_issues).toBe(false);
    expect(Object.keys(body)).toHaveLength(8);

    // …and back on again, from the same tree.
    api.saveMensHealthSettings.mockResolvedValue(ok({ settings: settingsRow() }));
    await act(async () => tap(tree, 'health-vitality-track-trackIssues'));
    expect(byTestId(tree, GATED_CARDS.issues).length).toBe(1);
    expect(allText(byTestId(tree, 'health-vitality-tracking-count')[0])).toBe('8 of 8');
  });

  it('HEALTH-VITALITY-366: a preset re-lays out the whole tab in one tap', async () => {
    // "Minimal" keeps libido, morning erection and energy; it drops desire,
    // activity, erotic dreams, issues and kegels. Asserted as the resulting set
    // of CARDS, because that is what the person actually chose.
    const tree = await render();
    tap(tree, 'health-vitality-tracking-toggle');

    api.saveMensHealthSettings.mockResolvedValue(
      ok({
        settings: settingsRow({
          track_sexual_desire: false,
          track_sexual_activity: false,
          track_erotic_dreams: false,
          track_issues: false,
          track_kegels: false,
        }),
      })
    );
    await act(async () => tap(tree, 'health-vitality-preset-minimal'));

    expect(visibleCards(tree)).toEqual(['drive', 'erection', 'energy']);
    expect(allText(byTestId(tree, 'health-vitality-tracking-count')[0])).toBe('3 of 8');

    // Every one of the eight columns is stated, so the preset is a layout and
    // not a patch of the three it happens to change.
    const [body] = api.saveMensHealthSettings.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual([...OWNED_COLUMNS].sort());
    expect(body).toMatchObject({
      track_libido: true,
      track_sexual_desire: false,
      track_sexual_activity: false,
      track_morning_erection: true,
      track_erotic_dreams: false,
      track_issues: false,
      track_energy: true,
      track_kegels: false,
    });
  });

  it('HEALTH-VITALITY-367: "Show everything" restores the full tab from any state', async () => {
    installSettingsDefaults(
      settingsRow(Object.fromEntries(MENS_TRACK_SECTIONS.map((s) => [MENS_TRACK_COLUMN[s], false])))
    );
    const tree = await render();
    tap(tree, 'health-vitality-tracking-toggle');
    expect(visibleCards(tree)).toEqual([]);

    api.saveMensHealthSettings.mockResolvedValue(ok({ settings: settingsRow() }));
    await act(async () => tap(tree, 'health-vitality-preset-all'));

    expect(visibleCards(tree)).toEqual([
      'drive',
      'activity',
      'erection',
      'issues',
      'energy',
      'kegels',
    ]);
    expect(allText(byTestId(tree, 'health-vitality-tracking-count')[0])).toBe('8 of 8');
  });

  it('HEALTH-VITALITY-368: the week card states the BASIS of its averages', async () => {
    // "Absent is not zero" — the tile shows `—` and this line says why. The
    // singular/plural split is the kind of thing that reads as a bug on the one
    // day it matters most (the first day someone logs).
    const empty = await render();
    expect(allText(byTestId(empty, 'health-vitality-week-basis')[0])).toBe(
      'Nothing logged in the last 7 days — the figures above are blank rather than zero.'
    );

    api.listMensHealth.mockResolvedValue(
      ok({ entries: [mensRow({ date: TODAY, updated_at: '2026-07-13T10:00:00.000Z' })] })
    );
    const oneDay = await render();
    expect(allText(byTestId(oneDay, 'health-vitality-week-basis')[0])).toBe(
      'Averaged over the 1 day you logged, not all 7.'
    );

    api.listMensHealth.mockResolvedValue(
      ok({
        entries: [
          mensRow({ date: TODAY, updated_at: '2026-07-13T10:00:00.000Z' }),
          mensRow({ date: '2026-07-12', updated_at: '2026-07-12T10:00:00.000Z' }),
        ],
      })
    );
    const twoDays = await render();
    expect(allText(byTestId(twoDays, 'health-vitality-week-basis')[0])).toBe(
      'Averaged over the 2 days you logged, not all 7.'
    );
  });
});

/* ------------------------------------------------------------------ */
/* The guided session, wired to the day                                */
/* ------------------------------------------------------------------ */

describe('HealthVitalityScreen — a finished session reaches the day', () => {
  it('HEALTH-VITALITY-370: completed sets are ADDED to the day, not substituted for it', async () => {
    // A second session at night is a second session, not a correction of the
    // morning's. The manual field and the timer write the same column, so
    // replacing would silently delete hand-entered sets.
    api.listMensHealth.mockResolvedValue(
      ok({
        entries: [
          mensRow({ date: TODAY, kegel_sets: 4, updated_at: '2026-07-13T10:00:00.000Z' }),
        ],
      })
    );
    const tree = await render();
    expect(allText(byTestId(tree, 'health-vitality-kegel-today')[0])).toBe('4 today');

    // Run a full 3-set session through the real timer.
    tap(tree, 'health-kegel-timer-start');
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    const sent = api.saveMensHealth.mock.calls.at(-1)?.[0] as unknown as { kegel_sets: number };
    expect(sent.kegel_sets).toBe(7); // 4 already logged + 3 held
    expect(
      (tree.root.find(
        (n) =>
          (n.type as unknown as string) === 'TextInput' &&
          n.props?.testID === 'health-vitality-kegel-input'
      ).props as { value: string }).value
    ).toBe('7');
  });

  it('HEALTH-VITALITY-371: the added total is clamped to the 50-set ceiling', async () => {
    // 48 logged plus a 10-set session is 58. The column's bound is 50 on both
    // ends of the wire, so an unclamped sum would be a 400 from the route — the
    // one path where the timer could lose a whole session.
    api.listMensHealth.mockResolvedValue(
      ok({
        entries: [
          mensRow({ date: TODAY, kegel_sets: 48, updated_at: '2026-07-13T10:00:00.000Z' }),
        ],
      })
    );
    const tree = await render();

    tap(tree, 'health-kegel-timer-sets-10');
    tap(tree, 'health-kegel-timer-start');
    await act(async () => {
      jest.advanceTimersByTime(100_000);
    });

    const sent = api.saveMensHealth.mock.calls.at(-1)?.[0] as unknown as { kegel_sets: number };
    expect(sent.kegel_sets).toBe(50);
  });
});
