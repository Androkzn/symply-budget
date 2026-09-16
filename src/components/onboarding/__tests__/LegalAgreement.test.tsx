/**
 * LegalAgreement — the "I agree to the Terms of Service and Privacy Policy"
 * control shared by every brand's onboarding welcome screen.
 *
 * Regression: the checkbox toggle and the Terms/Privacy links used to share
 * ONE touchable spanning the whole (wrapping) row. Since the checkbox sits
 * fixed at the top-left while the row's bounding box grows with the wrapped
 * text, a tap at the row's center — which is what `tapOn: id:` (Maestro) and
 * a VoiceOver/Switch Control activation both use — landed on the wrapped
 * text near a link rather than on the checkbox, opening a legal sheet
 * instead of toggling agreement. Nesting touchables inside an accessible
 * element also hid the links from VoiceOver entirely. Fixed by giving the
 * checkbox its own touchable, sized to the glyph, separate from the text.
 */
import React from 'react';
import { TouchableOpacity } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { LegalAgreement } from '../LegalAgreement';

function render(agreed: boolean, onToggle: () => void) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LegalAgreement agreed={agreed} onToggle={onToggle} />
      </ThemeProvider>
    );
  });
  return tree;
}

describe('LegalAgreement', () => {
  it('the checkbox toggle is its own touchable, not wrapping the Terms/Privacy links', () => {
    const onToggle = jest.fn();
    const tree = render(false, onToggle);

    const checkbox = tree.root.findAllByProps({ testID: 'onboarding-agree-terms' })[0];
    expect(checkbox.type).toBe(TouchableOpacity);

    // The links must NOT be descendants of the checkbox's own touchable —
    // that nesting is exactly what misrouted taps to a legal sheet.
    const linksInsideCheckbox = checkbox.findAllByProps({ children: 'Terms of Service' });
    expect(linksInsideCheckbox).toHaveLength(0);

    act(() => checkbox.props.onPress());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('tapping "Terms of Service" opens the terms sheet, not the toggle', () => {
    const onToggle = jest.fn();
    const tree = render(false, onToggle);

    const termsLink = tree.root
      .findAllByProps({ children: 'Terms of Service' })
      .find((n) => typeof n.parent?.props.onPress === 'function');
    act(() => termsLink?.parent?.props.onPress());

    expect(onToggle).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ title: 'Terms of Service' }).length).toBeGreaterThan(0);
  });

  it('tapping "Privacy Policy" opens the privacy sheet, not the toggle', () => {
    const onToggle = jest.fn();
    const tree = render(false, onToggle);

    const privacyLink = tree.root
      .findAllByProps({ children: 'Privacy Policy' })
      .find((n) => typeof n.parent?.props.onPress === 'function');
    act(() => privacyLink?.parent?.props.onPress());

    expect(onToggle).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ title: 'Privacy Policy' }).length).toBeGreaterThan(0);
  });

  it('reflects the agreed state on the checkbox', () => {
    const tree = render(true, jest.fn());
    const checkbox = tree.root.findAllByProps({ testID: 'onboarding-agree-terms' })[0];
    expect(checkbox.props.accessibilityState).toEqual({ checked: true });
  });
});
