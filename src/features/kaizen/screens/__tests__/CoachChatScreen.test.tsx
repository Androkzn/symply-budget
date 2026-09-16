/**
 * Guide tab / CoachChatScreen — interaction + store/API contract.
 *
 * Covers every control: Enable AI (inline, no navigation), composer TextInput,
 * Send, Manage memory, tool chips, Approve memory, Start practice — and asserts
 * store/API side effects + error UI. Layout must not reserve a dead minHeight band.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';
import {
  openCoachToolRoute,
  resolveCoachToolResults,
} from '@features/kaizen/services/coachToolResolver';

import {
  IPHONE,
  allText,
  expectNoDeadMinHeightBand,
  expectNoNavigation,
  expectStillOnScreen,
  hasTestId,
  pressByA11yLabel,
  pressByText,
  typeIn,
} from '../../test-utils/kaizenScreenTestKit';
import { CoachChatScreen } from '../CoachChatScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

jest.mock('@features/kaizen/services/coachToolResolver', () => ({
  __esModule: true,
  openCoachToolRoute: jest.fn(),
  resolveCoachToolResults: jest.fn().mockResolvedValue([]),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const A = () => jest.fn().mockResolvedValue(undefined);
  const state = {
    hasAIDisclosureAck: jest.fn(() => true),
    setAIDisclosureAck: jest.fn(),
    sendCoachMessage: jest.fn().mockResolvedValue({
      session_id: 'sess-1',
      assistant_message: 'Try a focused system-design rep.',
      message: { content: 'Try a focused system-design rep.' },
      tool_results: [],
      proposed_memory_updates: [],
    }),
    upsertMemory: A(),
    approveMemory: A(),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <CoachChatScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  state.hasAIDisclosureAck.mockReturnValue(true);
});

describe('CoachChatScreen — Guide tab shell', () => {
  it('uses Guide title matching the tab label and mounts screen/composer testIDs', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Guide');
    expect(text).toContain('Ask your coach for practical next steps.');
    expect(text).toContain('What would make today feel meaningfully better?');
    expect(hasTestId(tree, 'kaizen-guide-screen')).toBe(true);
    expect(hasTestId(tree, 'kaizen-guide-composer')).toBe(true);
    expect(hasTestId(tree, 'kaizen-guide-empty')).toBe(true);
    expectNoDeadMinHeightBand(tree, { testID: 'kaizen-guide-messages', maxMinHeight: 80 });
  });
});

describe('CoachChatScreen — Enable AI (inline, no navigation)', () => {
  it('acknowledges AI on the same screen without router navigation', async () => {
    state.hasAIDisclosureAck.mockReturnValue(false);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Enable AI');
    expect(hasTestId(tree, 'kaizen-guide-enable-ai')).toBe(true);

    act(() => pressByText(tree, 'Enable AI'));

    expect(state.setAIDisclosureAck).toHaveBeenCalledWith(true);
    expect(allText(tree.toJSON())).not.toContain('Enable AI');
    expectStillOnScreen(tree, 'kaizen-guide-screen');
    expect(hasTestId(tree, 'kaizen-guide-composer')).toBe(true);
    expect(hasTestId(tree, 'kaizen-guide-empty')).toBe(true);
    expectNoNavigation(router as unknown as { push: jest.Mock });
    expectNoDeadMinHeightBand(tree, { testID: 'kaizen-guide-messages', maxMinHeight: 80 });
  });

  it('does not send while disclosure is unacknowledged', async () => {
    state.hasAIDisclosureAck.mockReturnValue(false);
    const tree = await renderScreen();
    act(() => typeIn(tree, 'Help me plan my week'));
    await act(async () => {
      pressByA11yLabel(tree, 'Send');
    });
    expect(state.sendCoachMessage).not.toHaveBeenCalled();
  });
});

describe('CoachChatScreen — composer submit → store/API', () => {
  it('sends a typed message to the coach store action', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'Help me plan my week'));
    await act(async () => {
      pressByA11yLabel(tree, 'Send');
    });
    expect(state.sendCoachMessage).toHaveBeenCalledWith('Help me plan my week', [], true, undefined);
  });

  it('renders reply, next-best-step, tool chips and memory proposals with actions', async () => {
    state.sendCoachMessage.mockResolvedValueOnce({
      session_id: 'sess-9',
      assistant_message: 'Do a focused system-design rep.',
      message: { content: 'Do a focused system-design rep.' },
      tool_results: [{ tool: 'schedule_practice' }],
      proposed_memory_updates: [{ category: 'goal', fact: 'Wants a staff role' }],
    });
    (resolveCoachToolResults as jest.Mock).mockResolvedValueOnce([
      { tool: 'schedule_practice', result: 'Scheduled' },
      { tool: 'lookup_role', result: undefined },
    ]);
    const tree = await renderScreen();
    act(() => typeIn(tree, 'What should I do next?'));
    await act(async () => {
      pressByA11yLabel(tree, 'Send');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Do a focused system-design rep.');
    expect(text).toContain('NEXT BEST STEP');
    expect(text).toContain('schedule_practice');
    expect(text).toContain('Wants a staff role');

    act(() => pressByText(tree, 'schedule_practice'));
    expect(openCoachToolRoute).toHaveBeenCalledWith({
      tool: 'schedule_practice',
      result: 'Scheduled',
    });

    act(() => pressByText(tree, 'Start practice'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/practice');

    await act(async () => {
      pressByText(tree, 'Approve');
    });
    expect(state.upsertMemory).toHaveBeenCalledWith({
      category: 'goal',
      fact: 'Wants a staff role',
    });
    expect(state.approveMemory).toHaveBeenCalledWith('Wants a staff role');
    expect(allText(tree.toJSON())).not.toContain('Wants a staff role');
  });

  it('uses message.content then the generic fallback when assistant_message is absent', async () => {
    state.sendCoachMessage.mockResolvedValueOnce({
      session_id: 'sess-a',
      assistant_message: null,
      message: { content: 'Reply from message field' },
      tool_results: [],
      proposed_memory_updates: [],
    });
    const tree = await renderScreen();
    act(() => typeIn(tree, 'hi'));
    await act(async () => {
      pressByA11yLabel(tree, 'Send');
    });
    expect(allText(tree.toJSON())).toContain('Reply from message field');
  });

  it('falls back to the generic acknowledgement when the response has no body', async () => {
    state.sendCoachMessage.mockResolvedValueOnce({ session_id: 'sess-b', assistant_message: null });
    const tree = await renderScreen();
    act(() => typeIn(tree, 'hi'));
    await act(async () => {
      pressByA11yLabel(tree, 'Send');
    });
    expect(allText(tree.toJSON())).toContain('Your coach received that.');
  });

  it('shows an error message when the coach request fails', async () => {
    state.sendCoachMessage.mockRejectedValueOnce(new Error('offline'));
    const tree = await renderScreen();
    act(() => typeIn(tree, 'hi'));
    await act(async () => {
      pressByA11yLabel(tree, 'Send');
    });
    expect(allText(tree.toJSON())).toContain('I could not reach the coach. Please try again.');
  });

  it('carries prior turns and the session id into a follow-up message', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'first'));
    await act(async () => {
      pressByA11yLabel(tree, 'Send');
    });
    act(() => typeIn(tree, 'second'));
    await act(async () => {
      const inputs = tree.root.findAll((n) => String(n.type) === 'TextInput');
      inputs[0].props.onSubmitEditing();
    });
    expect(state.sendCoachMessage).toHaveBeenLastCalledWith(
      'second',
      [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'Try a focused system-design rep.' },
      ],
      true,
      'sess-1',
    );
  });

  it('does not send blank or whitespace-only drafts', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, '   '));
    await act(async () => {
      pressByA11yLabel(tree, 'Send');
    });
    expect(state.sendCoachMessage).not.toHaveBeenCalled();
  });

  it('opens memory management from the footer link', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Manage memory'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/memory');
  });

  it('shows a spinner in the send button while the request is in flight', async () => {
    let resolveSend!: (value: unknown) => void;
    state.sendCoachMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    const tree = await renderScreen();
    act(() => typeIn(tree, 'hi'));
    act(() => {
      pressByA11yLabel(tree, 'Send');
    });
    expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    await act(async () => {
      resolveSend({
        session_id: 'sess-c',
        assistant_message: 'done',
        message: { content: 'done' },
        tool_results: [],
        proposed_memory_updates: [],
      });
      await Promise.resolve();
    });
  });
});
