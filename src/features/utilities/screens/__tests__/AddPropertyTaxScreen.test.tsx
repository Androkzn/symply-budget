/**
 * AddPropertyTaxScreen — smoke test. Verifies the import screen mounts and
 * renders its structure: the four source tiles (incl. Google Drive), the review
 * form fields, the Home Owner Grant + Paid/Unpaid toggles, and the submit CTA.
 * Guards against crash-on-mount and structural drift; the money/validation
 * logic is covered by propertyTaxFormUtils.test.ts.
 */
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// AppBackground transitively imports the whole navigation/sidebar tree; stub the
// two @components/common pieces this screen uses so the smoke test stays light.
// AppBackground just passes its children through (no host wrapper needed).
jest.mock('@components/common', () => ({
  __esModule: true,
  AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
  ScreenHeader: () => null,
  ProcessingOverlay: () => null,
}));

// CloudFilePicker pulls in the cloud-storage providers (Google Drive / Dropbox);
// stub it — the screen only renders it as a hidden modal at rest.
jest.mock('@components/cloud-storage', () => ({ CloudFilePicker: () => null }));

jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: jest.fn(), openPicker: jest.fn() },
}));

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('@features/utilities/api/utilities', () => ({
  utilitiesApi: {
    uploadAndExtractPropertyTax: jest.fn(),
    createPropertyTax: jest.fn(),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import { AddPropertyTaxScreen } from '../AddPropertyTaxScreen';

let tree: ReactTestRenderer.ReactTestRenderer;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function renderScreen() {
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AddPropertyTaxScreen />
      </ThemeProvider>
    );
  });
  await flush();
  return tree;
}

afterEach(async () => {
  await act(async () => {
    try {
      tree?.unmount();
    } catch {
      /* already unmounted */
    }
  });
});

describe('AddPropertyTaxScreen', () => {
  it('mounts and renders the four import sources', async () => {
    await renderScreen();
    const text = collectRenderedText(tree);
    expect(text).toContain('Scan or Upload Notice');
    expect(text).toEqual(expect.arrayContaining(['Take Photo', 'Gallery', 'Upload File', 'Google Drive']));
  });

  it('renders the review form fields and CTAs', async () => {
    await renderScreen();
    const text = collectRenderedText(tree);
    // Required + optional fields.
    expect(text).toEqual(
      expect.arrayContaining(['Tax Year *', 'Total Amount Due (No Grant) *', 'Due Date *', 'Assessed Value'])
    );
    // Home Owner Grant + Payment Status toggles.
    expect(text).toEqual(expect.arrayContaining(['Home Owner Grant', 'Eligible', 'Not eligible']));
    expect(text).toEqual(expect.arrayContaining(['Payment Status', 'Unpaid', 'Paid']));
    // Submit CTA.
    expect(text).toContain('Add Property Tax');
  });
});
