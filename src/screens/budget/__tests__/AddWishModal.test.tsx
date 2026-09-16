/**
 * AddWishModal — create/edit sheet, focused on the "add a photo while creating"
 * flow the user asked for. Native boundaries (picker, toast, expo-image) and the
 * wishes API are mocked; the real modal logic runs.
 */

const mockPickPhoto = jest.fn();
jest.mock('@services/photo-upload', () => ({
  PhotoUploadService: { pickPhoto: (...a: unknown[]) => mockPickPhoto(...a) },
}));
jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUploadImage = jest.fn();
const mockAddEntry = jest.fn();
jest.mock('@api/wishes', () => ({
  wishesApi: {
    create: (...a: unknown[]) => mockCreate(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    uploadImage: (...a: unknown[]) => mockUploadImage(...a),
    addEntry: (...a: unknown[]) => mockAddEntry(...a),
  },
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => React.createElement(View, props) };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { AddWishModal } from '../AddWishModal';

const HID = 'hh-1';
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function pressSave(tree: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => {
    tree.root.findByProps({ testID: 'wish-modal-save' }).props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
  await flush();
}

async function renderModal(onSaved = jest.fn(), onClose = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AddWishModal visible householdId={HID} onClose={onClose} onSaved={onSaved} />
      </ThemeProvider>
    );
  });
  await flush();
  renderers.push(tree);
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'w-new' });
  mockUpdate.mockResolvedValue({});
  mockUploadImage.mockResolvedValue('wishes/hh-1/w-new/cover.jpg');
  mockAddEntry.mockResolvedValue({ id: 'e1' });
});

afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()));
  renderers.length = 0;
});

it('creates a wish from e2e-wish-draft without empty blur wiping title', async () => {
  const { queueE2EWishDraftTitle, __resetE2EWishDraftForTests } =
    require('@services/e2e-wish-draft') as typeof import('@services/e2e-wish-draft');
  __resetE2EWishDraftForTests();
  queueE2EWishDraftTitle('E2E Wish');

  const onSaved = jest.fn();
  const onClose = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AddWishModal visible householdId={HID} onClose={onClose} onSaved={onSaved} />
      </ThemeProvider>
    );
  });
  await flush();
  renderers.push(tree);

  const titleInput = tree.root.findAll((n) => n.props?.placeholder === 'e.g. Buy a boat')[0];
  await act(async () => {
    titleInput.props.onEndEditing({ nativeEvent: { text: '' } });
    tree.root.findByProps({ testID: 'wish-modal-save' }).props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
  await flush();

  expect(mockCreate).toHaveBeenCalledWith(HID, expect.objectContaining({ title: 'E2E Wish' }));
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('creates a wish when Maestro only syncs native text on end editing', async () => {
  const onSaved = jest.fn();
  const tree = await renderModal(onSaved);
  const titleInput = tree.root.findAll((n) => n.props?.placeholder === 'e.g. Buy a boat')[0];

  await act(async () => {
    titleInput.props.onEndEditing({ nativeEvent: { text: 'E2E Wish' } });
  });
  await pressSave(tree);

  expect(mockCreate).toHaveBeenCalledWith(HID, expect.objectContaining({ title: 'E2E Wish' }));
  expect(onSaved).toHaveBeenCalled();
});

it('creates a wish and uploads the picked photo as its cover', async () => {
  mockPickPhoto.mockResolvedValueOnce({ uri: 'file:///truck.jpg', mimeType: 'image/jpeg' });
  const onSaved = jest.fn();
  const tree = await renderModal(onSaved);

  // Enter a title, pick a photo, then save.
  const titleInput = tree.root.findAll((n) => n.props?.placeholder === 'e.g. Buy a boat')[0];
  act(() => titleInput.props.onChangeText('Toyota Tundra'));
  await act(async () => {
    tree.root.findByProps({ testID: 'wish-modal-add-photo' }).props.onPress();
    await flush();
  });
  await pressSave(tree);
  expect(mockUploadImage).toHaveBeenCalledWith(HID, 'w-new', expect.objectContaining({ uri: 'file:///truck.jpg' }));
  expect(mockAddEntry).toHaveBeenCalledWith(
    HID,
    'w-new',
    expect.objectContaining({ kind: 'image', image_key: 'wishes/hh-1/w-new/cover.jpg' })
  );
  expect(mockUpdate).toHaveBeenCalledWith(HID, 'w-new', { cover_image_key: 'wishes/hh-1/w-new/cover.jpg' });
  expect(onSaved).toHaveBeenCalled();
});

it('creates a wish with no photo (no upload calls)', async () => {
  const tree = await renderModal();
  const titleInput = tree.root.findAll((n) => n.props?.placeholder === 'e.g. Buy a boat')[0];
  act(() => titleInput.props.onChangeText('A boat'));
  await pressSave(tree);

  expect(mockCreate).toHaveBeenCalledWith(HID, expect.objectContaining({ title: 'A boat' }));
  expect(mockUploadImage).not.toHaveBeenCalled();
});

it('ignores malformed price input instead of sending NaN cents (BUDGET-WISH-027)', async () => {
  const tree = await renderModal();
  const titleInput = tree.root.findAll((n) => n.props?.placeholder === 'e.g. Buy a boat')[0];
  act(() => titleInput.props.onChangeText('Mystery gift'));
  const costInput = tree.root.findAll((n) => n.props?.placeholder === '0')[0];
  act(() => costInput.props.onChangeText('not-a-price'));
  await pressSave(tree);

  expect(mockCreate).toHaveBeenCalledWith(
    HID,
    expect.objectContaining({
      title: 'Mystery gift',
      estimated_cost_cents: undefined,
    })
  );
  const payload = mockCreate.mock.calls[0][1];
  expect(payload.estimated_cost_cents).toBeUndefined();
  expect(Number.isNaN(payload.estimated_cost_cents)).toBe(false);
});
