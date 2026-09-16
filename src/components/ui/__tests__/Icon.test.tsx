/**
 * Coverage for the shared <Icon> primitive and its use inside <BrandSymbol>.
 *
 * Proves the two-path contract of the new brand icon system:
 *   1. A name present in the active brand's PNG kit renders an <Image> (the
 *      branded, palette-tinted artwork).
 *   2. A name the kit doesn't cover falls back to an Ionicons glyph, so the
 *      ~1,200 legacy call sites keep working while migrating incrementally.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { act } from 'react-test-renderer';

import {
  brandIconAssets,
  brandIconNames,
} from '@brand/icons.generated';
import { BrandSymbol } from '@components/common/BrandSymbol';
import { Icon, hasBrandIcon } from '@components/ui/Icon';
import { IONICON_TO_BRAND } from '@components/ui/ioniconAliases';
import { useAppStore } from '@stores/appStore';
import { ACCENT_SCHEME_ORDER } from '@theme/accentSchemes';
import { getAppColors } from '@theme/appColors';

import { ALL_DEVICES, renderOnDevice } from '../../../test-utils/deviceRender';

describe('brand icon require-map (generated)', () => {
  it('exposes the active brand kit with all three core states per icon', () => {
    // Kit is regenerated per APP_BRAND — assert the committed map, not House-only names.
    expect(brandIconNames.length).toBeGreaterThanOrEqual(40);
    expect(brandIconNames).toContain('home');
    for (const name of brandIconNames.slice(0, 8)) {
      const states = brandIconAssets[name];
      expect(states.selected).toBeTruthy();
      expect(states.unselectedDark).toBeTruthy();
      expect(states.unselectedLight).toBeTruthy();
    }
  });

  it('hasBrandIcon reflects kit membership', () => {
    expect(hasBrandIcon('home')).toBe(true);
    expect(hasBrandIcon('definitely-not-a-brand-icon')).toBe(false);
  });

  // Alias resolution must check the active kit before claiming PNG coverage.
  const orphanedAliases = Object.entries(IONICON_TO_BRAND).filter(
    ([, target]) => !(target in brandIconAssets),
  );

  it('answers false for an alias whose target this brand kit does not ship', () => {
    for (const [ionicon, target] of orphanedAliases) {
      expect({ ionicon, target, hasBrandIcon: hasBrandIcon(ionicon) }).toEqual({
        ionicon,
        target,
        hasBrandIcon: false,
      });
      expect(hasBrandIcon(`${ionicon}-outline`)).toBe(false);
    }
  });

  it('draws an orphaned alias as an Ionicons glyph in the requested tint', () => {
    // Exactly what a caller does with a `false` answer: pass its own colour and
    // expect to see it. A regression here is a black icon on a tinted row.
    if (orphanedAliases.length === 0) return;
    const [ionicon] = orphanedAliases[0];
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <Icon name={`${ionicon}-outline`} color="#34C7B5" />,
    );
    expect(r.root.findAllByType(Image).length).toBe(0);
    expect(r.root.findByType(Ionicons).props.color).toBe('#34C7B5');
  });
});

describe('<Icon> — every device', () => {
  it.each(ALL_DEVICES.map(d => [d]))(
    'renders the brand PNG as an <Image> for a kit name on %s',
    device => {
      const r = renderOnDevice(device, <Icon name="home" active />);
      expect(r.root.findAllByType(Image).length).toBe(1);
      // Branded PNG shape — no Ionicons glyph in this path.
      expect(r.root.findAllByType(Ionicons).length).toBe(0);
    },
  );

  it.each(ALL_DEVICES.map(d => [d]))(
    'falls back to an Ionicons glyph for an unknown name on %s',
    device => {
      const r = renderOnDevice(
        device,
        <Icon name="planet-outline" active={false} />,
      );
      expect(r.root.findAllByType(Ionicons).length).toBe(1);
      expect(r.root.findAllByType(Image).length).toBe(0);
    },
  );
});

describe('<Icon> — color-aware PNG vs glyph selection', () => {
  it('uses the brand PNG for a brand-primary color (teal)', () => {
    const r = renderOnDevice('iPhone 14 Pro', <Icon name="add" color="#4ECDC4" />);
    expect(r.root.findAllByType(Image).length).toBe(1);
    expect(r.root.findAllByType(Ionicons).length).toBe(0);
  });

  it('uses the brand PNG (monochrome) for a neutral gray color', () => {
    const r = renderOnDevice('iPhone 14 Pro', <Icon name="add" color="#8E8E93" />);
    expect(r.root.findAllByType(Image).length).toBe(1);
  });

  it('uses a white-tinted monochrome PNG for white on filled buttons', () => {
    const r = renderOnDevice('iPhone 14 Pro', <Icon name="add" color="#FFFFFF" />);
    const image = r.root.findByType(Image);
    expect(image.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ tintColor: '#FFFFFF' })])
    );
    expect(r.root.findAllByType(Ionicons).length).toBe(0);
  });

  it('uses a tinted brand PNG for a semantic red color (destructive)', () => {
    const r = renderOnDevice('iPhone 14 Pro', <Icon name="trash-outline" color="#FF3B30" />);
    expect(r.root.findAllByType(Image).length).toBe(1);
    expect(r.root.findAllByType(Ionicons).length).toBe(0);
  });

  it('aliases an Ionicons name (trash-outline → delete) to the brand PNG when neutral', () => {
    const r = renderOnDevice('iPhone 14 Pro', <Icon name="trash-outline" color="#8E8E93" />);
    expect(r.root.findAllByType(Image).length).toBe(1);
  });
});

describe('<BrandSymbol> — brand icon wins over Ionicons', () => {
  it('renders the branded PNG when brandIcon is a kit name', () => {
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <BrandSymbol ionicon="grid" brandIcon="home" focused color="#000" />,
    );
    expect(r.root.findAllByType(Image).length).toBe(1);
  });

  it('renders Ionicons when neither brandIcon nor ionicon resolve in the kit', () => {
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <BrandSymbol ionicon="planet" brandIcon="nope-not-real" focused color="#000" />,
    );
    expect(r.root.findAllByType(Ionicons).length).toBe(1);
  });

  it('prefers brand PNG over SF Symbol when the kit ships the icon', () => {
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <BrandSymbol
        ionicon="grid"
        brandIcon="home"
        sfSymbol="house"
        focused
        color="#000"
      />,
    );
    expect(r.root.findAllByType(Image).length).toBe(1);
    expect(r.root.findAllByType(Ionicons).length).toBe(0);
  });
});


describe('<Icon> — live palette foregrounds', () => {
  const initial = useAppStore.getState();
  afterEach(() => {
    act(() => useAppStore.setState({ accentScheme: initial.accentScheme, themeMode: initial.themeMode }));
  });

  it.each(['light', 'dark'] as const)('updates every kit icon in place across all schemes (%s)', (themeMode) => {
    act(() => useAppStore.setState({ themeMode, accentScheme: 'classic' }));
    const tree = renderOnDevice('iPhone 14 Pro', <>
      {brandIconNames.map(name => <Icon key={name} name={name} active />)}
    </>);
    for (const accentScheme of ACCENT_SCHEME_ORDER) {
      act(() => useAppStore.setState({ accentScheme }));
      const colors = getAppColors(themeMode === 'dark' ? 'dark' : 'clean', accentScheme);
      const images = tree.root.findAllByType(Image);
      expect(images).toHaveLength(brandIconNames.length);
      for (const img of images) {
        expect(StyleSheet.flatten(img.props.style).tintColor).toBe(colors.primary);
      }
    }
    act(() => tree.unmount());
  });

  it.each(['#FFFFFF', '#FF3B30', '#FF9500', '#8E8E93', '#14B8A6', '#0D9488', 'transparent'])(
    'honors explicit %s even when active, for both kit and fallback', color => {
      const tree = renderOnDevice('iPhone 14 Pro', <>
        <Icon name="home" active color={color} />
        <Icon name="home" active color={color} forceIonicons />
      </>);
      expect(StyleSheet.flatten(tree.root.findByType(Image).props.style).tintColor).toBe(color);
      expect(tree.root.findByType(Ionicons).props.color).toBe(color);
      act(() => tree.unmount());
    },
  );

  it('keeps inactive icons neutral and filled foregrounds white', () => {
    const tree = renderOnDevice('iPhone 14 Pro', <>
      <Icon name="home" />
      <Icon name="home" filled />
      <Icon name="home" filled forceIonicons />
    </>);
    const { accentScheme, themeMode } = useAppStore.getState();
    const colors = getAppColors(themeMode === 'dark' ? 'dark' : 'clean', accentScheme);
    const images = tree.root.findAllByType(Image);
    expect(StyleSheet.flatten(images[0].props.style).tintColor).toBe(colors.textSecondary);
    expect(StyleSheet.flatten(images[1].props.style).tintColor).toBe(colors.white);
    expect(tree.root.findByType(Ionicons).props.color).toBe(colors.white);
    act(() => tree.unmount());
  });
});
