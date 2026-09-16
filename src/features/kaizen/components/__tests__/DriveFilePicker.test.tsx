/**
 * DriveFilePicker — Symply Kaizen Google Drive wrapper around CloudFilePicker.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { fixture, pickerAsset } from '../../../../test-utils/fixtures';
import { DriveFilePicker } from '../DriveFilePicker';

// Real resume PDF from resourses/testing (see e2e/fixtures/manifest.json).
const RESUME = fixture('kaizen-resume');
const RESUME_ASSET = pickerAsset('kaizen-resume');

const mockOnFileSelected = jest.fn();
const mockOnClose = jest.fn();

jest.mock('@components/cloud-storage', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: (props: Record<string, unknown>) =>
      R.createElement(View, { testID: 'cloud-file-picker', ...props }),
  };
});

function renderPicker(visible: boolean) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <DriveFilePicker
          visible={visible}
          onClose={mockOnClose}
          onFileSelected={mockOnFileSelected}
          rememberScope="kaizen-resume"
        />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('DriveFilePicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards rememberScope and allowAllFileTypes to CloudFilePicker', () => {
    const tree = renderPicker(true);
    const picker = tree.root.findByProps({ testID: 'cloud-file-picker' });
    expect(picker.props.rememberScope).toBe('kaizen-resume');
    expect(picker.props.allowAllFileTypes).toBe(true);
    expect(picker.props.provider).toBe('google-drive');
  });

  it('maps downloaded files to the donor mimeType shape', () => {
    const tree = renderPicker(true);
    const picker = tree.root.findByProps({ testID: 'cloud-file-picker' });
    act(() => {
      picker.props.onFileSelected({ uri: RESUME.uri, name: RESUME.name, size: RESUME_ASSET.size });
    });
    expect(mockOnFileSelected).toHaveBeenCalledWith({
      uri: RESUME.uri,
      name: RESUME.name, // resume.pdf
      size: RESUME_ASSET.size, // real byte size on disk
      mime: 'application/pdf',
      mimeType: 'application/pdf',
    });
  });

  it('passes visible=false through to CloudFilePicker', () => {
    const tree = renderPicker(false);
    const picker = tree.root.findByProps({ testID: 'cloud-file-picker' });
    expect(picker.props.visible).toBe(false);
  });
});
