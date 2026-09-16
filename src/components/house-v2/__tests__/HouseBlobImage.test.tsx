/**
 * The fetch policy — who decides to spend a member's cellular data.
 *
 * A House attachment is a sealed blob: there is no thumbnail variant to fetch
 * instead, so "render this image" means "download the whole thing". On a screen
 * with several attachments that is a real bill, which is why H6 specifies
 * *lazy on first view, with an explicit download affordance on cellular*
 * (plan §8) rather than the usual eager image load.
 *
 * That makes this component's decision table the thing worth testing, and it is
 * genuinely three-way rather than a boolean:
 *
 *   auto    → fetch on first view UNLESS metered; on metered, offer a button
 *   always  → fetch regardless (a full-screen viewer the member opened)
 *   manual  → never without a tap
 *
 * The cached case has to short-circuit all of it: `isHouseBlobCached` answers
 * from disk without touching the network, so a blob already decrypted on this
 * device must render even on cellular. Getting that wrong would put a download
 * button in front of a member for a file already sitting on their phone.
 *
 * Everything below is asserted against fakes because the real path needs an
 * enrolled household key, a relay and R2 — none of which a unit test should
 * reach, and all of which the two-device suite already exercises end to end.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

let mockCached = false;
let mockMetered = false;
const mockResolve = jest.fn(async () => 'file:///cache/lf-blobs/blob_1');

jest.mock('@features/house/local/blobs', () => ({
  __esModule: true,
  isHouseBlobCached: async () => mockCached,
  resolveHouseBlobUri: (...args: unknown[]) => mockResolve(...(args as [])),
  cachedBlobUri: (id: string) => `file:///cache/lf-blobs/${id}`,
}));

jest.mock('../meteredConnection', () => ({
  __esModule: true,
  isMeteredConnection: async () => mockMetered,
}));

import { HouseBlobImage } from '../HouseBlobImage';

const DESCRIPTOR = {
  blobId: 'blob_1',
  mime: 'image/jpeg',
  bytes: 2 * 1024 * 1024,
  sha256: 'abc',
  chunkCount: 1,
  keyEpoch: 1,
};

async function render(props: Record<string, unknown> = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <HouseBlobImage descriptor={DESCRIPTOR as never} {...props} />,
    );
  });
  return tree;
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAll((n) => n.props?.testID === testID).length > 0;
}

beforeEach(() => {
  mockCached = false;
  mockMetered = false;
  mockResolve.mockClear();
});

describe('auto policy — the default, and the one that protects the bill', () => {
  it('fetches on an unmetered connection', async () => {
    const tree = await render();
    expect(mockResolve).toHaveBeenCalled();
    expect(has(tree, 'lf-attach-image-download')).toBe(false);
  });

  it('offers a DOWNLOAD BUTTON instead of fetching on cellular', async () => {
    // The load-bearing assertion. Auto-fetching several sealed blobs over
    // cellular is a real cost, and there is no smaller variant to fetch.
    mockMetered = true;
    const tree = await render();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(has(tree, 'lf-attach-image-download')).toBe(true);
  });

  it('renders a CACHED blob on cellular without asking', async () => {
    // Already decrypted on this device — no network involved. Putting a
    // download button in front of a file the member already has is the failure
    // this case exists to prevent.
    mockCached = true;
    mockMetered = true;
    const tree = await render();
    expect(has(tree, 'lf-attach-image-download')).toBe(false);
  });
});

describe('always policy — the member asked for this one', () => {
  it('fetches even on cellular', async () => {
    // A full-screen viewer the member deliberately opened. Making them tap
    // twice for something they already chose is the wrong trade.
    mockMetered = true;
    await render({ fetchPolicy: 'always' });
    expect(mockResolve).toHaveBeenCalled();
  });
});

describe('manual policy — never without a tap', () => {
  it('does not fetch even on wifi', async () => {
    mockMetered = false;
    const tree = await render({ fetchPolicy: 'manual' });
    expect(mockResolve).not.toHaveBeenCalled();
    expect(has(tree, 'lf-attach-image-download')).toBe(true);
  });
});

describe('testID prefixing — hosts mount more than one of these', () => {
  it('suffixes every element off the caller’s prefix', async () => {
    // A task with five photos renders five of these. Fixed ids would make
    // Maestro's first match ambiguous and the flows non-deterministic.
    mockMetered = true;
    const tree = await render({ testID: 'appliance-doc-0' });
    expect(has(tree, 'appliance-doc-0-download')).toBe(true);
    expect(has(tree, 'lf-attach-image-download')).toBe(false);
  });
});
