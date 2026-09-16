/**
 * AIFlowScaffold — the shared branded chrome for the BYOK flow.
 *
 * Locks the floating-CTA contract added so the primary action reads as a
 * blurred gradient hovering over the content instead of a solid bar clipping
 * it: the footer is an absolutely-positioned overlay whose empty (transparent)
 * region lets touches fall through to the scroll body (`pointerEvents="box-none"`),
 * layered with a BlurView + a top→bottom LinearGradient scrim, and the scroll
 * body reserves room for it so nothing is permanently hidden behind the CTA.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { Typography } from '@components/ui';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';
import { AIFlowScaffold } from '../AIFlowScaffold';

const findByTestID = (renderer: ReactTestRenderer, id: string): ReactTestInstance =>
  renderer.root.findByProps({ testID: id });

describe('AIFlowScaffold floating footer', () => {
  it('renders the footer as a box-none overlay so it never blocks the scroll body', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <AIFlowScaffold title="Connect Anthropic Claude" footer={<Typography>Connect & validate</Typography>}>
        <Typography>How to get your key</Typography>
      </AIFlowScaffold>
    );

    const overlay = findByTestID(renderer, 'ai-flow-footer');
    expect(overlay.props.pointerEvents).toBe('box-none');

    // Both the body content and the footer CTA are present in the same tree —
    // the CTA floats above the content rather than replacing it.
    const text = treeText(renderer);
    expect(text).toContain('How to get your key');
    expect(text).toContain('Connect & validate');
  });

  it('layers the shared bottom-glass scrim (tab-bar recipe) behind the CTA', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <AIFlowScaffold footer={<Typography>Continue</Typography>}>
        <Typography>body</Typography>
      </AIFlowScaffold>
    );

    // Scope to the footer overlay so we don't pick up the AppBackground gradient.
    const overlay = findByTestID(renderer, 'ai-flow-footer');

    // A BlurView provides the frosted glass.
    expect(overlay.findAllByType(BlurView).length).toBeGreaterThan(0);

    // The scrim now uses the SAME recipe as the floating tab bar: a gradient on
    // the `surface` token that fades from fully transparent at the top to fully
    // opaque at the bottom, expressed as rgba() strings (via `hexToRgba`) rather
    // than the old 8-digit-hex `backgroundMain` scrim. This keeps every footer
    // visually identical to the bottom nav.
    const gradient = overlay.findAllByType(LinearGradient)[0];
    const colors: string[] = gradient.props.colors;
    const alphaOf = (rgba: string): number =>
      Number(rgba.replace(/\s/g, '').replace(/^rgba?\(.*,(.*)\)$/, '$1'));
    expect(colors.every((c) => c.startsWith('rgba('))).toBe(true);
    expect(alphaOf(colors[0])).toBe(0);
    expect(alphaOf(colors[colors.length - 1])).toBe(1);
  });

  it('bounds the scroll body height so the content actually scrolls', () => {
    // Regression: AdaptiveContainer defaults to `flexBasis: 'auto'` (content-
    // sizing, for when it sits INSIDE a ScrollView). As the PARENT of the
    // ScrollView it must instead be a bounded flex column (`flex: 1`), otherwise
    // it grows to the full content height and nothing scrolls. See the AI-access
    // "providers / nested screens not scrollable" bug.
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <AIFlowScaffold title="Choose a provider">
        <Typography>body</Typography>
      </AIFlowScaffold>
    );

    const scroll = renderer.root.findByType(ScrollView);
    const parentStyle = StyleSheet.flatten(scroll.parent?.props.style);
    expect(parentStyle.flex).toBe(1);
  });

  it('renders the screen title as a centered header title (not a left-aligned hero)', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <AIFlowScaffold title="Connect Google Gemini">
        <Typography>body</Typography>
      </AIFlowScaffold>
    );

    // The title is present exactly once and rendered with center alignment so it
    // matches the app's standard centered header (was a big left-aligned title1).
    const titleNodes = renderer.root
      .findAllByType(Typography)
      .filter((n) => n.props.children === 'Connect Google Gemini');
    expect(titleNodes).toHaveLength(1);
    expect(titleNodes[0].props.align).toBe('center');
  });

  it('omits the footer overlay entirely when no footer is provided', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <AIFlowScaffold>
        <Typography>body only</Typography>
      </AIFlowScaffold>
    );

    expect(renderer.root.findAllByProps({ testID: 'ai-flow-footer' })).toHaveLength(0);
    expect(treeText(renderer)).toContain('body only');
  });

  it('grows the scroll bottom padding to the measured footer height so content clears the CTA', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <AIFlowScaffold footer={<Typography>CTA</Typography>}>
        <Typography>body</Typography>
      </AIFlowScaffold>
    );

    const paddingBottom = () => {
      const scroll = renderer.root.findByType(ScrollView);
      return StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom;
    };

    // Before the overlay has measured itself, only the 16pt gap is reserved.
    expect(paddingBottom()).toBe(16);

    // The overlay reports a 120pt height → padding grows to keep content clear.
    act(() => {
      findByTestID(renderer, 'ai-flow-footer').props.onLayout({
        nativeEvent: { layout: { height: 120, width: 300, x: 0, y: 0 } },
      });
    });

    expect(paddingBottom()).toBe(136);
  });
});
