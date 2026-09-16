/**
 * KaizenMoreScreen — Symply Kaizen (`symply-kaizen`) "More" hub tab.
 *
 * Renders the REAL screen through <ThemeProvider>, asserts the three grouped
 * sections and their link rows, and drives a row press (→ router.push to the
 * mapped ecosystem route).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPAD,
  IPHONE,
  allText,
  pressByExactLabel,
  pressByText,
} from '../../test-utils/kaizenScreenTestKit';
import { KaizenMoreScreen } from '../KaizenMoreScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// The AI entry is the shared, gated useAIAccessEntry (identical across brands).
// Force it visible with canonical values so the screen renders the row.
jest.mock('@components/ai/useAIAccessEntry', () => ({
  useAIAccessEntry: () => ({
    show: true,
    route: '/ai-access',
    title: 'AI assistance',
    subtitle: 'Connect OpenAI, Claude, or Gemini',
    icon: 'sparkles-outline',
  }),
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

jest.mock('@components/cloud-storage', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: () => R.createElement(View, { testID: 'cloud-file-picker' }),
  };
});

jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));

jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: jest.fn(), openPicker: jest.fn() },
}));

jest.mock('@features/kaizen/upload/useKaizenFileImport', () => ({
  __esModule: true,
  resolveImportPurpose: (p: string) => p,
  useKaizenFileImport: () => ({
    importFile: jest.fn().mockResolvedValue({ message: 'ok' }),
    busy: false,
    lastFileName: null,
    clearLastFileName: jest.fn(),
  }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <KaizenMoreScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
});

describe('KaizenMoreScreen', () => {
  it('renders the grouped sections and their link rows', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('More');
    expect(text).toContain('Sections');
    expect(text).toContain('Question banks');
    expect(text).toContain('Settings');
    expect(text).toContain('Career tools');
    expect(text).toContain('Interview pipeline');
    expect(text).toContain('Systems & focus');
    expect(text).toContain('Deep work');
    expect(text).toContain('Guide');
  });

  it('pushes the Guide tab route when its row is pressed', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Guide'));
    expect(mockPush).toHaveBeenCalledWith('/mira');
  });

  it('pushes the mapped route when a section row is pressed', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Question banks'));
    expect(mockPush).toHaveBeenCalledWith('/kaizen/banks');
  });

  it('pushes a career tool route when its row is pressed', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Interview pipeline'));
    expect(mockPush).toHaveBeenCalledWith('/kaizen/pipeline');
  });

  it.each([
    ['Question banks', '/kaizen/banks'],
    ['Weekly reviews', '/kaizen/reviews'],
    ['Books', '/kaizen/books'],
    ['Insights', '/kaizen/insights'],
    ['AI assistance', '/ai-access'],
    ['Settings', '/kaizen/settings'],
    ['Question import', '/kaizen/question-import'],
    ['Interview pipeline', '/kaizen/pipeline'],
    ['Career progress', '/kaizen/career-progress'],
    ['Resume review', '/kaizen/resume-review'],
    ['Career setup', '/kaizen/career-setup'],
    ['Deep work', '/kaizen/deep-work'],
    ['Habit stacks', '/kaizen/habit-stacks'],
    ['Weekly rotations', '/kaizen/rotations'],
    ['Systems', '/kaizen-systems'],
    ['Guide', '/mira'],
    ['Coach memory', '/kaizen/memory'],
    ['Symply apps', '/symply-apps'],
  ] as const)('row "%s" pushes %s', async (label, href) => {
    const tree = await renderScreen();
    mockPush.mockClear();
    act(() => pressByExactLabel(tree, label));
    expect(mockPush).toHaveBeenCalledWith(href);
  });

  it.each([
    ['Resume review', '/kaizen/resume-review'],
    ['Import questions', '/kaizen/question-import'],
    ['Books', '/kaizen/books'],
  ] as const)('upload quick link "%s" pushes %s', async (label, href) => {
    const tree = await renderScreen();
    mockPush.mockClear();
    act(() => pressByExactLabel(tree, label));
    expect(mockPush).toHaveBeenCalledWith(href);
  });

  it('renders the upload & import section', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Upload & import');
    expect(text).toContain('Upload a file');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Sections');
  });
});
