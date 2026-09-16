/**
 * Symply Health — Apple Health connect card suite (parity phase P3).
 *
 * The card is the ONLY place a user meets the HealthKit integration, so what it
 * says is the product promise. Three things are pinned here:
 *
 * 1. **All four states are equals.** `unavailable`, `not-requested`, `denied`
 *    and `connected` each render honest copy. Three of the four restate that
 *    manual entry is unaffected; `not-requested` has no consent decision yet
 *    to reassure, so it carries the pitch through its title, action and scope
 *    list alone. A denial in particular must never read as a failure, never
 *    nag, and never leak a system string.
 * 2. **The scope is disclosed BEFORE the tap.** Every state — including the one
 *    shown before the OS sheet appears — lists all five data types. The list is
 *    asserted against `HEALTHKIT_DESCRIPTORS`, the same table the service hands
 *    to iOS, so screen and wire cannot drift.
 * 3. **Read-only is stated out loud**, because "we never write back" is exactly
 *    the sort of promise users are entitled to see rather than infer.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import type { HealthKitConnectionState } from '../../healthKit';
import { HEALTHKIT_DESCRIPTORS, HEALTHKIT_TYPES } from '../../healthKitTypes';
import { HealthKitConnectCard, formatLastSynced } from '../HealthKitConnectCard';

type Rendered = ReactTestRenderer.ReactTestRenderer;

const CARD = 'healthkit-connect-card';
const ALL_STATES: HealthKitConnectionState[] = [
  'unavailable',
  'not-requested',
  'denied',
  'connected',
];
/** States with something to reassure — `not-requested` has no consent decision yet to restate. */
const STATES_WITH_MANUAL_NOTE = ALL_STATES.filter((state) => state !== 'not-requested');

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function renderCard(
  props: Partial<React.ComponentProps<typeof HealthKitConnectCard>> = {},
): Rendered {
  return render(<HealthKitConnectCard state="not-requested" {...props} />);
}

/** Every node carrying the id — composite wrappers included. */
function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => n.props?.testID === id);
}

/** The rendered HOST node for an id, which is where a11y props actually land. */
function hostByTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** Concatenated text of a host subtree. */
function textOf(inst: ReactTestRenderer.ReactTestInstance): string {
  return inst
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String)
    .join(' ');
}

function cardText(tree: Rendered): string {
  return textOf(tree.root);
}

function press(tree: Rendered, id: string) {
  const target = byTestId(tree, id).find((n) => typeof n.props?.onPress === 'function');
  act(() => {
    target?.props.onPress();
  });
}

/* ============================ Every state ============================== */

describe('HealthKitConnectCard — invariants across all four states', () => {
  it.each(ALL_STATES)('HEALTH-HK-200: renders the %s state without throwing', (state) => {
    const tree = renderCard({ state });
    expect(byTestId(tree, CARD)).not.toHaveLength(0);
    expect(textOf(byTestId(tree, `${CARD}-title`)[0]).length).toBeGreaterThan(0);
  });

  it.each(ALL_STATES)('HEALTH-HK-201: %s discloses all five data types', (state) => {
    const tree = renderCard({ state });
    for (const descriptor of HEALTHKIT_DESCRIPTORS) {
      expect(byTestId(tree, `${CARD}-scope-${descriptor.type}`)).not.toHaveLength(0);
    }
    expect(byTestId(tree, `${CARD}-scope`)).not.toHaveLength(0);
  });

  it.each(ALL_STATES)('HEALTH-HK-202: %s names every type in words the user can read', (state) => {
    const text = cardText(renderCard({ state }));
    for (const descriptor of HEALTHKIT_DESCRIPTORS) {
      expect(text).toContain(descriptor.label);
    }
  });

  it.each(ALL_STATES)('HEALTH-HK-203: %s promises we never write back to Apple Health', (state) => {
    const note = textOf(byTestId(renderCard({ state }), `${CARD}-read-only-note`)[0]);
    expect(note).toContain('Read-only');
    expect(note).toContain('never writes');
  });

  it.each(STATES_WITH_MANUAL_NOTE)('HEALTH-HK-204: %s restates that manual entry is unaffected', (state) => {
    const note = textOf(byTestId(renderCard({ state }), `${CARD}-manual-note`)[0]);
    expect(note.length).toBeGreaterThan(0);
    expect(note).toMatch(/works|nothing is missing|optional|never replaced/i);
  });

  it.each(ALL_STATES)('HEALTH-HK-205: %s never renders a raw system or error string', (state) => {
    const text = cardText(renderCard({ state }));
    // The no-raw-error-leaks rule, applied to the states most likely to tempt it.
    expect(text).not.toMatch(/HKError|NSError|errSec|undefined|null|Error:|\bexception\b/i);
  });

  it.each(ALL_STATES)('HEALTH-HK-206: %s honours a custom testID prefix', (state) => {
    const tree = renderCard({ state, testID: 'hk-card' });
    expect(byTestId(tree, 'hk-card')).not.toHaveLength(0);
    expect(byTestId(tree, 'hk-card-scope-steps')).not.toHaveLength(0);
  });

  it.each(ALL_STATES)('HEALTH-HK-207: %s labels each scope row for assistive tech', (state) => {
    const tree = renderCard({ state });
    const row = hostByTestId(tree, `${CARD}-scope-steps`)[0];
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toContain('Steps');
    expect(row.props.accessibilityLabel).toContain(HEALTHKIT_TYPES.steps.purpose);
  });
});

/* ============================ not-available ============================ */

describe('HealthKitConnectCard — not available', () => {
  it('HEALTH-HK-210: says the device cannot provide Apple Health, plainly', () => {
    const text = cardText(renderCard({ state: 'unavailable' }));
    expect(text).toContain('Apple Health isn’t available here');
    expect(text).toContain('doesn’t provide Apple Health data');
  });

  it('HEALTH-HK-211: reassures that nothing is missing', () => {
    const note = textOf(byTestId(renderCard({ state: 'unavailable' }), `${CARD}-manual-note`)[0]);
    expect(note).toContain('Nothing is missing');
  });

  it('HEALTH-HK-212: offers no connect action — there is nothing to connect to', () => {
    const tree = renderCard({ state: 'unavailable', onConnect: jest.fn() });
    expect(byTestId(tree, `${CARD}-action`)).toHaveLength(0);
    expect(byTestId(tree, `${CARD}-settings`)).toHaveLength(0);
  });

  it('HEALTH-HK-213: shows no last-sync line', () => {
    const tree = renderCard({ state: 'unavailable', lastSyncedAt: '2026-07-25T09:00:00.000Z' });
    expect(byTestId(tree, `${CARD}-last-synced`)).toHaveLength(0);
  });
});

/* ============================ not-requested ============================ */

describe('HealthKitConnectCard — not requested', () => {
  it('HEALTH-HK-220: keeps the P1 wording the app has always shown', () => {
    expect(cardText(renderCard({ state: 'not-requested' }))).toContain(
      'Apple Health — not connected',
    );
  });

  it('HEALTH-HK-221: carries the pitch through the title, action and scope list alone — no body or manual-note copy', () => {
    const tree = renderCard({ state: 'not-requested' });
    expect(byTestId(tree, `${CARD}-body`)).toHaveLength(0);
    expect(byTestId(tree, `${CARD}-manual-note`)).toHaveLength(0);
  });

  it('HEALTH-HK-222: offers a connect action that fires once', () => {
    const onConnect = jest.fn();
    const tree = renderCard({ state: 'not-requested', onConnect });

    expect(textOf(byTestId(tree, `${CARD}-action`)[0])).toContain('Connect Apple Health');
    press(tree, `${CARD}-action`);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-223: hides the action when the screen supplies no handler', () => {
    expect(byTestId(renderCard({ state: 'not-requested' }), `${CARD}-action`)).toHaveLength(0);
  });

  it('HEALTH-HK-224: says "what we WOULD read" before consent is given', () => {
    const label = textOf(byTestId(renderCard({ state: 'not-requested' }), `${CARD}-scope-label`)[0]);
    expect(label).toBe('WHAT WE WOULD READ');
  });

  it('HEALTH-HK-225: shows no last-sync line before anything has synced', () => {
    expect(byTestId(renderCard({ state: 'not-requested' }), `${CARD}-last-synced`)).toHaveLength(0);
  });
});

/* ================================ denied =============================== */

describe('HealthKitConnectCard — denied', () => {
  it('HEALTH-HK-230: states the denial calmly and accepts it', () => {
    const text = cardText(renderCard({ state: 'denied' }));
    expect(text).toContain('Apple Health access is off');
    expect(text).toContain('That’s a fine choice');
  });

  it('HEALTH-HK-231: confirms we read nothing', () => {
    expect(cardText(renderCard({ state: 'denied' }))).toContain('reads nothing from Apple Health');
  });

  it('HEALTH-HK-232: does NOT re-offer the connect prompt — a denial is not a retry loop', () => {
    const tree = renderCard({ state: 'denied', onConnect: jest.fn() });
    expect(byTestId(tree, `${CARD}-action`)).toHaveLength(0);
  });

  it('HEALTH-HK-233: points at iOS Settings instead, where the choice actually lives', () => {
    const text = cardText(renderCard({ state: 'denied' }));
    expect(text).toContain('Settings › Health › Data Access & Devices');
  });

  it('HEALTH-HK-234: offers an Open Settings action when the screen can handle it', () => {
    const onOpenSettings = jest.fn();
    const tree = renderCard({ state: 'denied', onOpenSettings });

    expect(textOf(byTestId(tree, `${CARD}-settings`)[0])).toContain('Open Settings');
    press(tree, `${CARD}-settings`);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-235: omits the Settings action when no handler is supplied', () => {
    expect(byTestId(renderCard({ state: 'denied' }), `${CARD}-settings`)).toHaveLength(0);
  });

  it('HEALTH-HK-236: still promises everything works', () => {
    expect(textOf(byTestId(renderCard({ state: 'denied' }), `${CARD}-manual-note`)[0])).toContain(
      'Everything still works',
    );
  });

  it('HEALTH-HK-237: still shows the full scope, so the choice can be reconsidered informed', () => {
    const tree = renderCard({ state: 'denied' });
    expect(byTestId(tree, `${CARD}-scope-bodyMass`)).not.toHaveLength(0);
  });
});

/* =============================== connected ============================= */

describe('HealthKitConnectCard — connected', () => {
  it('HEALTH-HK-240: confirms the connection and the scope', () => {
    const text = cardText(renderCard({ state: 'connected' }));
    expect(text).toContain('Apple Health connected');
    expect(text).toContain('five data types');
  });

  it('HEALTH-HK-241: switches the scope heading to the present tense', () => {
    expect(textOf(byTestId(renderCard({ state: 'connected' }), `${CARD}-scope-label`)[0])).toBe(
      'WHAT WE READ',
    );
  });

  it('HEALTH-HK-242: promises the user’s own entries always win', () => {
    expect(textOf(byTestId(renderCard({ state: 'connected' }), `${CARD}-manual-note`)[0])).toContain(
      'never replaced',
    );
  });

  it('HEALTH-HK-243: shows the last sync time', () => {
    const tree = renderCard({
      state: 'connected',
      lastSyncedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    });
    expect(textOf(byTestId(tree, `${CARD}-last-synced`)[0])).toBe('Synced 1 h ago');
  });

  it('HEALTH-HK-244: says so honestly when nothing has synced yet', () => {
    const tree = renderCard({ state: 'connected', lastSyncedAt: null });
    expect(textOf(byTestId(tree, `${CARD}-last-synced`)[0])).toBe('Not synced yet');
  });

  it('HEALTH-HK-245: offers Sync now', () => {
    const onConnect = jest.fn();
    const tree = renderCard({ state: 'connected', onConnect });

    expect(textOf(byTestId(tree, `${CARD}-action`)[0])).toContain('Sync now');
    press(tree, `${CARD}-action`);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-246: shows progress in the label and disables the control while syncing', () => {
    const tree = renderCard({ state: 'connected', onConnect: jest.fn(), busy: true });
    const action = byTestId(tree, `${CARD}-action`)[0];

    // The label carries the progress, so the user is never left guessing.
    expect(textOf(action)).toContain('Syncing');
    expect(action.props.disabled).toBe(true);
  });

  it('HEALTH-HK-247: says where a weight reading goes, and that typed days survive it', () => {
    // Weight is now imported (into the weight log, tagged `source: 'healthkit'`),
    // so the row no longer claims it is display-only. What it must still promise is
    // the thing the user actually cares about: a day they typed is left alone.
    const row = hostByTestId(renderCard({ state: 'connected' }), `${CARD}-scope-bodyMass`)[0];
    expect(row.props.accessibilityLabel).toContain(HEALTHKIT_TYPES.bodyMass.purpose);
    expect(textOf(row)).toContain('weight log');
    expect(textOf(row)).toContain('Days you typed yourself are left alone');
  });
});

/* ========================= compact (banner) layout ====================== */

describe('HealthKitConnectCard — compact layout', () => {
  it.each(ALL_STATES)(
    'HEALTH-HK-260: %s renders the title and action inline, but keeps the scope list out of the collapsed row',
    (state) => {
      const tree = renderCard({ state, layout: 'compact', onConnect: jest.fn(), onOpenSettings: jest.fn() });
      expect(byTestId(tree, `${CARD}-title`)).not.toHaveLength(0);
      expect(byTestId(tree, `${CARD}-scope`)).toHaveLength(0);
      expect(byTestId(tree, `${CARD}-body`)).toHaveLength(0);
    },
  );

  it('HEALTH-HK-261: the (i) button opens a sheet disclosing all five data types and the read-only promise', () => {
    const tree = renderCard({ state: 'not-requested', layout: 'compact' });
    expect(byTestId(tree, `${CARD}-scope`)).toHaveLength(0);

    press(tree, `${CARD}-info`);

    expect(byTestId(tree, `${CARD}-scope`)).not.toHaveLength(0);
    for (const descriptor of HEALTHKIT_DESCRIPTORS) {
      expect(byTestId(tree, `${CARD}-scope-${descriptor.type}`)).not.toHaveLength(0);
    }
    const note = textOf(byTestId(tree, `${CARD}-read-only-note`)[0]);
    expect(note).toContain('Read-only');
  });

  it('HEALTH-HK-262: denied\'s sheet still carries the body and manual-note copy the collapsed row omits', () => {
    const tree = renderCard({ state: 'denied', layout: 'compact' });
    press(tree, `${CARD}-info`);

    expect(textOf(byTestId(tree, `${CARD}-body`)[0])).toContain('That’s a fine choice');
    expect(textOf(byTestId(tree, `${CARD}-manual-note`)[0])).toContain('Everything still works');
  });

  it('HEALTH-HK-263: unavailable still discloses the scope in its sheet, matching the full layout\'s invariant', () => {
    const tree = renderCard({ state: 'unavailable', layout: 'compact' });
    press(tree, `${CARD}-info`);

    expect(byTestId(tree, `${CARD}-scope`)).not.toHaveLength(0);
    expect(textOf(byTestId(tree, `${CARD}-body`)[0])).toContain('doesn’t provide Apple Health data');
  });

  it('HEALTH-HK-264: hides the dismiss (×) unless the screen supplies onDismiss', () => {
    expect(byTestId(renderCard({ state: 'not-requested', layout: 'compact' }), `${CARD}-dismiss`)).toHaveLength(0);
  });

  it('HEALTH-HK-265: dismiss fires the handler exactly once', () => {
    const onDismiss = jest.fn();
    const tree = renderCard({ state: 'not-requested', layout: 'compact', onDismiss });

    press(tree, `${CARD}-dismiss`);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-266: still offers Connect Apple Health, inline, without opening the sheet', () => {
    const onConnect = jest.fn();
    const tree = renderCard({ state: 'not-requested', layout: 'compact', onConnect });

    expect(textOf(byTestId(tree, `${CARD}-action`)[0])).toContain('Connect Apple Health');
    press(tree, `${CARD}-action`);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-267: denied offers Open Settings inline instead of a connect retry', () => {
    const onOpenSettings = jest.fn();
    const tree = renderCard({ state: 'denied', layout: 'compact', onOpenSettings, onConnect: jest.fn() });

    expect(textOf(byTestId(tree, `${CARD}-action`)[0])).toContain('Open Settings');
    press(tree, `${CARD}-action`);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-268: connected keeps the last-synced line visible inline, not behind the sheet', () => {
    const tree = renderCard({
      state: 'connected',
      layout: 'compact',
      lastSyncedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    });
    expect(textOf(byTestId(tree, `${CARD}-last-synced`)[0])).toBe('Synced 1 h ago');
  });

  it('HEALTH-HK-269: connected still offers Sync now, and the sheet keeps saying WHAT WE READ', () => {
    const onConnect = jest.fn();
    const tree = renderCard({ state: 'connected', layout: 'compact', onConnect });

    expect(textOf(byTestId(tree, `${CARD}-action`)[0])).toContain('Sync now');
    press(tree, `${CARD}-info`);
    expect(textOf(byTestId(tree, `${CARD}-scope-label`)[0])).toBe('WHAT WE READ');
  });
});

/* ============================= formatLastSynced ======================== */

describe('formatLastSynced', () => {
  const now = new Date(2026, 6, 25, 12, 0, 0);
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();

  it('HEALTH-HK-250: reports never rather than an empty string', () => {
    expect(formatLastSynced(null, now)).toBe('Not synced yet');
    expect(formatLastSynced(undefined, now)).toBe('Not synced yet');
  });

  it('HEALTH-HK-251: a corrupt timestamp reads as never, not as "Invalid Date"', () => {
    expect(formatLastSynced('not-a-date', now)).toBe('Not synced yet');
  });

  it('HEALTH-HK-252: collapses the last minute to "just now"', () => {
    expect(formatLastSynced(ago(0), now)).toBe('Synced just now');
    expect(formatLastSynced(ago(0.5), now)).toBe('Synced just now');
  });

  it('HEALTH-HK-253: counts minutes, then hours, then days', () => {
    expect(formatLastSynced(ago(5), now)).toBe('Synced 5 min ago');
    expect(formatLastSynced(ago(59), now)).toBe('Synced 59 min ago');
    expect(formatLastSynced(ago(60), now)).toBe('Synced 1 h ago');
    expect(formatLastSynced(ago(60 * 23), now)).toBe('Synced 23 h ago');
    expect(formatLastSynced(ago(60 * 24), now)).toBe('Synced yesterday');
    expect(formatLastSynced(ago(60 * 24 * 3), now)).toBe('Synced 3 days ago');
  });

  it('HEALTH-HK-254: falls back to a date once "days ago" stops being useful', () => {
    expect(formatLastSynced(ago(60 * 24 * 30), now)).toMatch(/^Synced \d/);
  });
});
