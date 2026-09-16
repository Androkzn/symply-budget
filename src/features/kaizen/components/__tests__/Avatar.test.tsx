/**
 * Avatar — Symply Kaizen (`symply-kaizen`) profile avatar port.
 *
 * Renders the REAL component through <ThemeProvider>, covering initials
 * derivation, the image → fallback error path, the loading spinner, the edit
 * badge, and the pressable wrapper. `AVATAR_HASH_BACKGROUNDS` is stubbed with a
 * dark, a light, and a malformed value so every branch of the readable-ink
 * (WCAG luminance) helper is exercised across a batch of names.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import { allText } from '../../test-utils/kaizenScreenTestKit';
import { Avatar } from '../Avatar';

// The edit-badge uses a vector-icons glyph that async-loads its font and
// setState()s after the test (a benign "not wrapped in act" warning). Stub it to
// a synchronous host node that preserves `name` for the badge assertion.
jest.mock('@expo/vector-icons', () => {
  const ReactMock = require('react');
  const { Text } = require('react-native');
  const Glyph = (props: Record<string, unknown>) => ReactMock.createElement(Text, props);
  return new Proxy(
    { __esModule: true },
    { get: (_t, key) => (key === '__esModule' ? true : Glyph) },
  );
});

jest.mock('@theme', () => {
  const actual = jest.requireActual('@theme');
  return {
    __esModule: true,
    ...actual,
    // Dark (low-channel), light (high-channel) and malformed values so
    // readableInkFor hits every gamma/luminance/length branch.
    AVATAR_HASH_BACKGROUNDS: ['#0A0B0C', '#F5F5F5', 'zzz'],
  };
});

type AvatarUser = {
  display_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

function renderAvatar(node: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

/** The Avatar's tap wrapper carries `accessibilityRole="button"` + `onPress`. */
function findWrappers(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (n) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function',
  );
}

describe('Avatar initials', () => {
  const cases: Array<[string, AvatarUser | null | undefined, string]> = [
    ['two-part display name → first+last initial', { display_name: 'Ada Lovelace' }, 'AL'],
    ['single-word display name → first two letters', { display_name: 'cher' }, 'CH'],
    ['no name, uses email prefix', { email: 'zoe@example.com' }, 'ZO'],
    ['empty user → question mark', {}, '?'],
    ['null user → question mark', null, '?'],
  ];

  it.each(cases)('%s', (_label, user, expected) => {
    const tree = renderAvatar(<Avatar user={user} />);
    expect(allText(tree.toJSON())).toContain(expected);
  });

  it('renders "?" when no user prop is passed at all', () => {
    const tree = renderAvatar(<Avatar />);
    expect(allText(tree.toJSON())).toContain('?');
  });

  it('exercises the readable-ink helper across dark / light / malformed backgrounds', () => {
    // A batch of names spreads the hash across all three stubbed backgrounds,
    // covering the gamma, luminance and malformed-hex branches in one render.
    const names = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const tree = renderAvatar(
      <>
        {names.map((n) => (
          <Avatar key={n} user={{ display_name: n }} />
        ))}
      </>,
    );
    expect(tree.toJSON()).toBeTruthy();
  });
});

describe('Avatar image', () => {
  it('renders the remote image when a valid avatar_url is present', () => {
    const tree = renderAvatar(<Avatar user={{ display_name: 'Ada', avatar_url: 'https://x/y.png' }} />);
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
    // Image shown → no initials text.
    expect(allText(tree.toJSON())).not.toContain('AD');
  });

  it('falls back to initials after the image fails to load', () => {
    const tree = renderAvatar(
      <Avatar user={{ display_name: 'Ada Lovelace', avatar_url: 'https://x/broken.png' }} />,
    );
    act(() => {
      tree.root.findByType(Image).props.onError();
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(allText(tree.toJSON())).toContain('AL');
  });
});

describe('Avatar overlays', () => {
  it('shows a loading spinner over the avatar', () => {
    const tree = renderAvatar(<Avatar user={{ display_name: 'Ada' }} loading />);
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('shows the camera edit badge when editable and not loading', () => {
    const tree = renderAvatar(<Avatar user={{ display_name: 'Ada' }} showEditBadge />);
    const icons = tree.root.findAllByType(Ionicons);
    expect(icons.some((i) => i.props.name === 'camera')).toBe(true);
  });

  it('hides the edit badge while loading (badge yields to the spinner)', () => {
    const tree = renderAvatar(<Avatar user={{ display_name: 'Ada' }} showEditBadge loading />);
    expect(tree.root.findAllByType(Ionicons)).toHaveLength(0);
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });
});

describe('Avatar pressable', () => {
  it('wraps in a Pressable and fires onPress with the default a11y label', () => {
    const onPress = jest.fn();
    const tree = renderAvatar(<Avatar user={{ display_name: 'Ada' }} onPress={onPress} />);
    const [pressable] = findWrappers(tree);
    expect(pressable.props.accessibilityLabel).toBe('Change profile photo');
    act(() => pressable.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('honours a custom accessibilityLabel and disables while loading', () => {
    const onPress = jest.fn();
    const tree = renderAvatar(
      <Avatar user={{ display_name: 'Ada' }} onPress={onPress} loading accessibilityLabel="Edit avatar" />,
    );
    const [pressable] = findWrappers(tree);
    expect(pressable.props.accessibilityLabel).toBe('Edit avatar');
    expect(pressable.props.disabled).toBe(true);
  });

  it('renders the bare body (no pressable wrapper) when onPress is omitted', () => {
    const tree = renderAvatar(<Avatar user={{ display_name: 'Ada' }} />);
    expect(findWrappers(tree)).toHaveLength(0);
  });
});
