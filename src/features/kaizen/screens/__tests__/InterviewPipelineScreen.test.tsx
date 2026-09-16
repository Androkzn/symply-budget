/**
 * InterviewPipelineScreen — Symply Kaizen (`symply-kaizen`) opportunity tracker.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store, asserts the
 * add form + opportunity rows (or empty state), and drives the "Advance" and
 * "Remove" row actions (→ movePipelineStage / deletePipelineItem).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPAD,
  IPHONE,
  allText,
  drainMockRejection,
  flushMicrotasks,
  mockHandledRejection,
  pressByText,
  pressablesWithText,
} from '../../test-utils/kaizenScreenTestKit';
import { InterviewPipelineScreen } from '../InterviewPipelineScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockPipelineState: { data: unknown[] } = { data: [] };

jest.mock('@features/kaizen/hooks/useKaizenInterviewPipeline', () => ({
  __esModule: true,
  useKaizenInterviewPipeline: () => ({ data: mockPipelineState.data }),
  useInvalidateKaizenInterviewPipeline: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector?: (s: { user?: { id: string } }) => unknown) =>
    selector ? selector({ user: { id: 'user-1' } }) : { user: { id: 'user-1' } },
}));

const mockState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

const upsertPipelineItem = jest.fn().mockResolvedValue(undefined);
const movePipelineStage = jest.fn().mockResolvedValue(undefined);
const deletePipelineItem = jest.fn().mockResolvedValue(undefined);

function seed(pipeline: unknown[]) {
  mockPipelineState.data = pipeline;
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    upsertPipelineItem,
    movePipelineStage,
    deletePipelineItem,
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <InterviewPipelineScreen />
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

describe('InterviewPipelineScreen', () => {
  it('renders the title and empty state with no opportunities', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Interview pipeline');
    expect(text).toContain('Add opportunity');
    expect(text).toContain('Add an opportunity to begin.');
  });

  it('renders an opportunity row and advances its stage', async () => {
    seed([{ id: 'p1', title: 'Acme — Staff Engineer', stage: 'applied' }]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Acme — Staff Engineer');
    act(() => pressByText(tree, 'Advance'));
    expect(movePipelineStage).toHaveBeenCalledWith('p1', 'interviewing');
  });

  it('removes an opportunity from the "Remove" action', async () => {
    seed([{ id: 'p1', title: 'Acme — Staff Engineer', stage: 'applied' }]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Remove'));
    expect(deletePipelineItem).toHaveBeenCalledWith('p1');
  });

  it('adds a new opportunity from the form', async () => {
    const tree = await renderScreen();
    const input = tree.root.find((n) => String(n.type) === 'TextInput');
    act(() => input.props.onChangeText('Globex — Backend'));
    await act(async () => pressByText(tree, 'Add to pipeline'));
    expect(upsertPipelineItem).toHaveBeenCalledWith({ title: 'Globex — Backend', stage: 'saved' });
  });

  it('advances a saved opportunity to applied', async () => {
    seed([{ id: 'p2', title: 'Initech', stage: 'saved' }]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Advance'));
    expect(movePipelineStage).toHaveBeenCalledWith('p2', 'applied');
  });

  it('advances an interviewing opportunity to follow-up', async () => {
    seed([{ id: 'p3', title: 'Hooli', stage: 'interviewing' }]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Advance'));
    expect(movePipelineStage).toHaveBeenCalledWith('p3', 'follow-up');
  });

  it('keeps a follow-up opportunity at follow-up when advanced', async () => {
    seed([{ id: 'p4', title: 'Pied Piper', stage: 'follow-up' }]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Advance'));
    expect(movePipelineStage).toHaveBeenCalledWith('p4', 'follow-up');
  });

  it('renders every stage badge color variant', async () => {
    seed([
      { id: 'a', title: 'Applied Co', stage: 'applied' },
      { id: 'b', title: 'Interviewing Co', stage: 'interviewing' },
      { id: 'c', title: 'Follow Co', stage: 'follow-up' },
      { id: 'd', title: 'Saved Co', stage: 'saved' },
    ]);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Applied Co');
    expect(text).toContain('Saved Co');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Interview pipeline');
  });

  it('does not add when the title field is empty', async () => {
    const tree = await renderScreen();
    const addButton = pressablesWithText(tree, 'Add to pipeline')[0];
    expect(addButton.props.disabled).toBe(true);
    expect(upsertPipelineItem).not.toHaveBeenCalled();
  });

  it('keeps the title when upsertPipelineItem rejects', async () => {
    mockHandledRejection(upsertPipelineItem, 'save failed');
    const tree = await renderScreen();
    const input = tree.root.find((n) => String(n.type) === 'TextInput');
    act(() => input.props.onChangeText('Globex — Backend'));
    await act(async () => {
      pressByText(tree, 'Add to pipeline');
      await flushMicrotasks();
      await drainMockRejection(upsertPipelineItem);
    });
    expect(upsertPipelineItem).toHaveBeenCalledWith({ title: 'Globex — Backend', stage: 'saved' });
    expect(input.props.value).toBe('Globex — Backend');
  });

  it('survives movePipelineStage and deletePipelineItem rejections', async () => {
    mockHandledRejection(movePipelineStage, 'move failed');
    mockHandledRejection(deletePipelineItem, 'delete failed');
    seed([{ id: 'p1', title: 'Acme — Staff Engineer', stage: 'applied' }]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Advance');
      await flushMicrotasks();
      await drainMockRejection(movePipelineStage);
    });
    await act(async () => {
      pressByText(tree, 'Remove');
      await flushMicrotasks();
      await drainMockRejection(deletePipelineItem);
    });
    expect(movePipelineStage).toHaveBeenCalledWith('p1', 'interviewing');
    expect(deletePipelineItem).toHaveBeenCalledWith('p1');
    expect(allText(tree.toJSON())).toContain('Acme — Staff Engineer');
  });
});
