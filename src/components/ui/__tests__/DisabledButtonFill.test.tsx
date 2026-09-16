/**
 * Regression guard: a disabled button must still paint a visible surface.
 *
 * `getButtonGradientColors({ disabled: true })` returns two IDENTICAL stops,
 * and a LinearGradient built from those renders nothing at all — so the three
 * gradient-backed buttons used to show a bare label floating on the page
 * background with no button shape behind it (e.g. "Save new key" on the BYOK
 * change-key screen, and the disabled Sign in CTA on Login/Register).
 * Each now drops the gradient for a solid `actionDisabled` fill when disabled.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { StyleSheet } from 'react-native';

import { Button } from '@components/ui/Button';
import { FloatingActionButton } from '@components/ui/FloatingActionButton';
import { GradientButton } from '@components/ui/GradientButton';

import { renderOnDevice, type DeviceName } from '../../../test-utils/deviceRender';

const DEVICE: DeviceName = 'iPhone 14 Pro';

function collectFills(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const el = node as { props?: { style?: unknown }; children?: unknown[] };
  const flat = StyleSheet.flatten(el.props?.style as never) as { backgroundColor?: string } | undefined;
  if (flat?.backgroundColor) out.push(String(flat.backgroundColor));
  (el.children ?? []).forEach((child) => collectFills(child, out));
  return out;
}

const paintsAFill = (rendered: { toJSON: () => unknown }) =>
  collectFills(rendered.toJSON()).some((c) => c !== 'transparent' && c !== 'rgba(0,0,0,0)');

describe('disabled buttons paint a visible fill', () => {
  it('Button (primary) falls back to a solid fill', () => {
    const r = renderOnDevice(DEVICE, <Button title="Save" variant="primary" disabled onPress={() => {}} />);
    expect(paintsAFill(r)).toBe(true);
  });

  it('GradientButton falls back to a solid fill', () => {
    const r = renderOnDevice(DEVICE, <GradientButton title="Save" variant="teal" disabled onPress={() => {}} />);
    expect(paintsAFill(r)).toBe(true);
  });

  it('FloatingActionButton falls back to a solid fill', () => {
    const r = renderOnDevice(DEVICE, <FloatingActionButton title="Save" disabled onPress={() => {}} />);
    expect(paintsAFill(r)).toBe(true);
  });
});
