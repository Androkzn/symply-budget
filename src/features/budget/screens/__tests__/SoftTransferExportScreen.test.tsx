/**
 * SoftTransferExportScreen wraps SoftTransferFlowScreen for Budget → House.
 * Pins package id; mutation sequence is covered by runTransfer.mutation.test.ts
 * and smart-engine API path tests.
 */
const capturedProps: Array<Record<string, unknown>> = [];

jest.mock('@features/ecosystem', () => {
  const React = require('react');
  const { View } = require('react-native');
  const SoftTransferFlowScreen = (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return React.createElement(View, { testID: 'soft-transfer-flow' });
  };
  return { __esModule: true, SoftTransferFlowScreen };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { SoftTransferExportScreen } from '../SoftTransferExportScreen';

describe('SoftTransferExportScreen', () => {
  beforeEach(() => {
    capturedProps.length = 0;
  });

  it('renders the ecosystem flow pinned to the budget.summary export preset', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<SoftTransferExportScreen />);
    });

    expect(tree.root.findByProps({ testID: 'soft-transfer-flow' })).toBeTruthy();
    expect(capturedProps).toHaveLength(1);
    expect(capturedProps[0]).toMatchObject({
      title: 'Share a summary',
      preset: 'budget-to-house',
      fixedPackageId: 'budget.summary.v1',
    });
  });

  it('locks the export package id used by prepare/export (BUDGET-ST / PLAT-ST)', async () => {
    await act(async () => {
      ReactTestRenderer.create(<SoftTransferExportScreen />);
    });
    expect(capturedProps[capturedProps.length - 1]?.fixedPackageId).toBe(
      'budget.summary.v1'
    );
  });
});
