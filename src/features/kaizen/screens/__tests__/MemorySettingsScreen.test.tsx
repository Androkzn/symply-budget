/**
 * MemorySettingsScreen — Symply Kaizen (`symply-kaizen`) coach-memory control.
 *
 * Renders the REAL screen through <ThemeProvider> off mocked RQ + store actions,
 * asserts the saved-memory rows (or empty state) and drives the "Approve" /
 * "Archive" actions (→ approveMemory / archiveMemory). Archived memories are
 * filtered out by the query hook selector.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPAD, IPHONE, allText, listPressableLabels, pressByText } from '../../test-utils/kaizenScreenTestKit';
import { MemorySettingsScreen } from '../MemorySettingsScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockMemoriesState = { data: [] as unknown[] };
jest.mock('@features/kaizen/hooks/useKaizenMemories', () => ({
  __esModule: true,
  useKaizenMemories: () => mockMemoriesState,
}));

const mockApproveMemory = jest.fn().mockResolvedValue(undefined);
const mockArchiveMemory = jest.fn().mockResolvedValue(undefined);

jest.mock('@features/kaizen/stores/kaizenStore', () => ({
  __esModule: true,
  useKaizenStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector
      ? selector({ approveMemory: mockApproveMemory, archiveMemory: mockArchiveMemory })
      : { approveMemory: mockApproveMemory, archiveMemory: mockArchiveMemory },
}));

function seed(memories: unknown[]) {
  mockMemoriesState.data = memories;
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MemorySettingsScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  seed([]);
});

describe('MemorySettingsScreen', () => {
  it('renders the title and empty state with no memories', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Memory');
    expect(text).toContain('No memories saved yet.');
  });

  it('approves an unapproved memory', async () => {
    seed([{ id: 'm1', fact: 'Prefers async standups', is_approved: false, is_archived: false }]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Prefers async standups');
    expect(allText(tree.toJSON())).toContain('Needs approval');
    act(() => pressByText(tree, 'Approve'));
    expect(mockApproveMemory).toHaveBeenCalledWith('Prefers async standups');
  });

  it('archives a memory and hides archived ones', async () => {
    seed([
      { id: 'm1', fact: 'Prefers async standups', is_approved: true, is_archived: false },
    ]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Archive'));
    expect(mockArchiveMemory).toHaveBeenCalledWith('m1');
  });

  it('shows Approved badge without an Approve button for approved memories', async () => {
    seed([{ id: 'm1', fact: 'Likes morning reviews', is_approved: true, is_archived: false }]);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Likes morning reviews');
    expect(text).toContain('Approved');
    expect(text).not.toContain('Needs approval');
    expect(listPressableLabels(tree)).not.toContain('Approve');
    expect(listPressableLabels(tree)).toContain('Archive');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Memory');
  });
});
