/**
 * The shared avatar, and specifically its recovery from a broken url.
 *
 * Every avatar upload mints a new filename (`avatars/<uid>-<timestamp>.jpg`),
 * and rosters are persisted — so a device routinely holds a url whose object is
 * already gone. The component used to latch a plain `imageError` boolean for its
 * whole lifetime, which meant that once a member's picture 404'd, uploading a
 * new one changed nothing on that screen: they stayed as initials until the view
 * was torn down. Keying the failure to the url is what makes "sync a new avatar
 * and it appears" true.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { Avatar } from '../Avatar';

const OLD_URL = 'https://api.example.com/avatars/usr_ada-1.jpg';
const NEW_URL = 'https://api.example.com/avatars/usr_ada-2.jpg';

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

// Host elements only: RN's `Image` is a composite that renders a host node with
// the same props, so an unfiltered `findAll` reports every image twice.
const images = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(
    (n) => typeof n.type === 'string' && typeof n.props?.source === 'object' && n.props?.source?.uri,
  );

const texts = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

describe('Avatar', () => {
  it('shows the picture when there is one', async () => {
    const tree = await render(
      <Avatar user={{ display_name: 'Ada Lovelace', avatar_url: OLD_URL, email: 'a@b.c' }} />,
    );

    expect(images(tree).map((i) => i.props.source.uri)).toEqual([OLD_URL]);
  });

  it('falls back to initials with no picture', async () => {
    const tree = await render(
      <Avatar user={{ display_name: 'Ada Lovelace', avatar_url: null, email: 'a@b.c' }} />,
    );

    expect(images(tree)).toHaveLength(0);
    expect(texts(tree)).toContain('AL');
  });

  it('falls back to initials when the picture fails to load', async () => {
    const tree = await render(
      <Avatar user={{ display_name: 'Ada Lovelace', avatar_url: OLD_URL, email: 'a@b.c' }} />,
    );

    await act(async () => {
      images(tree)[0]!.props.onError();
    });

    expect(images(tree)).toHaveLength(0);
    expect(texts(tree)).toContain('AL');
  });

  /**
   * The regression this test exists for: a NEW url has not failed, so it must be
   * attempted even though the previous one 404'd on this very component.
   */
  it('tries again when the member uploads a new picture', async () => {
    const tree = await render(
      <Avatar user={{ display_name: 'Ada Lovelace', avatar_url: OLD_URL, email: 'a@b.c' }} />,
    );

    await act(async () => {
      images(tree)[0]!.props.onError();
    });
    expect(images(tree)).toHaveLength(0);

    // The roster refreshed and their avatar changed.
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <Avatar user={{ display_name: 'Ada Lovelace', avatar_url: NEW_URL, email: 'a@b.c' }} />
        </ThemeProvider>,
      );
    });

    expect(images(tree).map((i) => i.props.source.uri)).toEqual([NEW_URL]);
  });

  it('keeps showing initials while the url that failed is still the current one', async () => {
    const tree = await render(
      <Avatar user={{ display_name: 'Ada Lovelace', avatar_url: OLD_URL, email: 'a@b.c' }} />,
    );

    await act(async () => {
      images(tree)[0]!.props.onError();
    });
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <Avatar user={{ display_name: 'Ada Lovelace', avatar_url: OLD_URL, email: 'a@b.c' }} />
        </ThemeProvider>,
      );
    });

    expect(images(tree)).toHaveLength(0);
  });

  it('initials a single-word name and an address, and copes with nobody', async () => {
    const one = await render(<Avatar user={{ display_name: 'Ada', avatar_url: null }} />);
    expect(texts(one)).toContain('AD');

    const mail = await render(<Avatar user={{ display_name: null, email: 'ada@example.com' }} />);
    expect(texts(mail)).toContain('AD');

    const nobody = await render(<Avatar />);
    expect(texts(nobody)).toContain('?');
  });
});
