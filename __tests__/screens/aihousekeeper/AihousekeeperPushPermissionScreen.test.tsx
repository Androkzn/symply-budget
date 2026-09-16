/**
 * AihousekeeperPushPermissionScreen.test.tsx — allow / deny / re-prompt-after-7d
 *
 * The concrete screen has not landed yet; this test pins the state machine
 * the screen will implement (per plan §F):
 *   1. First paint — `allow` button exposed.
 *   2. User taps `allow` → onAllow() called with permission granted.
 *   3. User taps `deny` → onDeny() called; we re-prompt only if ≥7d passed.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock(
  '@api/aihousekeeper',
  () => ({ aihousekeeperApi: { updateIdentity: jest.fn() } }),
  { virtual: true }
);

interface PermissionProps {
  lastDeniedAt: string | null;
  now: Date;
  onAllow: () => void;
  onDeny: () => void;
}

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

function shouldReprompt(lastDeniedAt: string | null, now: Date): boolean {
  if (!lastDeniedAt) return true;
  const age = now.getTime() - Date.parse(lastDeniedAt);
  return age >= SEVEN_DAYS_MS;
}

function AihousekeeperPushPermissionFixture(props: PermissionProps) {
  const visible = shouldReprompt(props.lastDeniedAt, props.now);
  if (!visible) {
    return React.createElement('hidden-marker', { testID: 'aihousekeeper-permission-hidden' });
  }
  return React.createElement(
    'container',
    { testID: 'aihousekeeper-permission' },
    React.createElement('allow-btn', {
      testID: 'aihousekeeper-allow-btn',
      onClick: props.onAllow,
    }),
    React.createElement('deny-btn', {
      testID: 'aihousekeeper-deny-btn',
      onClick: props.onDeny,
    })
  );
}

function findByTestId(root: ReactTestRenderer.ReactTestInstance, id: string) {
  return root.findAll((n) => n.props?.testID === id);
}

function renderTree(element: React.ReactElement) {
  // React 19's react-test-renderer requires create() to run inside act().
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree;
}

describe('AihousekeeperPushPermissionScreen (contract fixture)', () => {
  it('renders the prompt on first visit (lastDeniedAt === null)', () => {
    const tree = renderTree(
      <AihousekeeperPushPermissionFixture
        lastDeniedAt={null}
        now={new Date('2026-04-23T12:00:00Z')}
        onAllow={() => {}}
        onDeny={() => {}}
      />
    );
    expect(findByTestId(tree.root, 'aihousekeeper-permission').length).toBe(1);
  });

  it('fires onAllow when the allow button is tapped', () => {
    let allowed = false;
    const tree = renderTree(
      <AihousekeeperPushPermissionFixture
        lastDeniedAt={null}
        now={new Date('2026-04-23T12:00:00Z')}
        onAllow={() => {
          allowed = true;
        }}
        onDeny={() => {}}
      />
    );
    const btn = findByTestId(tree.root, 'aihousekeeper-allow-btn');
    expect(btn.length).toBe(1);
    (btn[0].props.onClick as () => void)();
    expect(allowed).toBe(true);
  });

  it('fires onDeny when deny button is tapped', () => {
    let denied = false;
    const tree = renderTree(
      <AihousekeeperPushPermissionFixture
        lastDeniedAt={null}
        now={new Date('2026-04-23T12:00:00Z')}
        onAllow={() => {}}
        onDeny={() => {
          denied = true;
        }}
      />
    );
    const btn = findByTestId(tree.root, 'aihousekeeper-deny-btn');
    expect(btn.length).toBe(1);
    (btn[0].props.onClick as () => void)();
    expect(denied).toBe(true);
  });

  it('hides the prompt when user denied less than 7 days ago', () => {
    const lastDeniedAt = new Date('2026-04-20T12:00:00Z').toISOString(); // 3d ago
    const tree = renderTree(
      <AihousekeeperPushPermissionFixture
        lastDeniedAt={lastDeniedAt}
        now={new Date('2026-04-23T12:00:00Z')}
        onAllow={() => {}}
        onDeny={() => {}}
      />
    );
    expect(findByTestId(tree.root, 'aihousekeeper-permission').length).toBe(0);
    expect(findByTestId(tree.root, 'aihousekeeper-permission-hidden').length).toBe(1);
  });

  it('re-prompts after 7 days have passed since deny', () => {
    const lastDeniedAt = new Date('2026-04-10T12:00:00Z').toISOString(); // 13d ago
    const tree = renderTree(
      <AihousekeeperPushPermissionFixture
        lastDeniedAt={lastDeniedAt}
        now={new Date('2026-04-23T12:00:00Z')}
        onAllow={() => {}}
        onDeny={() => {}}
      />
    );
    expect(findByTestId(tree.root, 'aihousekeeper-permission').length).toBe(1);
  });
});
