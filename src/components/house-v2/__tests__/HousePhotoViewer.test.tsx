/**
 * The full-screen photo viewer — what it must get right to be worth having.
 *
 * The bug this component exists to fix was not visual: project photos rendered
 * as a filename and a 64pt thumbnail, so a member could attach five renovation
 * photos and never see one at a size that shows anything. So the assertions
 * here are about the parts that would silently reproduce that:
 *
 *  - **Both byte channels render.** A server-backed attachment carries a URL, a
 *    local-first one carries a sealed-blob descriptor, and NEITHER renderer can
 *    open the other's. A viewer that handled one would be a viewer for half the
 *    households we ship to, and would look perfectly fine in the other half.
 *  - **It opens on the photo that was tapped.** The pager cannot be scrolled
 *    before it has laid out, so the scroll is issued from the content-size
 *    callback; get that wrong and every tap lands on photo 1 regardless.
 *  - **Zoom and paging do not fight.** One finger means "pan" while zoomed and
 *    "next photo" otherwise, which is enforced by `scrollEnabled` rather than
 *    by feel.
 *
 * Fakes, not the real blob path: decrypting a blob needs an enrolled household
 * key, a relay and R2. The two-device suite covers that end to end; this covers
 * the component's decisions.
 */
import React from 'react';
import { Dimensions } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('@features/house/local/blobs', () => ({
  __esModule: true,
  isHouseBlobCached: async () => true,
  resolveHouseBlobUri: async () => 'file:///cache/lf-blobs/blob_1',
  cachedBlobUri: (id: string) => `file:///cache/lf-blobs/${id}`,
  BLOB_MAX_PLAINTEXT_BYTES: 25 * 1024 * 1024,
}));

import { HousePhotoViewer, type HousePhotoViewerItem } from '../HousePhotoViewer';

import { hasTestId, labelOf, press, textOf } from './houseV2ComponentTestKit';

type Tree = ReactTestRenderer.ReactTestRenderer;

const BLOB = {
  blobId: 'blob_1',
  mime: 'image/jpeg',
  bytes: 1024,
  sha256: 'abc',
  chunkCount: 1,
  keyEpoch: 1,
};

const PHOTOS: HousePhotoViewerItem[] = [
  { id: 'a', url: 'https://cdn.example/a.jpg', title: 'a.jpg', subtitle: 'before' },
  { id: 'b', blob: BLOB as never, title: 'b.jpg', subtitle: 'after' },
  { id: 'c', url: 'https://cdn.example/c.jpg', title: 'c.jpg', subtitle: 'untagged' },
];

const TEST_ID = 'house-photo-viewer';

/** A page is one window wide, so every offset here is in units of this. */
const PAGE_WIDTH = Dimensions.get('window').width;

async function render(props: Partial<React.ComponentProps<typeof HousePhotoViewer>> = {}) {
  let tree!: Tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <HousePhotoViewer
        photos={PHOTOS}
        index={0}
        onClose={jest.fn()}
        {...props}
      />,
    );
  });
  return tree;
}

/** The pager node — matched on a prop only a ScrollView carries. */
function pager(tree: Tree) {
  return tree.root.findAll(
    n => n.props?.testID === `${TEST_ID}-pager` && n.props?.pagingEnabled !== undefined,
  )[0]!;
}

/** Swipe to a page the way the platform reports it: a momentum scroll landing. */
async function swipeTo(tree: Tree, page: number) {
  await act(async () => {
    pager(tree).props.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { x: page * PAGE_WIDTH, y: 0 } },
    });
  });
}

describe('HousePhotoViewer', () => {
  it('renders nothing until a photo is opened', async () => {
    const tree = await render({ index: null });
    expect(tree.toJSON()).toBeNull();
  });

  it('stays closed when the list it was handed is empty', async () => {
    const tree = await render({ photos: [], index: 0 });
    expect(tree.toJSON()).toBeNull();
  });

  it('renders one page per photo, each by the channel that carries its bytes', async () => {
    const tree = await render();

    // A URL page and a blob page are different renderers on purpose: `-remote`
    // is an <Image>, `-blob-view` is the state HouseBlobImage reaches only
    // after the bytes decrypted.
    expect(hasTestId(tree, `${TEST_ID}-page-0-remote`)).toBe(true);
    expect(hasTestId(tree, `${TEST_ID}-page-1-blob-view`)).toBe(true);
    expect(hasTestId(tree, `${TEST_ID}-page-2-remote`)).toBe(true);
  });

  it('says which photo is on screen, and where it sits in the set', async () => {
    const tree = await render({ index: 1 });
    expect(textOf(tree, `${TEST_ID}-counter`)).toBe('2 of 3');
    expect(textOf(tree, `${TEST_ID}-caption`)).toBe('b.jpgafter');
  });

  it('opens the pager on the photo that was tapped, not on the first one', async () => {
    const tree = await render({ index: 2 });
    const scrollTo = jest.fn();
    // The instance the component holds via its ref; the callback is what fires
    // once the pages have a size to scroll within.
    pager(tree).instance.scrollTo = scrollTo;
    await act(async () => {
      pager(tree).props.onContentSizeChange();
    });
    expect(scrollTo).toHaveBeenCalledWith({ x: 2 * PAGE_WIDTH, animated: false });
  });

  it('follows a swipe: the counter, the caption and the caller all move', async () => {
    const onIndexChange = jest.fn();
    const tree = await render({ index: 0, onIndexChange });

    await swipeTo(tree, 2);

    expect(onIndexChange).toHaveBeenCalledWith(2);
    expect(textOf(tree, `${TEST_ID}-counter`)).toBe('3 of 3');
    expect(textOf(tree, `${TEST_ID}-caption`)).toBe('c.jpguntagged');
  });

  it('ignores a momentum stop that landed back on the page it started from', async () => {
    const onIndexChange = jest.fn();
    const tree = await render({ index: 1, onIndexChange });
    await swipeTo(tree, 1);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('does not offer a swipe when there is nowhere to swipe to', async () => {
    const tree = await render({ photos: [PHOTOS[0]!], index: 0 });
    expect(pager(tree).props.scrollEnabled).toBe(false);
    // One photo is not a set, so the "1 of 1" counter is noise.
    expect(hasTestId(tree, `${TEST_ID}-counter`)).toBe(false);
  });

  it('closes on the close button', async () => {
    const onClose = jest.fn();
    const tree = await render({ onClose });
    await press(tree, `${TEST_ID}-close`);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the Android back gesture', async () => {
    const onClose = jest.fn();
    const tree = await render({ onClose });
    const modal = tree.root.findAll(n => n.props?.onRequestClose !== undefined)[0]!;
    await act(async () => {
      modal.props.onRequestClose();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names a photo by its position, since the filename is a UUID', async () => {
    const tree = await render({
      photos: [{ id: 'x', url: 'https://cdn.example/x.jpg' }],
      index: 0,
    });
    expect(labelOf(tree, `${TEST_ID}-page-0-remote`)).toBe('Photo 1 of 1');
  });

  it('says so when an attachment carries neither channel', async () => {
    const tree = await render({ photos: [{ id: 'gone', title: 'gone.jpg' }], index: 0 });
    // Not a black screen: a row with no bytes is a broken record, and the
    // member should not have to guess whether the viewer failed.
    expect(hasTestId(tree, `${TEST_ID}-page-0-missing`)).toBe(true);
  });
});
