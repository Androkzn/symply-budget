/**
 * Sheet-ness of a screen — the input `ScreenHeader`'s `insideSheet` takes.
 *
 * A screen registered with `useScrollableFormPresentation` is a page sheet on
 * iPhone (`modal`: a card that starts BELOW the status bar) and a full-screen
 * modal on iPad (which owns the status bar). Hand-setting that answer has been
 * wrong in both directions — a blank status-bar-sized band inside the card when
 * it said "not a sheet", header controls under the clock when it said "sheet"
 * about a full-screen presentation — so screens derive it from the same helper
 * the navigator registered them with, and these tests pin the two ends together.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockDevice = { isIPad: false, width: 393 };

jest.mock('@hooks/useDeviceType', () => ({
  __esModule: true,
  useDeviceType: () => mockDevice,
}));

import {
  isSheetPresentation,
  useIsModalSheet,
  useIsScrollableFormSheet,
  useModalPresentation,
  useNativeModalPresentation,
  useScrollableFormPresentation,
} from '../presentation';

/** Runs a hook once in a throwaway component and hands back what it returned. */
function readHook<T>(hook: () => T): T {
  const captured = { current: undefined as T | undefined };
  function Probe() {
    captured.current = hook();
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return captured.current as T;
}

const asIPhone = () => Object.assign(mockDevice, { isIPad: false, width: 393 });
const asIPad = () => Object.assign(mockDevice, { isIPad: true, width: 1024 });

describe('isSheetPresentation', () => {
  it('counts the card presentations and nothing else', () => {
    // `modal` is UIModalPresentationPageSheet on iOS; `formSheet` is the iPad
    // panel. Both are cards inset from the window.
    expect(isSheetPresentation('modal')).toBe(true);
    expect(isSheetPresentation('formSheet')).toBe(true);
    // These fill the window from y=0, status bar included.
    expect(isSheetPresentation('fullScreenModal')).toBe(false);
    expect(isSheetPresentation('card')).toBe(false);
  });
});

describe('useIsScrollableFormSheet', () => {
  it('is a sheet on iPhone, where the form is presented as a page sheet', () => {
    asIPhone();
    expect(readHook(() => useScrollableFormPresentation('modal'))).toBe('modal');
    expect(readHook(() => useIsScrollableFormSheet())).toBe(true);
  });

  it('is not a sheet on iPad, where the same screen is a full-screen modal', () => {
    asIPad();
    expect(readHook(() => useScrollableFormPresentation('modal'))).toBe(
      'fullScreenModal'
    );
    // The header must keep the real safe-area inset here — this is the case a
    // hardcoded `insideSheet` drew the back button under the status bar clock.
    expect(readHook(() => useIsScrollableFormSheet())).toBe(false);
  });

  it('tracks the presentation the navigator would register, not the device alone', () => {
    // Same iPad, different helper: `useModalPresentation` resolves to a form
    // sheet there, which IS a card — so the two helpers must not share an answer.
    asIPad();
    expect(readHook(() => useModalPresentation('modal'))).toBe('formSheet');
    expect(readHook(() => useIsScrollableFormSheet())).toBe(false);
  });
});

describe('useIsModalSheet', () => {
  it('follows its own helper: a card on iPhone, a form sheet on iPad', () => {
    // The shape `ReportDetail` is registered with — `useModalPresentation('card')`,
    // which is a full-screen push on the phone and a panel on the tablet.
    asIPhone();
    expect(readHook(() => useIsModalSheet('card'))).toBe(false);

    asIPad();
    expect(readHook(() => useIsModalSheet('card'))).toBe(true);
  });
});


describe('React Native Modal presentation', () => {
  it('uses pageSheet on iPhone and formSheet on regular iPad', () => {
    asIPhone();
    expect(readHook(() => useNativeModalPresentation())).toBe('pageSheet');
    asIPad();
    expect(readHook(() => useNativeModalPresentation())).toBe('formSheet');
  });
  it('preserves the caller fallback in compact iPad windows', () => {
    Object.assign(mockDevice, { isIPad: true, width: 600 });
    expect(readHook(() => useNativeModalPresentation('fullScreen'))).toBe('fullScreen');
  });
});
