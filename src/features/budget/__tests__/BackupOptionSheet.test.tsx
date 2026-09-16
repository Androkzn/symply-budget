/**
 * BackupOptionSheet — the picker behind "Encrypted backup" / "Restore from
 * backup" in Budget settings. Covers destination selection, the per-place
 * explanation block, the loading/empty states of the archive lists, and the
 * delete affordance on on-device archives.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { BackupOptionSheet, type BackupOption } from '../components/BackupOptionSheet';

type Tree = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

const OPTIONS: BackupOption[] = [
  {
    key: 'google-drive',
    label: 'Google Drive',
    description: 'Folder: Symply Budget Backups',
    icon: 'cloud-upload-outline',
    testID: 'opt-drive',
  },
  { key: 'files', label: 'Files app', icon: 'folder-open-outline', testID: 'opt-files' },
  {
    key: 'device',
    label: 'This device',
    icon: 'phone-portrait-outline',
    deletable: true,
    testID: 'opt-device',
  },
];

/** Concatenated text of the whole tree. */
function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

/** Pressable (or host node) carrying `testID` — the one that owns onPress. */
function pressableByTestId(tree: Tree, id: string): Instance | undefined {
  return tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function',
  )[0];
}

function hostByTestId(tree: Tree, id: string): Instance | undefined {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id)[0];
}

function labelExists(tree: Tree, label: string): boolean {
  return tree.root.findAll((n) => n.props?.accessibilityLabel === label).length > 0;
}

function renderSheet(props: Partial<React.ComponentProps<typeof BackupOptionSheet>> = {}) {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  let tree!: Tree;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BackupOptionSheet
          visible
          title="Save backup to"
          options={OPTIONS}
          onSelect={onSelect}
          onClose={onClose}
          testID="sheet"
          {...props}
        />
      </ThemeProvider>,
    );
  });
  return { tree, onSelect, onClose };
}

describe('BackupOptionSheet', () => {
  it('renders every destination with its description', () => {
    const { tree } = renderSheet();
    const text = allText(tree.toJSON());

    expect(text).toContain('Save backup to');
    expect(text).toContain('Google Drive');
    expect(text).toContain('Files app');
    expect(text).toContain('This device');
    expect(text).toContain('Folder: Symply Budget Backups');
  });

  it('reports the picked destination by key', () => {
    const { tree, onSelect } = renderSheet();

    act(() => {
      pressableByTestId(tree, 'opt-drive')!.props.onPress();
    });

    expect(onSelect).toHaveBeenCalledWith('google-drive');
  });

  it('marks a disabled option as non-interactive', () => {
    const { tree } = renderSheet({ options: [{ ...OPTIONS[0], disabled: true }] });

    expect(pressableByTestId(tree, 'opt-drive')!.props.disabled).toBe(true);
  });

  it('explains what each storage place means when notes are supplied', () => {
    const { tree } = renderSheet({
      notes: [
        { label: 'Google Drive', text: 'Survives losing this phone.' },
        { label: 'This device', text: 'Lost with the phone.' },
      ],
    });

    expect(hostByTestId(tree, 'sheet-notes')).toBeTruthy();
    expect(allText(tree.toJSON())).toContain('Which one should I pick?');
    // Screen readers get one coherent sentence per note, not two fragments.
    expect(labelExists(tree, 'Google Drive. Survives losing this phone.')).toBe(true);
    expect(labelExists(tree, 'This device. Lost with the phone.')).toBe(true);
  });

  it('omits the notes block entirely when there is nothing to explain', () => {
    const { tree } = renderSheet();
    expect(hostByTestId(tree, 'sheet-notes')).toBeUndefined();
  });

  it('shows a loading state instead of an empty list while archives are fetched', () => {
    const { tree } = renderSheet({ loading: true, options: [] });

    expect(hostByTestId(tree, 'sheet-loading')).toBeTruthy();
    expect(hostByTestId(tree, 'sheet-empty')).toBeUndefined();
  });

  it('explains an empty location rather than showing a blank sheet', () => {
    const { tree } = renderSheet({
      options: [],
      emptyMessage: 'No backups in your Google Drive yet.',
    });

    expect(hostByTestId(tree, 'sheet-empty')).toBeTruthy();
    expect(allText(tree.toJSON())).toContain('No backups in your Google Drive yet.');
  });

  it('offers delete only on deletable rows, and only when a handler is given', () => {
    const onDelete = jest.fn();
    const { tree } = renderSheet({ onDelete });

    expect(pressableByTestId(tree, 'opt-drive-delete')).toBeUndefined();

    act(() => {
      pressableByTestId(tree, 'opt-device-delete')!.props.onPress();
    });

    expect(onDelete).toHaveBeenCalledWith('device');
  });

  it('hides the delete affordance when no handler is wired', () => {
    const { tree } = renderSheet();
    expect(pressableByTestId(tree, 'opt-device-delete')).toBeUndefined();
  });

  it('closes from the cancel action without selecting anything', () => {
    const { tree, onClose, onSelect } = renderSheet();

    act(() => {
      pressableByTestId(tree, 'sheet-cancel')!.props.onPress();
    });

    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing while hidden', () => {
    const { tree } = renderSheet({ visible: false });
    expect(allText(tree.toJSON())).not.toContain('Save backup to');
  });
});
