/**
 * KaizenFileUploadScreen — interaction + import/API contract.
 *
 * Covers source selection → Save to Kaizen → importFile store/handler, and
 * Alert OK → router.back. Panel sources are exercised via the real panel with
 * DocumentPicker mocked.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
import { router } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { fixture } from '../../../../test-utils/fixtures';
import { allText, pressByA11yLabel, pressByText } from '../../test-utils/kaizenScreenTestKit';
import { KaizenFileUploadScreen } from '../KaizenFileUploadScreen';

// Real resume PDF from resourses/testing (see e2e/fixtures/manifest.json).
const RESUME = fixture('kaizen-resume');

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({
    scope: 'resume',
    purpose: 'resume',
    title: 'Upload resume',
  }),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
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

jest.mock('expo-document-picker', () => {
   
  const { pickerAsset } = require('../../../../test-utils/fixtures');
  return {
    __esModule: true,
    getDocumentAsync: jest.fn().mockResolvedValue({
      canceled: false,
      assets: [pickerAsset('kaizen-resume')],
    }),
  };
});

jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openCamera: jest.fn(),
    openPicker: jest.fn(),
  },
}));

const mockImportFile = jest.fn().mockResolvedValue({ message: 'Resume saved' });
jest.mock('@features/kaizen/upload/useKaizenFileImport', () => ({
  __esModule: true,
  resolveImportPurpose: (p: string) => p,
  useKaizenFileImport: () => ({
    importFile: (...args: unknown[]) => mockImportFile(...args),
    busy: false,
  }),
}));

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <KaizenFileUploadScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('KaizenFileUploadScreen', () => {
  it('renders upload title and four source options', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Upload resume');
    expect(text).toContain('Take Photo');
    expect(text).toContain('Gallery');
    expect(text).toContain('Upload File');
    expect(text).toContain('Google Drive');
  });

  it('selects a device file then Save to Kaizen calls importFile', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Upload File');
      await Promise.resolve();
    });
    expect(allText(tree.toJSON())).toContain(`Ready: ${RESUME.name}`);

    await act(async () => {
      pressByText(tree, 'Save to Kaizen');
      await Promise.resolve();
    });

    expect(mockImportFile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: RESUME.name, // resume.pdf
        uri: RESUME.uri, // file://…/resourses/testing/Kaizen app - Resume.pdf
        mime: 'application/pdf',
      }),
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Saved',
      'Resume saved',
      expect.any(Array),
    );

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    act(() => buttons.find((b) => b.text === 'OK')?.onPress?.());
    expect(router.back).toHaveBeenCalled();
  });

  it('does not show Save until a file is selected', async () => {
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).not.toContain('Save to Kaizen');
    expect(mockImportFile).not.toHaveBeenCalled();
  });

  it('does not alert or navigate when importFile returns null', async () => {
    mockImportFile.mockResolvedValueOnce(null);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Upload File');
      await Promise.resolve();
    });
    await act(async () => {
      pressByText(tree, 'Save to Kaizen');
      await Promise.resolve();
    });
    expect(mockImportFile).toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('clears the selected file from the panel', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Upload File');
      await Promise.resolve();
    });
    expect(allText(tree.toJSON())).toContain(`Ready: ${RESUME.name}`);
    act(() => pressByA11yLabel(tree, 'Clear file'));
    expect(allText(tree.toJSON())).not.toContain('Save to Kaizen');
  });
});
