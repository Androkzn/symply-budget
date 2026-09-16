/**
 * OnboardingWelcome — shared welcome chrome for every brand (House's full
 * flow and each child brand's single-step flow alike). Covers the back
 * button added to let a member abandon this very first onboarding screen:
 * there is no earlier in-app screen to pop back to (they just signed in/up),
 * so "back" means signing out and landing back on Login, confirmed first
 * since it discards the just-completed sign-in.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { OnboardingWelcome, type OnboardingWelcomeContent } from '../OnboardingWelcome';

const mockLogout = jest.fn();
jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector: (s: { logout: () => void }) => unknown) =>
    selector({ logout: mockLogout }),
}));

jest.spyOn(Alert, 'alert');

const content: OnboardingWelcomeContent = {
  subtitle: 'Build healthy habits.',
  features: [],
};

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

async function renderWelcome() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <OnboardingWelcome
          content={content}
          totalSteps={1}
          submitting={false}
          onGetStarted={jest.fn()}
        />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('OnboardingWelcome back button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * It has to say where it goes, because it is the one back control in the
   * wizard that does not pop a step.
   *
   * Every later step draws a bare chevron that goes back one screen. An
   * identical bare chevron here would make the same promise and instead end
   * the session — so this one prints its destination and keeps the prompt
   * below as the second line of defence.
   */
  it('prints "Sign In" beside the chevron rather than being a bare arrow', async () => {
    const tree = await renderWelcome();

    const control = tree.root.findAllByProps({ testID: 'onboarding-welcome-back' })[0];
    expect(control.props.accessibilityLabel).toBe('Back to sign in');
    expect(
      control.findAll((node) => node.props?.children === 'Sign In').length,
    ).toBeGreaterThan(0);
  });

  it('asks for confirmation instead of signing out immediately', async () => {
    const tree = await renderWelcome();

    pressByTestId(tree, 'onboarding-welcome-back');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Sign out?',
      expect.stringContaining('sign-in screen'),
      expect.any(Array),
    );
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('signs out only once the member confirms', async () => {
    const tree = await renderWelcome();

    pressByTestId(tree, 'onboarding-welcome-back');

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const confirm = buttons.find((b) => b.text === 'Sign out');
    const cancel = buttons.find((b) => b.text === 'Cancel');

    expect(cancel?.onPress).toBeUndefined();

    confirm?.onPress?.();

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingWelcome — Get Started footer', () => {
  const welcome = (
    <OnboardingWelcome content={content} totalSteps={1} submitting={false} onGetStarted={jest.fn()} />
  );

  // Used to be a hardcoded 28pt regardless of device — now the same "main
  // padding horizontal" every other screen uses (`useLayoutPadding`), so
  // every floating CTA that mirrors this button's width lines up with it.
  it('sizes its horizontal margins from the shared layout-padding scale, not a hardcoded inset', () => {
    const phone = renderOnDevice('iPhone 14 Pro', welcome);
    const ipad = renderOnDevice('iPad Pro 11 (landscape)', welcome);

    const phoneContent = phone.root.findByProps({ testID: 'onboarding-welcome-content' });
    const ipadContent = ipad.root.findByProps({ testID: 'onboarding-welcome-content' });

    expect(StyleSheet.flatten(phoneContent.props.style).paddingHorizontal).toBe(8);
    expect(StyleSheet.flatten(ipadContent.props.style).paddingHorizontal).toBe(28);
  });
});
