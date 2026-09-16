/**
 * PermissionCard — the ONE surface for "this needs an OS permission" across
 * every app in the fleet. Two things are pinned here:
 *
 * 1. `layout="full"` (the default, used by onboarding) keeps rendering the
 *    explanation paragraph inline, unchanged from before `layout` existed.
 * 2. `layout="compact"` (Home/settings-list placements) collapses to a
 *    single actionable row; the same paragraph moves behind an (i) bottom
 *    sheet, and dismiss (×) shows only when the screen supplies `onDismiss`.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { PermissionCard } from '../PermissionCard';

type Rendered = ReactTestRenderer.ReactTestRenderer;

const CARD = 'permission-card';

const COPY = {
  'not-requested': { body: 'Turn this on and we can remind you.' },
  denied: { body: "That's a fine choice — everything still works without it." },
};

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function renderCard(props: Partial<React.ComponentProps<typeof PermissionCard>> = {}): Rendered {
  return render(
    <PermissionCard state="not-requested" icon="notifications" title="Notifications" copy={COPY} {...props} />,
  );
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

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

function press(tree: Rendered, id: string) {
  const target = tree.root
    .findAll((n) => n.props?.testID === id && typeof n.props?.onPress === 'function')[0];
  act(() => {
    target?.props.onPress();
  });
}

describe('PermissionCard — full layout (default)', () => {
  it('renders the body paragraph inline, no (i) or dismiss affordance', () => {
    const tree = renderCard({ state: 'not-requested' });
    expect(textOf(byTestId(tree, `${CARD}-body`)[0])).toContain('Turn this on');
    expect(byTestId(tree, `${CARD}-info`)).toHaveLength(0);
    expect(byTestId(tree, `${CARD}-dismiss`)).toHaveLength(0);
  });

  it('offers Allow for not-requested', () => {
    const onRequest = jest.fn();
    const tree = renderCard({ state: 'not-requested', onRequest });
    press(tree, `${CARD}-request`);
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('offers Open Settings for denied', () => {
    const onOpenSettings = jest.fn();
    const tree = renderCard({ state: 'denied', onOpenSettings });
    press(tree, `${CARD}-settings`);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe('PermissionCard — compact layout', () => {
  it('collapses the body out of the row, behind the (i) sheet', () => {
    const tree = renderCard({ state: 'not-requested', layout: 'compact' });
    expect(byTestId(tree, `${CARD}-body`)).toHaveLength(0);

    press(tree, `${CARD}-info`);
    expect(textOf(byTestId(tree, `${CARD}-body`)[0])).toContain('Turn this on');
  });

  it('unifies Allow into the inline action testID for not-requested', () => {
    const onRequest = jest.fn();
    const tree = renderCard({ state: 'not-requested', layout: 'compact', onRequest });
    expect(textOf(byTestId(tree, `${CARD}-action`)[0])).toContain('Allow');
    press(tree, `${CARD}-action`);
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('unifies Open Settings into the inline action testID for denied', () => {
    const onOpenSettings = jest.fn();
    const tree = renderCard({ state: 'denied', layout: 'compact', onOpenSettings });
    expect(textOf(byTestId(tree, `${CARD}-action`)[0])).toContain('Open Settings');
    press(tree, `${CARD}-action`);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('offers no action for granted', () => {
    expect(byTestId(renderCard({ state: 'granted', layout: 'compact' }), `${CARD}-action`)).toHaveLength(0);
  });

  it('offers no action for unavailable', () => {
    expect(byTestId(renderCard({ state: 'unavailable', layout: 'compact' }), `${CARD}-action`)).toHaveLength(0);
  });

  it('hides dismiss unless the screen supplies onDismiss', () => {
    expect(byTestId(renderCard({ layout: 'compact' }), `${CARD}-dismiss`)).toHaveLength(0);
  });

  it('fires onDismiss exactly once when pressed', () => {
    const onDismiss = jest.fn();
    const tree = renderCard({ layout: 'compact', onDismiss });
    press(tree, `${CARD}-dismiss`);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
