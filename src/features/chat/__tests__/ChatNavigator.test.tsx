/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports; loose mock types */
/**
 * ChatNavigator — the Budget-only chat stack. The native-stack primitives
 * and the three child screens are stubbed so the test drives the navigator's
 * real logic: the DeepLinkHandler that opens a specific room when the expo-router
 * route forwards a `roomId`, its no-op path when there's no room, and its
 * per-(roomId, navNonce) de-duplication.
 */
const mockNavigate = jest.fn();

jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: (props: { children?: React.ReactNode }) => React.createElement(View, null, props.children),
      Screen: (props: { children?: React.ReactNode | ((props: object) => React.ReactNode); component?: React.ComponentType }) => {
        const { children, component: Component } = props;
        let content = null;
        if (typeof children === 'function') content = children({});
        else if (Component) content = React.createElement(Component);
        else content = children ?? null;
        return React.createElement(View, null, content);
      },
    }),
  };
});

// Child screens are covered by their own suites; stub them to inert nodes.
jest.mock('../screens/ChatRoomScreen', () => ({ __esModule: true, ChatRoomScreen: () => null }));
jest.mock('../screens/ChatRoomSettingsScreen', () => ({
  __esModule: true,
  ChatRoomSettingsScreen: () => null,
}));
jest.mock('../screens/ChatRoomsListScreen', () => ({
  __esModule: true,
  ChatRoomsListScreen: () => null,
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ChatNavigator } from '../ChatNavigator';
import { budgetChatConfig } from '../configs';

type NavParams = React.ComponentProps<typeof ChatNavigator>['initialParams'];

async function renderNav(initialParams?: NavParams) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ChatNavigator config={budgetChatConfig} initialParams={initialParams} />
    );
  });
  return tree;
}

describe('ChatNavigator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('renders without deep-linking when no roomId is provided', async () => {
    await renderNav(undefined);
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to the forwarded room after mount', async () => {
    await renderNav({ roomId: 'room-1', roomName: 'Groceries', navNonce: 'n1' });
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(mockNavigate).toHaveBeenCalledWith('ChatRoom', { roomId: 'room-1', roomName: 'Groceries' });
  });

  it('defaults the room name to "Chat" when none is forwarded', async () => {
    await renderNav({ roomId: 'room-2' });
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(mockNavigate).toHaveBeenCalledWith('ChatRoom', { roomId: 'room-2', roomName: 'Chat' });
  });

  it('de-duplicates the same (roomId, navNonce) across re-renders', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ChatNavigator config={budgetChatConfig} initialParams={{ roomId: 'room-3', navNonce: 'same' }} />
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    // Re-render with a NEW object but the SAME (roomId, navNonce): effect re-runs
    // but the handler must short-circuit, so navigate fires exactly once.
    await act(async () => {
      tree.update(<ChatNavigator config={budgetChatConfig} initialParams={{ roomId: 'room-3', navNonce: 'same' }} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
