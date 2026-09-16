/**
 * BudgetDataSharingScreen is a thin brand alias that re-exports the shared
 * ecosystem DataSharingScreen under the Budget stack's name. The test asserts
 * the alias resolves to the same component (so the Budget navigator mounts the
 * real screen), with the ecosystem module stubbed to keep the unit hermetic.
 */
jest.mock('@features/ecosystem', () => {
  const React = require('react');
  const { View } = require('react-native');
  const DataSharingScreen = () => React.createElement(View, { testID: 'ecosystem-data-sharing' });
  return { __esModule: true, DataSharingScreen };
});

import { DataSharingScreen } from '@features/ecosystem';

import { BudgetDataSharingScreen } from '../BudgetDataSharingScreen';

describe('BudgetDataSharingScreen', () => {
  it('re-exports the shared ecosystem DataSharingScreen', () => {
    expect(BudgetDataSharingScreen).toBe(DataSharingScreen);
    expect(typeof BudgetDataSharingScreen).toBe('function');
  });
});
