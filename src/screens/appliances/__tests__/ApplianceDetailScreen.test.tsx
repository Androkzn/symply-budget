/**
 * `ApplianceDetailScreen` — the first caller of `HouseAttachmentField` anywhere
 * in `src/`.
 *
 * What is worth testing here is not layout, it is the four promises this screen
 * makes about the H6 attachment contract:
 *
 *  1. **The descriptor reaches the ledger.** `HouseAttachmentField` seals and
 *     uploads and then hands back a `HouseBlobDescriptor`; the HOST is what
 *     persists it. A screen that dropped it would leave the row naming an R2
 *     object no peer's Worker ever wrote — Budget's `localWishMedia.ts` bug.
 *  2. **The field is a COMPOSER, not the record.** It is single-valued and an
 *     appliance has many documents, so its `value` stays null and the written
 *     row appears in the list below. Showing it in both places would leave the
 *     member unable to tell which one the appliance actually has.
 *  3. **A failed persist deletes the bytes.** An upload that succeeded with no
 *     row is quota the member pays for forever and can never reach.
 *  4. **The attachment UI is gated on `isHouseLocalFirst()`**, because on a
 *     server-backed build the blob channel is not the storage path — but the
 *     documents are still LISTED, because reading them is not what differs.
 *
 * The blob components are mocked to their contract rather than rendered: the
 * real `HouseAttachmentField` drives a document picker and the real
 * `HouseBlobImage` drives `expo-image` plus a decrypting fetch, neither of which
 * this screen owns. Its own two tests cover them.
 *
 * All imports are static — `await import()` throws "dynamic import callback was
 * invoked without --experimental-vm-modules" under this Jest config.
 */
const mockGoBack = jest.fn();
const mockSetParams = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined = {};

jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn(), setParams: mockSetParams }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@components/common', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(View, null, children ?? null),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(View, null, children ?? null),
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      ReactModule.createElement(TouchableOpacity, {
        onPress: onBackPress,
        testID: 'nav-back-button',
        accessibilityLabel: title,
      }),
  };
});

/**
 * The attachment field, reduced to its contract: a button that hands the host a
 * descriptor, exactly as the real component does after a successful upload. Its
 * `value` prop is captured so the "composer, not record" claim is checkable.
 */
let mockAttachmentValue: unknown = 'never-rendered';
jest.mock('@components/house-v2/HouseAttachmentField', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    HouseAttachmentField: (props: {
      value?: unknown;
      onChange: (next: unknown) => void;
      label?: string;
    }) => {
      mockAttachmentValue = props.value;
      return ReactModule.createElement(TouchableOpacity, {
        testID: 'stub-attach',
        accessibilityLabel: props.label,
        onPress: () => props.onChange(mockDescriptor),
      });
    },
  };
});

jest.mock('@components/house-v2/HouseBlobImage', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    HouseBlobImage: (props: { testID?: string }) =>
      ReactModule.createElement(View, { testID: props.testID }),
  };
});

const mockDeleteHouseBlob = jest.fn();
jest.mock('@features/house/local/blobs', () => ({
  __esModule: true,
  BLOB_MAX_PLAINTEXT_BYTES: 64 * 1024 * 1024,
  deleteHouseBlob: (...args: unknown[]) => mockDeleteHouseBlob(...args),
}));

const mockIsHouseLocalFirst = jest.fn();
jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockIsHouseLocalFirst(),
}));

const mockGet = jest.fn();
const mockCreate = jest.fn();
const mockGetDocuments = jest.fn();
const mockAddDocument = jest.fn();
jest.mock('@api/appliances', () => ({
  __esModule: true,
  APPLIANCE_CATEGORIES: [
    { id: 'hvac', label: 'HVAC', icon: 'snow' },
    { id: 'kitchen', label: 'Kitchen', icon: 'restaurant' },
  ],
  appliancesApi: {
    get: (...args: unknown[]) => mockGet(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    getDocuments: (...args: unknown[]) => mockGetDocuments(...args),
    addDocument: (...args: unknown[]) => mockAddDocument(...args),
  },
}));

jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (selector: (state: unknown) => unknown) =>
    selector({ currentHousehold: { id: 'hh-active' } }),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { ApplianceDetailScreen } from '../ApplianceDetailScreen';

const mockDescriptor = {
  blobId: 'blb_receipt',
  mime: 'application/pdf',
  bytes: 51_200,
  sha256: 'a'.repeat(64),
  chunkCount: 1,
  keyEpoch: 1,
};

const IMAGE_DESCRIPTOR = { ...mockDescriptor, blobId: 'blb_plate', mime: 'image/jpeg' };

const FURNACE = {
  id: 'app_furnace',
  household_id: 'hh-maple',
  name: 'Furnace',
  category: 'hvac',
  type: 'Furnace',
  brand: 'Lennox',
  serial_number: 'LX-9910',
  total_maintenance_cost: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ApplianceDetailScreen />
      </ThemeProvider>,
    );
  });
  await flush();
  return tree;
}

const query = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id, { deep: false })[0] ?? null;

const find = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.find((node) => node.props?.testID === id);

async function press(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  await act(async () => {
    find(tree, id).props.onPress?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAttachmentValue = 'never-rendered';
  mockRouteParams = { applianceId: 'app_furnace', householdId: 'hh-maple' };
  mockIsHouseLocalFirst.mockReturnValue(true);
  mockGet.mockResolvedValue({ appliance: FURNACE });
  mockGetDocuments.mockResolvedValue({ documents: [] });
  mockDeleteHouseBlob.mockResolvedValue(undefined);
});

describe('the appliance itself', () => {
  it('reads the appliance the route names, not the active property', async () => {
    const tree = await renderScreen();
    expect(mockGet).toHaveBeenCalledWith('hh-maple', 'app_furnace');
    expect(find(tree, 'appliance-detail-name').props.children).toBe('Furnace');
  });

  it('falls back to the active property when the route does not name one', async () => {
    mockRouteParams = { applianceId: 'app_furnace' };
    await renderScreen();
    expect(mockGet).toHaveBeenCalledWith('hh-active', 'app_furnace');
  });

  it('renders member-facing copy when the appliance cannot be read', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    const text = String(find(tree, 'appliance-detail-error').props.children);
    expect(text).toContain('could not open this appliance');
    // Never the raw throw.
    expect(text).not.toContain('boom');
  });

  it('still renders the appliance when its DOCUMENT list fails', async () => {
    // A partial failure must not cost the whole screen: on a server-backed
    // build this call can legitimately answer with nothing at all.
    mockGetDocuments.mockRejectedValue(new Error('nope'));
    const tree = await renderScreen();
    expect(find(tree, 'appliance-detail-name').props.children).toBe('Furnace');
    expect(query(tree, 'appliance-documents-empty')).toBeTruthy();
    expect(query(tree, 'appliance-detail-error')).toBeNull();
  });
});

describe('add mode — an attachment needs a row to hang on', () => {
  beforeEach(() => {
    mockRouteParams = undefined;
  });

  it('offers the create form and NO attachment field until the row exists', async () => {
    const tree = await renderScreen();
    expect(query(tree, 'appliance-name-input')).toBeTruthy();
    // The whole point: `addDocument` needs an `applianceId`, so there is nothing
    // to attach to yet and offering the field would be a dead end.
    expect(query(tree, 'stub-attach')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('creates the appliance and switches itself into detail mode', async () => {
    mockCreate.mockResolvedValue({ appliance: FURNACE });
    const tree = await renderScreen();

    await act(async () => {
      find(tree, 'appliance-name-input').props.onChangeText('Furnace');
    });
    await press(tree, 'appliance-save');

    expect(mockCreate).toHaveBeenCalledWith('hh-active', {
      name: 'Furnace',
      category: 'hvac',
      // `type` is required by the API and free text; the category label is the
      // honest fallback rather than an empty string.
      type: 'hvac',
      brand: undefined,
    });
    expect(mockSetParams).toHaveBeenCalledWith({
      applianceId: 'app_furnace',
      householdId: 'hh-active',
    });
    // …and the attachment field is now available, on the same screen.
    expect(query(tree, 'stub-attach')).toBeTruthy();
  });
});

describe('the attachment contract', () => {
  it('persists the DESCRIPTOR the field hands back, not a device path', async () => {
    mockAddDocument.mockResolvedValue({
      document: { id: 'adc_1', appliance_id: 'app_furnace', type: 'receipt', r2_key: 'k', uploaded_at: 'now', blob: mockDescriptor },
    });
    const tree = await renderScreen();

    await press(tree, 'stub-attach');

    expect(mockAddDocument).toHaveBeenCalledWith('hh-maple', 'app_furnace', {
      type: 'receipt',
      r2_key: mockDescriptor.blobId,
      blob: mockDescriptor,
    });
    // The written row is in the list, which is the record.
    expect(query(tree, 'appliance-document-adc_1')).toBeTruthy();
    expect(query(tree, 'appliance-documents-empty')).toBeNull();
  });

  it('keeps the field empty — it composes, it does not hold the record', async () => {
    mockAddDocument.mockResolvedValue({
      document: { id: 'adc_1', appliance_id: 'app_furnace', type: 'receipt', r2_key: 'k', uploaded_at: 'now' },
    });
    const tree = await renderScreen();
    expect(mockAttachmentValue).toBeNull();
    await press(tree, 'stub-attach');
    // Still null after a successful file: the document is in the list below and
    // showing it in both places would leave the member unable to tell which one
    // the appliance actually has.
    expect(mockAttachmentValue).toBeNull();
  });

  it('files under the type the MEMBER picked, never one guessed from the mime', async () => {
    mockAddDocument.mockResolvedValue({
      document: { id: 'adc_2', appliance_id: 'app_furnace', type: 'manual', r2_key: 'k', uploaded_at: 'now' },
    });
    const tree = await renderScreen();

    // A photograph of a paper receipt and a photograph of a serial plate are the
    // same bytes; only the member knows which is which, and no backend has an
    // edit route to correct a wrong guess.
    const manualChip = tree.root.find(
      (node) => node.props?.label === 'Manual' && typeof node.props?.onPress === 'function',
    );
    await act(async () => {
      manualChip.props.onPress();
    });
    await press(tree, 'stub-attach');

    expect(mockAddDocument).toHaveBeenCalledWith(
      'hh-maple',
      'app_furnace',
      expect.objectContaining({ type: 'manual' }),
    );
  });

  it('deletes the uploaded bytes when the ledger write fails', async () => {
    // The worst outcome available: the member is charged against the household's
    // attachment quota, forever, on every device, for a file nothing can open.
    mockAddDocument.mockRejectedValue(new Error('write failed'));
    const tree = await renderScreen();

    await press(tree, 'stub-attach');

    expect(mockDeleteHouseBlob).toHaveBeenCalledWith(mockDescriptor.blobId, 'hh-maple');
    expect(query(tree, 'appliance-document-error')).toBeTruthy();
    const message = String(find(tree, 'appliance-document-error-message').props.children);
    expect(message).toContain('could not file it against this appliance');
    // Never the raw throw — `houseBlobErrorCopy`'s default branch delegates to
    // `toMemberFacingError`, which never renders `err.message`.
    expect(message).not.toContain('write failed');
  });

  it('renders the NAMED H6 state, not a generic failure', async () => {
    // `houseBlobErrorCopy` matches on `code`, so a quota failure says "remove a
    // few attachments" rather than "we could not save that" — different
    // situations, different answers.
    mockAddDocument.mockRejectedValue(
      Object.assign(new Error('quota'), { code: 'blob_quota_exceeded', limitBytes: 1024 }),
    );
    const tree = await renderScreen();
    await press(tree, 'stub-attach');

    expect(String(find(tree, 'appliance-document-error-title').props.children)).toBe(
      'Attachment storage is full',
    );
    expect(String(find(tree, 'appliance-document-error-message').props.children)).toContain(
      'remove a few attachments',
    );
  });
});

describe('rendering what is already filed', () => {
  it('renders an IMAGE document through HouseBlobImage and a file as a row', async () => {
    mockGetDocuments.mockResolvedValue({
      documents: [
        { id: 'adc_img', appliance_id: 'app_furnace', type: 'photo', r2_key: 'lf-blob/blb_plate', uploaded_at: 'now', blob: IMAGE_DESCRIPTOR },
        { id: 'adc_pdf', appliance_id: 'app_furnace', type: 'receipt', r2_key: 'lf-blob/blb_receipt', uploaded_at: 'now', blob: mockDescriptor },
      ],
    });
    const tree = await renderScreen();

    // A descriptor is not a URL — the bytes are sealed in R2 and have to be
    // fetched, opened and hash-checked, which is `HouseBlobImage`'s whole job.
    expect(query(tree, 'appliance-document-image-adc_img')).toBeTruthy();
    // …and a PDF is a file row, not a broken image.
    expect(query(tree, 'appliance-document-image-adc_pdf')).toBeNull();
    expect(query(tree, 'appliance-document-adc_pdf')).toBeTruthy();
  });
});

describe('the local-first gate', () => {
  it('hides the attachment field off local-first and says why', async () => {
    mockIsHouseLocalFirst.mockReturnValue(false);
    mockGetDocuments.mockResolvedValue({
      documents: [
        { id: 'adc_old', appliance_id: 'app_furnace', type: 'manual', r2_key: 'manuals/x.pdf', uploaded_at: 'now' },
      ],
    });
    const tree = await renderScreen();

    expect(query(tree, 'stub-attach')).toBeNull();
    expect(query(tree, 'appliance-attachments-unavailable')).toBeTruthy();
    // Reading is not what differs — an existing document is still listed, and a
    // server-path row has no descriptor and renders as a file.
    expect(query(tree, 'appliance-document-adc_old')).toBeTruthy();
    expect(query(tree, 'appliance-document-image-adc_old')).toBeNull();
  });
});
