/**
 * ScanImportSources — the single Camera · Gallery · File · Drive tile row shared
 * by every "Scan / import (AI)" surface (receipt scan, savings import, mortgage
 * statement). Locks the contract the screens rely on:
 *  - one tile per handler, in canonical camera → gallery → file → drive order
 *  - a source with NO handler is omitted (savings has no Camera)
 *  - each tile carries `${testIDPrefix}-${source}` and fires its handler
 *  - `disabled` propagates to every tile
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import React from 'react';
import { TouchableOpacity } from 'react-native';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { ScanImportSources } from '../ScanImportSources';

const tiles = (renderer: ReturnType<typeof renderOnDevice>) =>
  renderer.root
    .findAllByType(TouchableOpacity)
    .filter((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('src-'));

describe('ScanImportSources', () => {
  it('renders every provided source in canonical order with prefixed testIDs', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <ScanImportSources
        testIDPrefix="src"
        onCamera={() => {}}
        onGallery={() => {}}
        onFile={() => {}}
        onDrive={() => {}}
      />
    );
    expect(tiles(renderer).map((n) => n.props.testID)).toEqual([
      'src-camera',
      'src-gallery',
      'src-file',
      'src-drive',
    ]);
  });

  it('omits a source when its handler is not supplied (savings has no Camera)', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <ScanImportSources
        testIDPrefix="src"
        onGallery={() => {}}
        onFile={() => {}}
        onDrive={() => {}}
      />
    );
    expect(tiles(renderer).map((n) => n.props.testID)).toEqual([
      'src-gallery',
      'src-file',
      'src-drive',
    ]);
  });

  it('fires the matching handler when a tile is pressed', () => {
    const onDrive = jest.fn();
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <ScanImportSources testIDPrefix="src" onCamera={() => {}} onDrive={onDrive} />
    );
    renderer.root.findByProps({ testID: 'src-drive' }).props.onPress();
    expect(onDrive).toHaveBeenCalledTimes(1);
  });

  it('disables every tile when `disabled` is set', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <ScanImportSources testIDPrefix="src" disabled onCamera={() => {}} onFile={() => {}} />
    );
    expect(tiles(renderer).every((n) => n.props.disabled === true)).toBe(true);
  });
});
