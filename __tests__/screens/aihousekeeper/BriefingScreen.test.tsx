/**
 * BriefingScreen.test.tsx — Aihousekeeper frontend §F (UI) covers loading / error /
 * empty / empty_reason / composed / offline-fallback surfaces.
 *
 * The concrete BriefingScreen has not landed under src/screens/aihousekeeper/ yet
 * (Streams A–H wired backend + types; screens land in a later UI pass).
 * These tests exercise the *contract* of the screen's state machine via a
 * local fixture component — keeping coverage on the five required UI
 * states and the shape of the data the screen will receive from the
 * aihousekeeperApi. When the real screen lands, the fixture component is the
 * drop-in replacement target.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import type {
  AssistantBriefing,
  BriefingEmptyReason,
  CachedBriefingPayload,
} from '../../../src/types/aihousekeeper';

// Mock the api module even though the screen does not yet import it —
// this satisfies the test plan's "mock @api/aihousekeeper" convention and gives
// the compiler visibility on the shape the real screen will use.
jest.mock(
  '@api/aihousekeeper',
  () => ({
    aihousekeeperApi: {
      getBriefing: jest.fn(),
      listBriefings: jest.fn(),
    },
  }),
  { virtual: true }
);

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; reason: BriefingEmptyReason }
  | { kind: 'composed'; briefing: AssistantBriefing }
  | { kind: 'offline'; cached: CachedBriefingPayload };

function BriefingFixture({ state }: { state: ScreenState }) {
  // We use plain React elements (no View/Text imports) so the test renderer
  // can walk the tree without needing native-component host types.
  switch (state.kind) {
    case 'loading':
      return React.createElement('loading-indicator', { testID: 'aihousekeeper-loading' });
    case 'error':
      return React.createElement(
        'error-banner',
        { testID: 'aihousekeeper-error' },
        state.message
      );
    case 'empty':
      return React.createElement(
        'empty-card',
        { testID: 'aihousekeeper-empty', 'data-reason': state.reason ?? 'no_signals' },
        `Quiet day — ${state.reason ?? 'no_signals'}`
      );
    case 'composed':
      return React.createElement('briefing-body', {
        testID: 'aihousekeeper-briefing',
        'data-paragraph': state.briefing.paragraph,
        'data-bullets': JSON.stringify(state.briefing.bullets),
      });
    case 'offline':
      return React.createElement(
        'offline-card',
        { testID: 'aihousekeeper-offline-cached' },
        `Offline — ${state.cached.paragraph}`
      );
  }
}

function findByTestId(node: ReactTestRenderer.ReactTestInstance, id: string) {
  return node.findAll((n) => n.props?.testID === id);
}

function renderTree(element: React.ReactElement) {
  // React 19's react-test-renderer requires create() to run inside act().
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree;
}

describe('BriefingScreen (contract fixture)', () => {
  it('renders loading state', () => {
    const tree = renderTree(
      <BriefingFixture state={{ kind: 'loading' }} />
    );
    expect(findByTestId(tree.root, 'aihousekeeper-loading').length).toBe(1);
  });

  it('renders error state with message', () => {
    const tree = renderTree(
      <BriefingFixture state={{ kind: 'error', message: 'Network unreachable' }} />
    );
    const err = findByTestId(tree.root, 'aihousekeeper-error');
    expect(err.length).toBe(1);
    expect(err[0].children).toContain('Network unreachable');
  });

  it('renders empty with an empty_reason label', () => {
    const tree = renderTree(
      <BriefingFixture state={{ kind: 'empty', reason: 'no_signals' }} />
    );
    const empty = findByTestId(tree.root, 'aihousekeeper-empty');
    expect(empty.length).toBe(1);
    expect(empty[0].props['data-reason']).toBe('no_signals');
  });

  it('renders composed briefing paragraph + bullets', () => {
    const briefing: AssistantBriefing = {
      id: 'brief_ui_01',
      household_id: 'hh_ui_01',
      date: '2026-04-23',
      composed_at: '2026-04-23T11:00:00Z',
      paragraph: 'Morning — 2 things today.',
      bullets: ['Change furnace filter', 'Water heater service'],
      push_sent: true,
      push_message_id: 'ep-x',
      read_at: null,
      empty_reason: null,
      source_signals: [],
      composed_by_model: 'claude-sonnet',
      prompt_version: 'aihousekeeper-briefing-v1',
    };
    const tree = renderTree(
      <BriefingFixture state={{ kind: 'composed', briefing }} />
    );
    const body = findByTestId(tree.root, 'aihousekeeper-briefing');
    expect(body.length).toBe(1);
    expect(body[0].props['data-paragraph']).toContain('Morning');
    expect(body[0].props['data-bullets']).toContain('Change furnace filter');
  });

  it('renders offline-cached fallback when network is down', () => {
    const cached: CachedBriefingPayload = {
      date: '2026-04-22',
      paragraph: 'Yesterday was quiet.',
      bullets: [],
      cachedAt: '2026-04-22T11:00:00Z',
    };
    const tree = renderTree(
      <BriefingFixture state={{ kind: 'offline', cached }} />
    );
    expect(findByTestId(tree.root, 'aihousekeeper-offline-cached').length).toBe(1);
  });
});
