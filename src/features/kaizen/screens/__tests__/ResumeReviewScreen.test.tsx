/**
 * ResumeReviewScreen — Symply Kaizen (`symply-kaizen`) AI resume review.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store, types resume
 * text into the field, drives "Review resume" (→ analyzeResume) and asserts the
 * returned summary / suggested roles / skills render.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { fixture } from '../../../../test-utils/fixtures';
import {
  IPAD,
  IPHONE,
  allText,
  drainMockRejection,
  flushMicrotasks,
  mockHandledRejection,
  pressByText,
} from '../../test-utils/kaizenScreenTestKit';
import { ResumeReviewScreen } from '../ResumeReviewScreen';

// Real resume PDF from resourses/testing — the upload section imports FROM this file.
const RESUME = fixture('kaizen-resume');
const UPLOADED_RESUME_TEXT = `Resume imported from ${RESUME.name}`;

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

jest.mock('@features/kaizen/upload/KaizenImportUploadSection', () => {
  const R = require('react');
  const { Pressable, Text, View } = require('react-native');
   
  const { fixture } = require('../../../../test-utils/fixtures');
  const resume = fixture('kaizen-resume'); // resume.pdf
  return {
    KaizenImportUploadSection: ({
      onImported,
    }: {
      onImported?: (result: { resumeText?: string; resumeSummary?: string }) => void;
    }) =>
      R.createElement(
        View,
        null,
        R.createElement(
          Pressable,
          {
            onPress: () =>
              onImported?.({
                resumeText: `Resume imported from ${resume.name}`,
                resumeSummary: `Summary drawn from ${resume.name}`,
              }),
          },
          R.createElement(Text, null, 'MockUploadFile'),
        ),
      ),
    importPanelConfig: jest.requireActual('@features/kaizen/upload/KaizenImportUploadSection')
      .importPanelConfig,
  };
});

const mockState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

const analyzeResume = jest.fn();
const addSkill = jest.fn().mockResolvedValue(undefined);
const saveCareerSetup = jest.fn().mockResolvedValue(undefined);

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ResumeReviewScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  analyzeResume.mockResolvedValue({
    summary: 'Senior engineer with distributed-systems depth.',
    suggested_skills: [{ name: 'System design' }, { name: 'Go' }],
    target_roles: ['Staff Engineer'],
  });
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, { analyzeResume, addSkill, saveCareerSetup });
});

describe('ResumeReviewScreen', () => {
  it('renders the title and resume field', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Resume review');
    expect(text).toContain('Your resume');
    expect(text).toContain('Review resume');
  });

  it('analyzes the pasted resume and renders the summary, roles and skills', async () => {
    const tree = await renderScreen();
    const input = tree.root.findAllByType(TextInput)[0];
    act(() => input.props.onChangeText('10 years building payment systems.'));
    await act(async () => {
      pressByText(tree, 'Review resume');
    });
    expect(analyzeResume).toHaveBeenCalledWith('10 years building payment systems.');
    const text = allText(tree.toJSON());
    expect(text).toContain('Senior engineer with distributed-systems depth.');
    expect(text).toContain('Staff Engineer');
    expect(text).toContain('System design');
  });

  it('applies the reviewed skills and roles to career setup', async () => {
    const tree = await renderScreen();
    const input = tree.root.findAllByType(TextInput)[0];
    act(() => input.props.onChangeText('Distributed systems for a decade.'));
    await act(async () => {
      pressByText(tree, 'Review resume');
    });
    await act(async () => {
      pressByText(tree, 'Apply skills & roles to career setup');
    });
    expect(addSkill).toHaveBeenCalledWith('System design');
    expect(addSkill).toHaveBeenCalledWith('Go');
    expect(saveCareerSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        targetRoles: ['Staff Engineer'],
        goalTypes: ['interview_prep'],
        resumeSummary: 'Senior engineer with distributed-systems depth.',
        step: 'complete',
      }),
    );
  });

  it('falls back to a default role and drops blank skills when the review omits roles', async () => {
    analyzeResume.mockResolvedValueOnce({
      summary: 'Backend engineer.',
      suggested_skills: [{ name: 'Go' }, { name: '' }],
      target_roles: [],
    });
    const tree = await renderScreen();
    const input = tree.root.findAllByType(TextInput)[0];
    act(() => input.props.onChangeText('Backend resume.'));
    await act(async () => {
      pressByText(tree, 'Review resume');
    });
    // Blank-named skill is filtered out — only "Go" survives.
    expect(allText(tree.toJSON())).toContain('Go');
    await act(async () => {
      pressByText(tree, 'Apply skills & roles to career setup');
    });
    expect(addSkill).toHaveBeenCalledTimes(1);
    expect(addSkill).toHaveBeenCalledWith('Go');
    expect(saveCareerSetup).toHaveBeenCalledWith(
      expect.objectContaining({ targetRoles: ['Software engineer'] }),
    );
  });

  it('shows the empty-summary fallback when the review returns nothing', async () => {
    analyzeResume.mockResolvedValueOnce({});
    const tree = await renderScreen();
    const input = tree.root.findAllByType(TextInput)[0];
    act(() => input.props.onChangeText('Sparse resume.'));
    await act(async () => {
      pressByText(tree, 'Review resume');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('No summary was returned.');
    expect(text).not.toContain('Apply skills & roles to career setup');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Resume review');
  });

  it('fills the resume field from the upload section and can review it', async () => {
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'MockUploadFile'));
    const input = tree.root.findAllByType(TextInput)[0];
    expect(input.props.value).toBe(UPLOADED_RESUME_TEXT);
    await act(async () => pressByText(tree, 'Review resume'));
    expect(analyzeResume).toHaveBeenCalledWith(UPLOADED_RESUME_TEXT);
  });

  it('stays on the review screen when analyzeResume rejects', async () => {
    mockHandledRejection(analyzeResume);
    const tree = await renderScreen();
    const input = tree.root.findAllByType(TextInput)[0];
    act(() => input.props.onChangeText('Resume that fails analysis.'));
    await act(async () => {
      pressByText(tree, 'Review resume');
      await flushMicrotasks();
      await drainMockRejection(analyzeResume);
    });
    expect(analyzeResume).toHaveBeenCalledWith('Resume that fails analysis.');
    const text = allText(tree.toJSON());
    expect(text).toContain('Resume review');
    expect(text).not.toContain('Apply skills & roles to career setup');
    expect(saveCareerSetup).not.toHaveBeenCalled();
  });

  it('does not persist career setup when apply actions reject', async () => {
    mockHandledRejection(addSkill, 'add failed');
    const tree = await renderScreen();
    const input = tree.root.findAllByType(TextInput)[0];
    act(() => input.props.onChangeText('Distributed systems for a decade.'));
    await act(async () => pressByText(tree, 'Review resume'));
    await act(async () => {
      pressByText(tree, 'Apply skills & roles to career setup');
      await flushMicrotasks();
      await drainMockRejection(addSkill);
    });
    expect(addSkill).toHaveBeenCalled();
    expect(allText(tree.toJSON())).toContain('Apply skills & roles to career setup');
    expect(saveCareerSetup).not.toHaveBeenCalled();
  });
});
