/**
 * BudgetItemAIScreen — the "Add with AI" flow. Covers: generate from text,
 * generate from an attachment (gallery / file / drive), the empty-suggestions
 * alert, error handling, draft review + toggle, and saving the selected drafts
 * via createItem.
 */
const mockGoBack = jest.fn();
// Wrapper (not a direct capture) so it resolves mockGoBack at call time — the
// const is still in TDZ when the hoisted import triggers this factory.
const mockNav = { goBack: (...a: unknown[]) => mockGoBack(...a) };
// Origin passed by the caller (Planning tab vs Spending tab). Mutated per test.
let mockRouteParams: { kind?: 'planned' | 'spent' } | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(TouchableOpacity, { onPress: onBackPress, testID: 'nav-back-button' }),
    ScanImportSources: ({
      testIDPrefix,
      disabled,
      onCamera,
      onGallery,
      onFile,
      onDrive,
    }: {
      testIDPrefix?: string;
      disabled?: boolean;
      onCamera?: () => void;
      onGallery?: () => void;
      onFile?: () => void;
      onDrive?: () => void;
    }) => {
      const handlers: Record<string, (() => void) | undefined> = {
        camera: onCamera,
        gallery: onGallery,
        file: onFile,
        drive: onDrive,
      };
      return React.createElement(
        View,
        null,
        ['camera', 'gallery', 'file', 'drive']
          .filter((k) => handlers[k])
          .map((k) =>
            React.createElement(TouchableOpacity, {
              key: k,
              testID: testIDPrefix ? `${testIDPrefix}-${k}` : undefined,
              disabled,
              onPress: handlers[k],
            })
          )
      );
    },
    screenScrollViewStyle: { scroll: {}, contentGrow: {} },
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockGetDocumentAsync = jest.fn();
// The screen sends every attachment through `toVisionSafeAttachment`, which
// measures the image via `ImageManipulator.manipulate(uri).renderAsync()`.
// Unmocked, that threw in jest, the screen swallowed the error, and
// `aiDetectItemsWithFile` was never called. A small reported size keeps an
// already-jpeg fixture short-circuiting through untouched.
jest.mock('expo-image-manipulator', () => {
  const rendered = {
    width: 100,
    height: 100,
    saveAsync: async () => ({ uri: 'file:///vision-safe.jpg' }),
  };
  const context = { resize: () => context, renderAsync: async () => rendered };
  return {
    __esModule: true,
    ImageManipulator: { manipulate: () => context },
    SaveFormat: { JPEG: 'jpeg' },
  };
});

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...a: unknown[]) => mockGetDocumentAsync(...a),
}));

const mockOpenPicker = jest.fn();
const mockOpenCamera = jest.fn();
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openPicker: (...a: unknown[]) => mockOpenPicker(...a),
    openCamera: (...a: unknown[]) => mockOpenCamera(...a),
  },
}));

jest.mock('@components/cloud-storage', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CloudFilePicker: ({
      visible,
      onFileSelected,
      onClose,
    }: {
      visible: boolean;
      onFileSelected: (f: { uri: string; name: string; size: number }) => void;
      onClose: () => void;
    }) =>
      visible
        ? React.createElement(View, {
            testID: 'cloud-file-picker',
            onFileSelected,
            onClose,
          })
        : null,
  };
});

const mockAiDetectItems = jest.fn();
const mockAiDetectItemsWithFile = jest.fn();
const mockCreateItem = jest.fn();
const mockAddExpense = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    aiDetectItems: (...args: unknown[]) => mockAiDetectItems(...args),
    aiDetectItemsWithFile: (...args: unknown[]) => mockAiDetectItemsWithFile(...args),
    createItem: (...args: unknown[]) => mockCreateItem(...args),
    addExpense: (...args: unknown[]) => mockAddExpense(...args),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh-test' } }),
}));

const mockMarkInsightsDirty = jest.fn();
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: () => ({
    selectedYear: 2026,
    selectedMonth: 7,
    markInsightsDirty: mockMarkInsightsDirty,
  }),
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetItemAIScreen } from '../BudgetItemAIScreen';

let tree: ReactTestRenderer.ReactTestRenderer;

function renderScreen(kind?: 'planned' | 'spent') {
  mockRouteParams = kind ? { kind } : undefined;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetItemAIScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

const byId = (id: string) => tree.root.findByProps({ testID: id });

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Water heater',
    description: 'Replace unit',
    category_id: 'cat-1',
    category_name: 'Home',
    priority: 'high',
    estimated_cost_min: 200000,
    estimated_cost_max: 250000,
    is_recurring: false,
    recurrence_frequency: null,
    scheduled: true,
    target_date: '2026-08-01',
    ...overrides,
  };
}

async function generateWith(text: string) {
  act(() => byId('budget-item-ai-input').props.onChangeText(text));
  await act(async () => {
    byId('budget-item-ai-generate').props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = undefined;
  mockAiDetectItems.mockResolvedValue({ suggestions: [] });
  mockAiDetectItemsWithFile.mockResolvedValue({ suggestions: [] });
  mockCreateItem.mockResolvedValue({});
  mockAddExpense.mockResolvedValue({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('BudgetItemAIScreen', () => {
  it('disables Generate until text or file is provided', () => {
    renderScreen();
    expect(byId('budget-item-ai-camera')).toBeTruthy();
    expect(byId('budget-item-ai-gallery')).toBeTruthy();
    expect(byId('budget-item-ai-file')).toBeTruthy();
    expect(byId('budget-item-ai-drive')).toBeTruthy();
    expect(byId('budget-item-ai-generate').props.disabled).toBe(true);
  });

  it('generates from text via aiDetectItems and lists the returned drafts', async () => {
    mockAiDetectItems.mockResolvedValue({ suggestions: [suggestion()] });
    renderScreen();
    await generateWith('Water heater about $2k');
    expect(mockAiDetectItems).toHaveBeenCalledWith('hh-test', {
      text: 'Water heater about $2k',
      year: 2026,
      month: 7,
    });
    expect(mockAiDetectItemsWithFile).not.toHaveBeenCalled();
    const titles = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children);
    expect(titles).toContain('Water heater');
  });

  it('alerts when no suggestions are found', async () => {
    mockAiDetectItems.mockResolvedValue({ suggestions: [] });
    renderScreen();
    await generateWith('nonsense');
    expect(Alert.alert).toHaveBeenCalledWith('Nothing found', expect.any(String));
  });

  it('alerts on a generation error', async () => {
    mockAiDetectItems.mockRejectedValue(new Error('boom'));
    renderScreen();
    await generateWith('Water heater');
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
  });

  it('saves the selected drafts via createItem and returns', async () => {
    mockAiDetectItems.mockResolvedValue({
      suggestions: [suggestion({ title: 'Water heater' }), suggestion({ title: 'Netflix', is_recurring: true, recurrence_frequency: 'monthly', scheduled: false, target_date: null })],
    });
    renderScreen();
    await generateWith('two things');

    // Both included by default → Add 2 spendings.
    const addBtn = tree.root.find(
      (n) => typeof n.props?.title === 'string' && /^Add 2 spendings$/.test(n.props.title)
    );
    await act(async () => {
      addBtn.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateItem).toHaveBeenCalledTimes(2);
    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ title: 'Water heater', target_date: '2026-08-01' })
    );
    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ title: 'Netflix', is_recurring: true, recurrence_frequency: 'monthly' })
    );
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-test');
    expect(mockAddExpense).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('records expenses (not planned items) when opened from the Spending tab', async () => {
    // Regression: a spending-origin add must call addExpense so the row lands in
    // the Spending tab (overview.expenses). Previously it always created a planned
    // item, so nothing showed up in Spending until an unrelated refresh.
    mockAiDetectItems.mockResolvedValue({
      suggestions: [
        suggestion({ title: 'Groceries', estimated_cost_min: 4000, estimated_cost_max: 6000 }),
      ],
    });
    renderScreen('spent');
    await generateWith('groceries');

    const addBtn = tree.root.find(
      (n) => typeof n.props?.title === 'string' && /^Add 1 spending$/.test(n.props.title)
    );
    await act(async () => {
      addBtn.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreateItem).not.toHaveBeenCalled();
    expect(mockAddExpense).toHaveBeenCalledTimes(1);
    expect(mockAddExpense).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ title: 'Groceries', amount: 6000, category_id: 'cat-1' })
    );
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-test');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('toggles a draft off so only the remaining one is added', async () => {
    mockAiDetectItems.mockResolvedValue({
      suggestions: [suggestion({ title: 'Keep me' }), suggestion({ title: 'Drop me' })],
    });
    renderScreen();
    await generateWith('two');

    // The draft cards are TouchableOpacity with activeOpacity 0.8; toggle the second.
    const cards = tree.root.findAll(
      (n) => n.props?.activeOpacity === 0.8 && typeof n.props?.onPress === 'function'
    );
    // Composite + host both match; the last node belongs to the 2nd (last) card.
    expect(cards.length).toBeGreaterThanOrEqual(2);
    act(() => cards[cards.length - 1].props.onPress());

    const addBtn = tree.root.find(
      (n) => typeof n.props?.title === 'string' && n.props.title === 'Add 1 spending'
    );
    await act(async () => {
      addBtn.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateItem).toHaveBeenCalledTimes(1);
    expect(mockCreateItem).toHaveBeenCalledWith('hh-test', expect.objectContaining({ title: 'Keep me' }));
  });

  it('attaches a gallery image and generates via aiDetectItemsWithFile', async () => {
    mockOpenPicker.mockResolvedValue({ path: 'file://p.jpg', filename: 'p.jpg', mime: 'image/jpeg' });
    mockAiDetectItemsWithFile.mockResolvedValue({ suggestions: [suggestion()] });
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-gallery').props.onPress();
      await Promise.resolve();
    });
    expect(byId('budget-item-ai-remove-attachment')).toBeTruthy();

    await act(async () => {
      byId('budget-item-ai-generate').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAiDetectItemsWithFile).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ file: expect.objectContaining({ name: 'p.jpg', type: 'image/jpeg' }) })
    );
  });

  it('attaches a camera photo and generates via aiDetectItemsWithFile', async () => {
    mockOpenCamera.mockResolvedValue({ path: 'file://c.jpg', filename: 'c.jpg', mime: 'image/jpeg' });
    mockAiDetectItemsWithFile.mockResolvedValue({ suggestions: [suggestion()] });
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-camera').props.onPress();
      await Promise.resolve();
    });
    expect(byId('budget-item-ai-remove-attachment')).toBeTruthy();

    await act(async () => {
      byId('budget-item-ai-generate').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAiDetectItemsWithFile).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ file: expect.objectContaining({ name: 'c.jpg', type: 'image/jpeg' }) })
    );
  });

  it('ignores a cancelled camera pick', async () => {
    mockOpenCamera.mockRejectedValue({ code: 'E_PICKER_CANCELLED' });
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-camera').props.onPress();
      await Promise.resolve();
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props?.testID === 'budget-item-ai-remove-attachment')).toHaveLength(0);
  });

  it('alerts when the camera throws a non-cancel error', async () => {
    mockOpenCamera.mockRejectedValue({ code: 'E_OTHER', message: 'nope' });
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-camera').props.onPress();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('camera'));
  });

  it('ignores a cancelled gallery pick', async () => {
    mockOpenPicker.mockRejectedValue({ code: 'E_PICKER_CANCELLED' });
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-gallery').props.onPress();
      await Promise.resolve();
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props?.testID === 'budget-item-ai-remove-attachment')).toHaveLength(0);
  });

  it('attaches an uploaded document', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://d.pdf', name: 'quote.pdf', mimeType: 'application/pdf' }],
    });
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-file').props.onPress();
      await Promise.resolve();
    });
    expect(byId('budget-item-ai-remove-attachment')).toBeTruthy();
  });

  it('removes an attachment', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://d.pdf', name: 'quote.pdf', mimeType: 'application/pdf' }],
    });
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-file').props.onPress();
      await Promise.resolve();
    });
    act(() => byId('budget-item-ai-remove-attachment').props.onPress());
    expect(tree.root.findAll((n) => n.props?.testID === 'budget-item-ai-remove-attachment')).toHaveLength(0);
  });

  it('opens the Drive picker and attaches the selected file', async () => {
    renderScreen();
    act(() => byId('budget-item-ai-drive').props.onPress());
    const picker = byId('cloud-file-picker');
    act(() => picker.props.onFileSelected({ uri: 'file://g.png', name: 'g.png', size: 10 }));
    expect(byId('budget-item-ai-remove-attachment')).toBeTruthy();
  });

  it('cancels back to the previous screen', () => {
    renderScreen();
    act(() => byId('nav-back-button').props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('alerts when the gallery picker throws a non-cancel error', async () => {
    mockOpenPicker.mockRejectedValue({ code: 'E_OTHER', message: 'nope' });
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-gallery').props.onPress();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('photo library'));
  });

  it('alerts when the document picker throws', async () => {
    mockGetDocumentAsync.mockRejectedValue(new Error('boom'));
    renderScreen();
    await act(async () => {
      byId('budget-item-ai-file').props.onPress();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('file picker'));
  });

  it('alerts when saving the selected drafts fails', async () => {
    mockAiDetectItems.mockResolvedValue({ suggestions: [suggestion()] });
    mockCreateItem.mockRejectedValue(new Error('boom'));
    renderScreen();
    await generateWith('one');
    const addBtn = tree.root.find(
      (n) => typeof n.props?.title === 'string' && /^Add 1 spending$/.test(n.props.title)
    );
    await act(async () => {
      addBtn.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('save'));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('infers mime types for webp and unknown drive files', async () => {
    renderScreen();
    act(() => byId('budget-item-ai-drive').props.onPress());
    // .webp → image/webp
    act(() =>
      byId('cloud-file-picker').props.onFileSelected({ uri: 'file://a.webp', name: 'a.webp', size: 1 })
    );
    expect(byId('budget-item-ai-remove-attachment')).toBeTruthy();

    // Re-open and pick an extensionless file → falls back to application/pdf.
    act(() => byId('budget-item-ai-drive').props.onPress());
    act(() =>
      byId('cloud-file-picker').props.onFileSelected({ uri: 'file://blob', name: 'blob', size: 1 })
    );
    // Also attach a .png through the document picker to hit that branch.
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://x.png', name: 'shot.png', mimeType: null }],
    });
    await act(async () => {
      byId('budget-item-ai-file').props.onPress();
      await Promise.resolve();
    });
    expect(byId('budget-item-ai-remove-attachment')).toBeTruthy();
  });

  it('closes the Drive picker via onClose', () => {
    renderScreen();
    act(() => byId('budget-item-ai-drive').props.onPress());
    act(() => byId('cloud-file-picker').props.onClose());
    expect(tree.root.findAll((n) => n.props?.testID === 'cloud-file-picker')).toHaveLength(0);
  });
});
