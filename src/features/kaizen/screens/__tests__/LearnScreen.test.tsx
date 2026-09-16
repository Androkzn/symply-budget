/**
 * LearnScreen — Symply Kaizen (`symply-kaizen`) knowledge + GTD capture.
 *
 * Renders the REAL screen through <ThemeProvider>, asserts the capture card and
 * PARA / GTD sections, and drives capture entry → "Add" → addGtdItem. The extended
 * suite exercises knowledge capture, PARA pills, the populated knowledge + GTD lists,
 * every GTD status advance, and the in-flight "Adding" state.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPHONE,
  allText,
  drainMockRejection,
  instanceText,
  mockHandledRejection,
  pressByText,
  pressablesWithText,
} from '../../test-utils/kaizenScreenTestKit';
import { LearnScreen } from '../LearnScreen';

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

const mockGtdState = { gtd: [] as unknown[] };
const mockInvalidateGtd = jest.fn().mockResolvedValue(undefined);

jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: 'u1' } };
    return selector ? selector(state) : state;
  },
}));

jest.mock('@features/kaizen/hooks/useKaizenGtd', () => ({
  __esModule: true,
  useKaizenGtd: () => ({ data: mockGtdState.gtd }),
  useInvalidateKaizenGtd: () => mockInvalidateGtd,
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const A = () => jest.fn().mockResolvedValue(undefined);
  const state = {
    knowledge: [],
    addGtdItem: A(),
    addKnowledgeItem: A(),
    updateGtdStatus: A(),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

const textInputs = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => String(n.type) === 'TextInput');

/**
 * Press the knowledge-section "Add" affordance. Several pressables contain the
 * substring "Add" (the disabled capture button, the "Add a deep work block" link),
 * so match the enabled control whose full label is exactly "Add".
 */
const pressKnowledgeAdd = (tree: ReactTestRenderer.ReactTestRenderer) => {
  const target = pressablesWithText(tree, 'Add').find(
    (n) => instanceText(n) === 'Add' && n.props.disabled !== true,
  );
  if (!target) throw new Error('No enabled knowledge "Add" button found');
  target.props.onPress();
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LearnScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  state.knowledge = [];
  mockGtdState.gtd = [];
  state.addGtdItem.mockResolvedValue(undefined);
  state.addKnowledgeItem.mockResolvedValue(undefined);
  state.updateGtdStatus.mockResolvedValue(undefined);
  mockInvalidateGtd.mockResolvedValue(undefined);
});

describe('LearnScreen', () => {
  it('renders the capture card and the knowledge / GTD sections', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Learn');
    expect(text).toContain('CAPTURE');
    expect(text).toContain('Knowledge');
    expect(text).toContain('GTD inbox');
  });

  it('captures a new open loop into the GTD inbox', async () => {
    const tree = await renderScreen();
    // The capture field is the first TextInput on the screen.
    act(() => textInputs(tree)[0].props.onChangeText('Follow up with recruiter'));
    await act(async () => {
      pressByText(tree, 'Add');
    });
    expect(state.addGtdItem).toHaveBeenCalledWith('Follow up with recruiter');
  });

  it('captures an open loop from the keyboard submit action', async () => {
    const tree = await renderScreen();
    act(() => textInputs(tree)[0].props.onChangeText('Email the hiring manager'));
    await act(async () => {
      textInputs(tree)[0].props.onSubmitEditing();
    });
    expect(state.addGtdItem).toHaveBeenCalledWith('Email the hiring manager');
  });

  it('ignores a blank capture entry', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Add');
    });
    expect(state.addGtdItem).not.toHaveBeenCalled();
  });

  it('shows the in-flight "Adding" state while a capture is saving', async () => {
    let resolveAdd!: () => void;
    state.addGtdItem.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveAdd = resolve;
      }),
    );
    const tree = await renderScreen();
    act(() => textInputs(tree)[0].props.onChangeText('Slow save'));
    act(() => pressByText(tree, 'Add'));
    expect(allText(tree.toJSON())).toContain('Adding');
    await act(async () => {
      resolveAdd();
    });
  });

  it('adds a knowledge item with a selected PARA type, notes and tags', async () => {
    const tree = await renderScreen();
    const inputs = textInputs(tree);
    act(() => inputs[1].props.onChangeText('Spaced repetition'));
    act(() => inputs[2].props.onChangeText('Review at increasing intervals'));
    act(() => inputs[3].props.onChangeText('learning,memory'));
    act(() => pressByText(tree, 'areas')); // switch PARA type off the default "projects"
    await act(async () => {
      pressKnowledgeAdd(tree);
    });
    expect(state.addKnowledgeItem).toHaveBeenCalledWith(
      'Spaced repetition',
      'areas',
      'Review at increasing intervals',
      'learning,memory',
    );
  });

  it('ignores a knowledge item with a blank title', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressKnowledgeAdd(tree);
    });
    expect(state.addKnowledgeItem).not.toHaveBeenCalled();
  });

  it('renders the populated knowledge library (with and without tags)', async () => {
    state.knowledge = [
      { id: 'k1', title: 'Tagged note', para_type: 'resources', tags: 'ai,ml' },
      { id: 'k2', title: 'Untagged note', para_type: 'projects', tags: '' },
    ];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Tagged note');
    expect(text).toContain('ai,ml');
    expect(text).toContain('Untagged note');
  });

  it('advances GTD items through every status', async () => {
    mockGtdState.gtd = [
      { id: 'g1', status: 'inbox', title: 'InboxTask' },
      { id: 'g2', status: 'next', title: 'NextTask' },
      { id: 'g3', status: 'waiting', title: 'WaitingTask' },
      { id: 'g4', status: 'done', title: 'DoneTask' },
    ];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('InboxTask');
    expect(text).toContain('NextTask');
    expect(text).toContain('WaitingTask');
    expect(text).toContain('DoneTask');

    await act(async () => pressByText(tree, 'InboxTask'));
    expect(state.updateGtdStatus).toHaveBeenCalledWith('g1', 'next');
    await act(async () => pressByText(tree, 'NextTask'));
    expect(state.updateGtdStatus).toHaveBeenCalledWith('g2', 'waiting');
    await act(async () => pressByText(tree, 'WaitingTask'));
    expect(state.updateGtdStatus).toHaveBeenCalledWith('g3', 'done');
    await act(async () => pressByText(tree, 'DoneTask'));
    expect(state.updateGtdStatus).toHaveBeenCalledWith('g4', 'inbox');
  });

  it('links out to the deep-work planner', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Add a deep work block'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/deep-work');
  });

  it('recovers the capture form when addGtdItem rejects', async () => {
    mockHandledRejection(state.addGtdItem);
    const tree = await renderScreen();
    act(() => textInputs(tree)[0].props.onChangeText('Retry later'));
    await act(async () => {
      pressByText(tree, 'Add');
    });
    await drainMockRejection(state.addGtdItem);
    expect(state.addGtdItem).toHaveBeenCalledWith('Retry later');
    expect(allText(tree.toJSON())).not.toContain('Adding');
    expect(textInputs(tree)[0].props.value).toBe('Retry later');
  });

  it('keeps knowledge fields when addKnowledgeItem rejects', async () => {
    mockHandledRejection(state.addKnowledgeItem);
    const tree = await renderScreen();
    const inputs = textInputs(tree);
    act(() => inputs[1].props.onChangeText('Atomic habits'));
    act(() => inputs[2].props.onChangeText('Notes stay'));
    await act(async () => {
      pressKnowledgeAdd(tree);
    });
    await drainMockRejection(state.addKnowledgeItem);
    expect(state.addKnowledgeItem).toHaveBeenCalled();
    expect(inputs[1].props.value).toBe('Atomic habits');
    expect(inputs[2].props.value).toBe('Notes stay');
  });

  it('still calls updateGtdStatus when the store rejects', async () => {
    mockHandledRejection(state.updateGtdStatus);
    mockGtdState.gtd = [{ id: 'g1', status: 'inbox', title: 'FailTask' }];
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'FailTask');
    });
    await drainMockRejection(state.updateGtdStatus);
    expect(state.updateGtdStatus).toHaveBeenCalledWith('g1', 'next');
  });

  it('shows empty knowledge and GTD section states', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Your PARA knowledge library is empty.');
    expect(text).toContain('No items in your inbox.');
    expect(text).toContain('No next items.');
    expect(text).toContain('0 in inbox · 0 knowledge items');
  });

  it('adds knowledge with every PARA type pill', async () => {
    const tree = await renderScreen();
    const inputs = textInputs(tree);
    for (const type of ['projects', 'areas', 'resources', 'archives'] as const) {
      jest.clearAllMocks();
      act(() => inputs[1].props.onChangeText(`Note for ${type}`));
      act(() => pressByText(tree, type));
      await act(async () => pressKnowledgeAdd(tree));
      expect(state.addKnowledgeItem).toHaveBeenCalledWith(
        `Note for ${type}`,
        type,
        '',
        '',
      );
    }
  });
});
