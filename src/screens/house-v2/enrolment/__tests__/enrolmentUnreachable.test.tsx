/**
 * The gate must qualify a wait, not invent a state of its own.
 *
 * `awaitingEnrolment` alone cannot tell a member whether the home key is
 * seconds away or never coming — both render "Waiting for the home key"
 * indefinitely. `enrolmentUnreachable` is the qualifier, and the two rules that
 * keep it honest are asserted here:
 *
 *   1. it NEVER shows without an actual wait, and
 *   2. it never outlives one.
 *
 * The second is the subtle one. The status store is written per sync run and
 * only for the ACTIVE property, so a `true` left over from a home the member
 * has since switched away from would present the home in front of them as
 * beyond saving.
 */
jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: jest.fn() }),
}));

let mockLocalFirst = true;
jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockLocalFirst,
}));

let mockSessionOpen = true;
let mockAwaiting = false;
jest.mock('@features/house/local/engine', () => ({
  __esModule: true,
  isLocalHouseSessionOpen: () => mockSessionOpen,
  isAwaitingHouseEnrolment: () => mockAwaiting,
  getActiveHouseholdId: () => 'hh-1',
  getLocalHouseLedger: () => ({
    household: { id: 'hh-1', name: 'Maple Street House' },
    deviceId: 'dev-self',
  }),
  subscribeToHouseLedgerChanges: () => () => {},
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { useHouseSyncStatusStore } from '@features/house/local/sync/syncStatusStore';

import {
  enrolmentUnreachableNotice,
  useEnrolmentGate,
  type EnrolmentGate,
} from '../enrolmentShared';

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

/** Renders nothing — it exists to hand the hook's answer back to the test. */
function readGate(): EnrolmentGate {
  let seen: EnrolmentGate | null = null;
  function Probe() {
    seen = useEnrolmentGate();
    return null;
  }
  act(() => {
    mounted = ReactTestRenderer.create(<Probe />);
  });
  if (!seen) throw new Error('gate never rendered');
  return seen;
}

beforeEach(() => {
  mockLocalFirst = true;
  mockSessionOpen = true;
  mockAwaiting = false;
  useHouseSyncStatusStore.setState({ enrolmentUnreachable: false });
});

afterEach(() => {
  // The probe subscribes to the status store. Left mounted, the next test's
  // `setState` re-renders it outside `act` — a warning that teaches everyone
  // here to ignore act warnings.
  act(() => {
    mounted?.unmount();
  });
  mounted = null;
});

describe('useEnrolmentGate — enrolmentUnreachable', () => {
  it('is true only when a wait is BOTH open and hopeless', () => {
    mockAwaiting = true;
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: true });

    expect(readGate().enrolmentUnreachable).toBe(true);
  });

  it('stays false while the wait can still be answered', () => {
    mockAwaiting = true;
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: false });

    expect(readGate().enrolmentUnreachable).toBe(false);
  });

  it('never fires without a wait, even with a stale verdict in the store', () => {
    // The leftover case: the flag belongs to a property the member has since
    // switched away from. The home in front of them is fine.
    mockAwaiting = false;
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: true });

    const gate = readGate();
    expect(gate.awaitingEnrolment).toBe(false);
    expect(gate.enrolmentUnreachable).toBe(false);
  });

  it('is false when no session is open — nothing is known yet', () => {
    mockSessionOpen = false;
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: true });

    expect(readGate().enrolmentUnreachable).toBe(false);
  });

  it('is false with local-first off, where there are no devices to enrol', () => {
    mockLocalFirst = false;
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: true });

    expect(readGate().enrolmentUnreachable).toBe(false);
  });
});

describe('enrolmentUnreachableNotice', () => {
  it('names the home so the member knows which one is locked', () => {
    expect(enrolmentUnreachableNotice('Maple Street House').message).toContain(
      'Maple Street House',
    );
  });

  it('falls back to a neutral subject rather than an empty quote', () => {
    for (const nameless of [null, undefined, '', '   ']) {
      expect(enrolmentUnreachableNotice(nameless).message).toContain('This home');
    }
  });

  it('says outright that waiting will not resolve it', () => {
    // The member has already been told to wait for approval, by this app, on
    // this screen — that is how a device sat on the message for 194 polls. The
    // notice has to CONTRADICT that, not restate it.
    expect(enrolmentUnreachableNotice('Maple Street House').message).toContain(
      'Waiting longer will not change that',
    );
  });

  it('names the two roads that still work', () => {
    // The same pair HouseRecoverHomeScreen offers: another device approving this
    // one, or a restore from backup. A dead end with no exit is just bad news.
    const { message } = enrolmentUnreachableNotice('Maple Street House');
    expect(message).toContain('approve');
    expect(message.toLowerCase()).toContain('recovery phrase');
  });

  it('reads as a dead end to act on, not an expected quiet state', () => {
    // `expected: true` renders muted, which would bury the one message on the
    // screen that changes what the member should do next.
    expect(enrolmentUnreachableNotice('X').expected).toBe(false);
    // No AI key can conjure a household key held by hardware.
    expect(enrolmentUnreachableNotice('X').needsAiProvider).toBe(false);
  });

  it('does not offer to delete the home — the data is still restorable', () => {
    const { title, message } = enrolmentUnreachableNotice('Maple Street House');
    expect(`${title} ${message}`.toLowerCase()).not.toMatch(/delete|remove|erase/);
  });
});
