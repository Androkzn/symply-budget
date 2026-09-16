/**
 * MortgageEditScreen — edits a property's editable fields. This suite verifies
 * it PREFILLS from `mortgageApi.get` (raw address + home value), SAVES the
 * changed shape via `mortgageApi.update` (nulling empty optionals, dollars →
 * cents) and DELETES the property through the confirm alert (clearing the
 * selection when it was active). Nav + `@components/common` are stubbed; real UI
 * renders under ThemeProvider.
 */

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(View, { testID: 'screen-header', onPress: onBackPress }),
    screenScrollViewStyle: { scroll: {} },
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { mortgageId: 'm-1' } }),
}));

const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    get: (...a: unknown[]) => mockGet(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    remove: (...a: unknown[]) => mockRemove(...a),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-1' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

const mockSetSelected = jest.fn();
const mockMarkDirty = jest.fn();
let mockSelectedId: string | null = 'm-1';
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedMortgageId: mockSelectedId,
      setSelectedMortgage: mockSetSelected,
      markDirty: mockMarkDirty,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageEditScreen } from '../MortgageEditScreen';

const RECORD = {
  id: 'm-1',
  household_id: 'hh-1',
  nickname: 'Main home',
  lender: 'TD',
  product_type: 'standard',
  property_address: '123 King St',
  mortgage_number_last4: null,
  original_price_cents: null,
  down_payment_cents: null,
  original_principal_cents: 50_000_000,
  original_amortization_months: 300,
  start_date: '2025-01-01',
  current_home_value_cents: 75_000_000,
  insurance_premium_cents: null,
  is_active: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageEditScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedId = 'm-1';
  mockGet.mockResolvedValue(RECORD);
  mockUpdate.mockResolvedValue(RECORD);
  mockRemove.mockResolvedValue(undefined);
});

describe('MortgageEditScreen', () => {
  it('prefills the editable fields from the full record', async () => {
    const tree = await render();
    expect(mockGet).toHaveBeenCalledWith('hh-1', 'm-1');
    const nickname = tree.root.findByProps({ testID: 'mortgage-edit-nickname' });
    const address = tree.root.findByProps({ testID: 'mortgage-edit-address' });
    const homeValue = tree.root.findByProps({ testID: 'mortgage-edit-home-value' });
    const lenderValue = tree.root.findByProps({ testID: 'mortgage-edit-lender-value' });
    expect(nickname.props.value).toBe('Main home');
    expect(address.props.value).toBe('123 King St');
    expect(homeValue.props.value).toBe('750000'); // cents → whole dollars
    expect(lenderValue.props.children).toBe('TD'); // lender picker prefilled from record
  });

  it('saves the changed shape (dollars → cents, empty optional → null)', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-edit-nickname' }).props.onChangeText('Cottage');
      tree.root.findByProps({ testID: 'mortgage-edit-lender-clear' }).props.onPress(); // clear the lender picker
      tree.root.findByProps({ testID: 'mortgage-edit-home-value' }).props.onChangeText('800000');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-edit-save' }).props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledWith('hh-1', 'm-1', {
      nickname: 'Cottage',
      lender: null,
      propertyAddress: '123 King St',
      currentHomeValueCents: 80_000_000,
      isActive: true,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('deletes the property through the confirm alert and clears the active selection', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(((_t, _m, buttons?: Array<{ style?: string; onPress?: () => void }>) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    }) as typeof Alert.alert);

    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-edit-delete' }).props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(mockRemove).toHaveBeenCalledWith('hh-1', 'm-1');
    expect(mockSetSelected).toHaveBeenCalledWith(null);
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
