/**
 * BudgetChatFab — the Budget-only floating chat button (mounted app-wide in the
 * Budget build). Opens `/budget-chat`, and shows a live unread badge sourced
 * from the Budget chat store (capped at "99+"), with an accessible label.
 */
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { ChatFab } from '../ChatFab';
import { budgetChatConfig } from '../configs';
import type { ChatRoom } from '../types';

// The FAB reads its unread count from the config's store; drive that store.
const useBudgetChatStore = budgetChatConfig.store;

function makeRoom(unread: number): ChatRoom {
  return {
    id: `r_${unread}`,
    name: 'General',
    ai_enabled: true,
    is_default: true,
    is_assistant: false,
    restricted: false,
    created_by: 'u1',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    last_message: null,
    unread_count: unread,
  };
}

let tree: ReactTestRenderer.ReactTestRenderer;

function render() {
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ChatFab config={budgetChatConfig} />
      </ThemeProvider>,
    );
  });
  return tree;
}

function setRooms(rooms: ChatRoom[]) {
  act(() => {
    useBudgetChatStore.getState().setRooms(rooms);
  });
}

function badgeText(): string | null {
  const texts = tree.root.findAll((n) => {
    const c = n.props?.children;
    // The badge renders the raw number (≤99) or the string "99+".
    return (typeof c === 'string' || typeof c === 'number') && /^\d+$|99\+/.test(String(c));
  });
  return texts.length ? String(texts[0].props.children) : null;
}

beforeEach(() => {
  mockPush.mockReset();
  act(() => useBudgetChatStore.getState().reset());
});

afterEach(() => {
  act(() => tree?.unmount());
});

it('routes to /budget-chat when pressed', () => {
  render();
  const fab = tree.root.findByProps({ testID: 'budget-chat-fab' });
  act(() => fab.props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/budget-chat');
});

it('applies the pressed-state styling (opacity + scale)', () => {
  render();
  const fab = tree.root.findByProps({ testID: 'budget-chat-fab' });
  // Pressable style is a function of the press state — exercise both branches.
  const idle = fab.props.style({ pressed: false }).find((s: { opacity?: number }) => s?.opacity != null);
  const pressed = fab.props.style({ pressed: true }).find((s: { opacity?: number }) => s?.opacity != null);
  expect(idle.opacity).toBe(1);
  expect(pressed.opacity).toBeLessThan(1);
  expect(pressed.transform[0].scale).toBeLessThan(1);
});

it('hides the badge and uses the plain label when there is no unread', () => {
  render();
  const fab = tree.root.findByProps({ testID: 'budget-chat-fab' });
  expect(fab.props.accessibilityLabel).toBe('Open chat');
  expect(badgeText()).toBeNull();
});

it('shows the unread count and an accessible unread label', () => {
  render();
  setRooms([makeRoom(2), makeRoom(3)]);
  const fab = tree.root.findByProps({ testID: 'budget-chat-fab' });
  expect(fab.props.accessibilityLabel).toBe('Open chat, 5 unread');
  expect(badgeText()).toBe('5');
});

it('caps the badge at 99+', () => {
  render();
  setRooms([makeRoom(150)]);
  expect(badgeText()).toBe('99+');
});
