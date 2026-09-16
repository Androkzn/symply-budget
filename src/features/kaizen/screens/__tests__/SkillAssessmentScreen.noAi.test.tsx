/**
 * SkillAssessmentScreen — the NO-AI placement path (`symply-kaizen`).
 *
 * The sibling suite covers the entitled adaptive loop; `jest.setup.js` mocks
 * `useAIEntitlement` to `canUseAI: true` globally, so this file overrides that
 * mock to `false` and pins the free-member experience:
 *
 *   - placement still works end to end (a core feature, never AI-gated),
 *   - NOTHING is sent to the model — no `postKaizenAI` call is made,
 *   - the screen does not silently score answers by character count, and
 *   - the unlock hub is offered as an upgrade, not as a wall.
 *
 * The real `services/skillAssessment` is used here (not stubbed) so the manual
 * result that reaches the store is the one the service actually builds.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPHONE,
  allText,
  pressByText,
  typeIn,
} from '../../test-utils/kaizenScreenTestKit';
import { SkillAssessmentScreen } from '../SkillAssessmentScreen';

const mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ skillId: 's1' }),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

// Override the global jest.setup mock: this member has neither PRO nor a key.
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => ({
    canUseAI: false,
    isPaid: false,
    isLoading: false,
    aiFeaturesEnabled: true,
    subscriptionsEnabled: true,
    bringYourOwnAIEnabled: true,
    denialReason: 'AI_ACCESS_REQUIRED',
    source: null,
    provider: null,
    selectedModelId: null,
    availableModels: [],
    byokConnections: [],
    hasBYOKAccess: false,
    refetch: jest.fn(),
    invalidate: jest.fn(),
  }),
}));

// The only AI egress point for this screen's service layer.
const mockPostKaizenAI = jest.fn();
jest.mock('@features/kaizen/api/kaizen', () => ({
  __esModule: true,
  postKaizenAI: (...args: unknown[]) => mockPostKaizenAI(...args),
}));

jest.mock('@features/kaizen/hooks/useKaizenSkills', () => ({
  __esModule: true,
  useKaizenSkills: () => ({ data: [{ id: 's1', name: 'System Design' }] }),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = { saveAssessmentResult: jest.fn().mockResolvedValue(undefined) };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

/** Fire onPress for a band row by testID (the composite Pressable, not its host View). */
function pressBand(tree: ReactTestRenderer.ReactTestRenderer, band: string): void {
  const match = tree.root.findAll(
    n => n.props?.testID === `kaizen-assessment-band-${band}` &&
      typeof n.props?.onPress === 'function',
  )[0];
  if (!match) throw new Error(`No band row for "${band}"`);
  match.props.onPress();
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SkillAssessmentScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  state.saveAssessmentResult.mockResolvedValue(undefined);
});

describe('SkillAssessmentScreen without AI access', () => {
  it('offers manual placement instead of the adaptive loop', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Place yourself');
    expect(text).toContain('System Design');
    // The AI-only affordances are gone.
    expect(text).not.toContain('Start assessment');
    expect(text).not.toContain('Submit answer');
  });

  it('saves a self-declared band and routes to the learning plan', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressBand(tree, 'advanced');
    });
    await act(async () => {
      pressByText(tree, 'Save placement');
    });

    expect(state.saveAssessmentResult).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: 's1', placedBand: 'advanced', questionCount: 0 }),
    );
    expect(router.replace).toHaveBeenCalledWith('/kaizen/learning-plan?skillId=s1');
  });

  it('never contacts the model on the manual path', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressBand(tree, 'foundation');
    });
    await act(async () => {
      pressByText(tree, 'Save placement');
    });
    expect(mockPostKaizenAI).not.toHaveBeenCalled();
  });

  it('carries typed focus areas into the saved placement', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressBand(tree, 'intermediate');
    });
    act(() => typeIn(tree, 'sharding, caching'));
    await act(async () => {
      pressByText(tree, 'Save placement');
    });
    expect(state.saveAssessmentResult).toHaveBeenCalledWith(
      expect.objectContaining({ gapConceptIds: ['sharding', 'caching'] }),
    );
  });

  it('will not save until a band is chosen', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Save placement');
    });
    expect(state.saveAssessmentResult).not.toHaveBeenCalled();
  });

  it('offers the unlock hub as an upgrade without blocking placement', async () => {
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Unlock AI for an adaptive assessment');
    await act(async () => {
      pressByText(tree, 'Unlock AI for an adaptive assessment');
    });
    expect(router.push).toHaveBeenCalledWith('/ai-access');
  });

  it('stays on the screen when the save fails', async () => {
    state.saveAssessmentResult.mockRejectedValueOnce(new Error('offline'));
    const tree = await renderScreen();
    await act(async () => {
      pressBand(tree, 'advanced');
    });
    await act(async () => {
      pressByText(tree, 'Save placement');
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(allText(tree.toJSON())).toContain('Place yourself');
  });
});
