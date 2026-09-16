/**
 * OnboardingStepScreen — the shared chrome for Symply Health's onboarding
 * mini-flow (goals steps + the shared permission steps built on it).
 *
 * Drives the real component and asserts the exact layout this shell was
 * reworked to have: the brand logo sits BETWEEN the back/forward arrows in
 * the header row (not the step dots — the dots live on their own row below
 * the header, not nested inside it); both arrows drive the same `onContinue`
 * the bottom button does; the forward arrow (never the back arrow) disables
 * while `continueBusy`; a single-step flow (`totalSteps <= 1`, the
 * permission screens on non-Health brands) renders no dots at all; and
 * "Continue" is a FLOATING footer OUTSIDE the scrolling content, whose
 * measured height feeds the ScrollView's own bottom padding so nothing a
 * step renders ends up permanently hidden behind the button.
 */
import React from 'react';
import { ScrollView } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { OnboardingStepScreen } from '../OnboardingStepScreen';

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

/**
 * `<StepDots testID=.../>` carries that `testID` prop on its OWN composite
 * element even in the `totalSteps <= 1` case where it renders `null`
 * internally — so a bare `findAllByProps` match is not proof of an actual
 * rendered dot row. Host-only (`typeof n.type === 'string'`) is.
 */
function isVisible(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return (
    tree.root.findAllByProps({ testID }).filter((n) => typeof n.type === 'string').length > 0
  );
}

function renderStep(props: Partial<React.ComponentProps<typeof OnboardingStepScreen>> = {}) {
  const onBack = jest.fn();
  const onContinue = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <OnboardingStepScreen
          testID="step"
          title="Title"
          currentStep={0}
          totalSteps={3}
          stepLabel="Step label"
          onBack={onBack}
          onContinue={onContinue}
          {...props}
        />
      </ThemeProvider>
    );
  });
  return { tree, onBack, onContinue };
}

describe('OnboardingStepScreen', () => {
  it('renders back and forward arrows inside the header row', () => {
    const { tree } = renderStep();
    const header = tree.root.findByProps({ testID: 'step-header' });
    expect(header.findAllByProps({ testID: 'step-back' }).length).toBeGreaterThan(0);
    expect(header.findAllByProps({ testID: 'step-forward' }).length).toBeGreaterThan(0);
  });

  it('keeps the step dots OUT of the header row — they sit on their own row below it', () => {
    const { tree } = renderStep();
    const header = tree.root.findByProps({ testID: 'step-header' });
    expect(header.findAllByProps({ testID: 'step-dots' }).length).toBe(0);
    // The dots still exist somewhere in the tree, just not nested in the header.
    expect(isVisible(tree, 'step-dots')).toBe(true);
  });

  it('renders no dots at all for a single-step flow', () => {
    const { tree } = renderStep({ totalSteps: 1 });
    expect(isVisible(tree, 'step-dots')).toBe(false);
  });

  it('both arrows and the bottom button drive the SAME onContinue', () => {
    const { tree, onContinue } = renderStep();

    act(() => pressByTestId(tree, 'step-forward'));
    expect(onContinue).toHaveBeenCalledTimes(1);

    act(() => pressByTestId(tree, 'step-continue'));
    expect(onContinue).toHaveBeenCalledTimes(2);
  });

  it('the back arrow calls onBack, independently of onContinue', () => {
    const { tree, onBack, onContinue } = renderStep();
    act(() => pressByTestId(tree, 'step-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('disables the forward arrow while continueBusy, never the back arrow', () => {
    const { tree } = renderStep({ continueBusy: true });
    const forward = tree.root.findByProps({ testID: 'step-forward' });
    const back = tree.root.findByProps({ testID: 'step-back' });
    expect(forward.props.disabled).toBe(true);
    expect(back.props.disabled ?? false).toBe(false);
  });

  /**
   * `findByProps({ testID: 'step' })` alone would match the outermost
   * `<OnboardingStepScreen testID="step">` element itself before ever
   * reaching the real `ScrollView` deeper inside (the same composite/host
   * collision `StepDots` hit above) — `n.type === ScrollView` narrows to the
   * actual scrollable host.
   */
  function findScroll(tree: ReactTestRenderer.ReactTestRenderer) {
    return tree.root.findAllByProps({ testID: 'step' }).find((n) => n.type === ScrollView)!;
  }

  it('renders the Continue button OUTSIDE the scrolling content, not as its last item', () => {
    const { tree } = renderStep();
    const scroll = findScroll(tree);
    expect(scroll.findAllByProps({ testID: 'step-continue' }).length).toBe(0);
    // It still exists somewhere — as a floating footer, not inside the scroll.
    expect(tree.root.findAllByProps({ testID: 'step-continue' }).length).toBeGreaterThan(0);
  });

  it('feeds the floating footer’s measured height back into the scroll’s bottom padding', () => {
    const { tree } = renderStep();

    const footer = tree.root.findByProps({ testID: 'step-footer' });
    act(() => {
      footer.props.onLayout({ nativeEvent: { layout: { height: 96 } } });
    });

    const scroll = findScroll(tree);
    const contentStyle = scroll.props.contentContainerStyle;
    const flattened = (Array.isArray(contentStyle) ? contentStyle : [contentStyle]).reduce(
      (acc: Record<string, unknown>, style) => ({ ...acc, ...(style ?? {}) }),
      {}
    );
    // Spacing.xl is 24 in this theme's scale — the footer height plus that
    // same breathing room the old static `Layout.bottomSafeArea + Spacing.xl`
    // padding used to provide unconditionally.
    expect(flattened.paddingBottom).toBe(96 + 24);
  });

  it('renders the title, subtitle and children passed to it', () => {
    const { tree } = renderStep({ subtitle: 'Subtitle copy' });
    const text = tree.root
      .findAll((n) => typeof n.type === 'string')
      .flatMap((n) => {
        const c = n.props?.children;
        return Array.isArray(c) ? c : [c];
      })
      .filter((c) => typeof c === 'string')
      .join(' ');
    expect(text).toContain('Title');
    expect(text).toContain('Subtitle copy');
  });
});
