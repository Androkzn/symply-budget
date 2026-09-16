/**
 * BottomSheet — iPad presentation rules.
 *
 * Full-height sheets (Task Details) must anchor to the bottom on iPad so the modal
 * backdrop does not show as a gray band above the sheet. Shorter sheets may stay
 * vertically centered.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 834, height: 1194, scale: 2, fontScale: 1 })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }),
}));

jest.mock('@hooks/useDeviceType', () => ({
  useDeviceType: () => ({ isIPad: true }),
}));

jest.mock('@stores/tabBarVisibilityStore', () => ({
  useTabBarVisibilityStore: (selector: (s: { isSidebarVisible: boolean }) => unknown) =>
    selector({ isSidebarVisible: false }),
}));

import React from 'react';
import { ScrollView, Text, View, ViewStyle } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { BottomSheet } from '@components/ui/BottomSheet';
import { ThemeProvider } from '@contexts/ThemeContext';

const WINDOW_HEIGHT = 1194;

function flattenStyle(style: ViewStyle | ViewStyle[] | undefined): ViewStyle {
  if (!style) return {};
  const list = Array.isArray(style) ? style : [style];
  return list.reduce<ViewStyle>((acc, item) => {
    if (item && typeof item === 'object') {
      return { ...acc, ...item };
    }
    return acc;
  }, {});
}

function layoutTarget(
  r: ReactTestRenderer.ReactTestRenderer,
  testID: string,
  height: number
) {
  const target = r.root.findByProps({ testID });
  act(() => {
    target.props.onLayout({ nativeEvent: { layout: { height, width: 300, x: 0, y: 0 } } });
  });
}

/**
 * Fire the body's real `onLayout` with a given natural height.
 *
 * The component decides between hugging and scrolling from a MEASURED height,
 * so a test that never lays out only ever sees the unmeasured case — which is
 * precisely how the blank sheet stayed hidden. Targeted by testID rather than
 * by "the first View with an onLayout": the handle + header block is measured
 * too, and it comes first.
 */
function layoutBody(r: ReactTestRenderer.ReactTestRenderer, height: number) {
  layoutTarget(r, 'bottom-sheet-body', height);
}

/** Fire the handle+header block's `onLayout` — the room the body does NOT get. */
function layoutChrome(r: ReactTestRenderer.ReactTestRenderer, height: number) {
  layoutTarget(r, 'bottom-sheet-chrome', height);
}

function renderSheet(
  height: 'standard' | 'full' | 'content' = 'standard',
  presentation: 'auto' | 'bottom' | 'centered' = 'auto'
) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        {/* The standard glass ✕ is ON by default; these cases are about the
            BODY (hug vs scroll, overlay placement), so this fixture opts out to
            stay chrome-free and keep `findByType(Text)` unambiguous. */}
        <BottomSheet
          visible
          onClose={jest.fn()}
          height={height}
          presentation={presentation}
          showCloseButton={false}
          noPadding
        >
          <Text>Body</Text>
        </BottomSheet>
      </ThemeProvider>
    );
  });
  return r;
}

/** A sheet that asks for nothing — used to prove the ✕ arrives on its own. */
function renderHeaderSheetNoChrome() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        <BottomSheet visible onClose={jest.fn()} height="content" noPadding>
          <Text>Body</Text>
        </BottomSheet>
      </ThemeProvider>
    );
  });
  return r;
}

function overlayJustifyContent(r: ReactTestRenderer.ReactTestRenderer): string | undefined {
  const overlay = r.root.findByProps({ testID: 'bottom-sheet-overlay' });
  return flattenStyle(overlay.props.style).justifyContent;
}

function sheetFrameHeight(r: ReactTestRenderer.ReactTestRenderer): number | undefined {
  const frame = r.root.findByProps({ testID: 'bottom-sheet-frame' });
  return flattenStyle(frame.props.style).height as number | undefined;
}

describe('BottomSheet — iPad layout', () => {
  it('full-height sheets use flex-end and span the window height', () => {
    const r = renderSheet('full', 'bottom');
    expect(overlayJustifyContent(r)).toBe('flex-end');
    expect(sheetFrameHeight(r)).toBe(WINDOW_HEIGHT);
    const frame = r.root.findByProps({ testID: 'bottom-sheet-frame' });
    expect(flattenStyle(frame.props.style).maxWidth).toBeUndefined();
  });

  it('standard sheets stay vertically centered on iPad', () => {
    const r = renderSheet('standard');
    expect(overlayJustifyContent(r)).toBe('center');
  });
});

describe('BottomSheet — content height', () => {
  it('hugs its content (no fixed height) instead of committing to a screen fraction', () => {
    const r = renderSheet('content');
    const frame = r.root.findByProps({ testID: 'bottom-sheet-frame' });
    const style = flattenStyle(frame.props.style);
    expect(style.height).toBeUndefined();
    expect(typeof style.maxHeight).toBe('number');
  });

  it('caps the maxHeight below the full window — a ceiling, not a target', () => {
    const r = renderSheet('content');
    const frame = r.root.findByProps({ testID: 'bottom-sheet-frame' });
    const style = flattenStyle(frame.props.style);
    expect(style.maxHeight as number).toBeGreaterThan(0);
    expect(style.maxHeight as number).toBeLessThan(WINDOW_HEIGHT);
  });

  /*
   * The two cases that used to live here — "always renders a ScrollView" and
   * "the scroller shrinks under the cap" — described the UNCONDITIONAL scroller
   * and were true only while it existed. The component now hugs a body that
   * fits in a plain View and mounts a scroller only past the cap, so both would
   * assert the old shape against the new one. The pair below replaces them and
   * covers both sides of the cap by driving the real `onLayout`.
   */

  /**
   * `sheetInner` is `flex: 1`, which Yoga reads as `grow 1, shrink 1, basis 0`.
   * Overriding only grow and shrink leaves the basis at 0, which is wrong for a
   * box meant to hug its content — so all three parts are reset together.
   *
   * A content sheet used to put its body in a ScrollView unconditionally. A
   * ScrollView has no intrinsic height — its *contentContainer* sizes to the
   * children, the scroll box does not — so nested in auto-sized parents it
   * resolved to 0, the frame hugged 0, and the body laid out below the screen
   * edge where `overflow: hidden` clipped it. On device: backdrop dimmed,
   * buttons in the a11y tree at y≈901 against an 874pt window, nothing
   * reachable and no way to dismiss.
   *
   * It survived because nothing ever asserted INSIDE a content sheet. These two
   * tests do, by driving the real `onLayout` both sides of the cap.
   */
  it('hugs a body that fits: renders it in a plain View, with no scroller', () => {
    const r = renderSheet('content');
    layoutBody(r, 200); // well under the cap

    expect(r.root.findAllByType(ScrollView).length).toBe(0);
    // The point of the whole exercise: the children are actually there.
    expect(r.root.findByType(Text).props.children).toBe('Body');
  });

  it('scrolls a body past the cap, inside a parent with a DEFINITE height', () => {
    const r = renderSheet('content');
    layoutBody(r, WINDOW_HEIGHT * 2); // far past the cap

    const scrollers = r.root.findAllByType(ScrollView);
    expect(scrollers.length).toBe(1);

    // The definite height is the fix. Without a concrete number on the parent,
    // the ScrollView collapses to 0 again and the sheet renders blank.
    const parentHeight = flattenStyle(
      r.root.findByProps({ testID: 'bottom-sheet-body-viewport' }).props.style
    ).height as number;
    expect(parentHeight).toBeGreaterThan(0);
    expect(parentHeight).toBeLessThanOrEqual(WINDOW_HEIGHT);

    // And the body is still reachable rather than clipped away.
    expect(r.root.findByType(Text).props.children).toBe('Body');
  });

  it('leaves fixed-fraction sheets alone — they bring their own scrolling', () => {
    const r = renderSheet('standard');
    expect(r.root.findAllByType(ScrollView).length).toBe(0);
  });

  /**
   * The clipping bug, in one test.
   *
   * The cap belongs to the FRAME. The body only ever gets what is left of it
   * under the drag handle and the header, minus its own bottom padding — on an
   * iPhone that is around 140pt. While the hug/scroll decision compared the
   * body against the whole cap, every body landing in that 140pt band claimed
   * to fit, rendered in a plain hugging View, and had its tail cut off by
   * `sheetInner`'s `overflow: hidden` with no scroller to reach it. Seen on
   * Budget's recovery-phrase sheet: the words rendered, the Drive / Device /
   * Share row was sliced in half, and Done was gone.
   */
  it('scrolls a body that fits the cap but NOT the room left under the chrome', () => {
    const r = renderSheet('content');
    const cap = flattenStyle(
      r.root.findByProps({ testID: 'bottom-sheet-frame' }).props.style
    ).maxHeight as number;
    const chrome = 120;
    layoutChrome(r, chrome);
    // Comfortably under the cap — the old comparison called this "fits".
    layoutBody(r, cap - 40);

    expect(r.root.findAllByType(ScrollView).length).toBe(1);

    // And it scrolls inside exactly the room that is left, not the whole cap:
    // a taller parent would push its own bottom off the sheet again.
    const viewport = r.root.findByProps({ testID: 'bottom-sheet-body-viewport' });
    expect(flattenStyle(viewport.props.style).height).toBe(cap - chrome);
  });
});

describe('BottomSheet — standard header', () => {
  function renderHeaderSheet(props: Record<string, unknown> = {}) {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <ThemeProvider>
          <BottomSheet
            visible
            onClose={jest.fn()}
            height="content"
            title="Review tax notice"
            showCloseButton
            {...props}
          >
            <Text>Body</Text>
          </BottomSheet>
        </ThemeProvider>
      );
    });
    return r;
  }

  /** testIDs in depth-first order — which, in a row, is left to right. */
  function testIDOrder(r: ReactTestRenderer.ReactTestRenderer): string[] {
    const ids: string[] = [];
    type Node = ReactTestRenderer.ReactTestRendererJSON;
    const walk = (node: Node | Node[] | string | null) => {
      if (!node || typeof node === 'string') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const id = (node.props as { testID?: string } | undefined)?.testID;
      if (id) ids.push(id);
      (node.children ?? []).forEach(walk);
    };
    walk(r.toJSON());
    return ids;
  }

  /**
   * One header pattern for every sheet in the app: ✕ on the left, title
   * centred, the single commit (Save / Done / Add) on the right. Sheets used to
   * each roll their own — Cancel-left/Done-right here, an absolutely positioned
   * ✕ on the right there — so the same gesture meant "discard" on one sheet and
   * "confirm" on the next.
   */
  it('puts the close button left of the commit action', () => {
    const r = renderHeaderSheet({
      headerAction: { label: 'Save', onPress: jest.fn(), testID: 'tax-save' },
    });
    const ids = testIDOrder(r);
    expect(ids).toContain('bottom-sheet-close');
    expect(ids.indexOf('bottom-sheet-close')).toBeLessThan(ids.indexOf('tax-save'));
  });

  it('centres the title by layout, so it lands identically with or without an action', () => {
    const withAction = renderHeaderSheet({
      headerAction: { label: 'Save', onPress: jest.fn() },
    });
    const withoutAction = renderHeaderSheet();
    for (const r of [withAction, withoutAction]) {
      const title = r.root.findByProps({ children: 'Review tax notice' });
      expect(title.props.align).toBe('center');
    }
    // The side columns hold the centre in place; without equal widths a lone
    // close button would shove the title right.
    const sides = withoutAction.root
      .findAllByType(View)
      .filter((node) => typeof flattenStyle(node.props.style).minWidth === 'number');
    expect(sides.length).toBeGreaterThanOrEqual(2);
  });

  it('reports a disabled/loading action to assistive tech and blocks the press', () => {
    const onPress = jest.fn();
    const r = renderHeaderSheet({
      headerAction: { label: 'Save', onPress, loading: true, testID: 'tax-save' },
    });
    const action = r.root.findByProps({ testID: 'tax-save' });
    expect(action.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(action.props.disabled).toBe(true);
  });

  /**
   * The ✕ is the app-wide standard, so it is the DEFAULT rather than something
   * each sheet remembers to ask for — 64 of the 65 call sites were already
   * passing `showCloseButton` by hand, and the one that wasn't is the reason
   * this is now opt-out: a sheet should not be able to drift into having no
   * dismiss control just by omitting a prop.
   */
  it('gives a sheet the standard close button even with no title or action', () => {
    const r = renderHeaderSheetNoChrome();
    expect(r.root.findAllByProps({ testID: 'bottom-sheet-close' }).length).toBeGreaterThan(0);
    expect(r.root.findAllByProps({ testID: 'bottom-sheet-action' }).length).toBe(0);
  });

  it('drops the header entirely only when a sheet explicitly opts out', () => {
    const r = renderSheet('content');
    expect(r.root.findAllByProps({ testID: 'bottom-sheet-close' }).length).toBe(0);
    expect(r.root.findAllByProps({ testID: 'bottom-sheet-action' }).length).toBe(0);
  });
});

describe('BottomSheet — scrollable fixed-height explanations', () => {
  it.each(['short', 'standard', 'tall', 'full'] as const)('bounds the %s body and reserves bottom space', (height) => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <BottomSheet visible onClose={jest.fn()} height={height} scrollable title="Explanation">
            <View style={{ height: 3000 }}><Text>Last content</Text></View>
          </BottomSheet>
        </ThemeProvider>,
      );
    });
    const scroll = tree.root.findByType(ScrollView);
    expect(flattenStyle(scroll.props.style).flex).toBe(1);
    expect(flattenStyle(scroll.props.contentContainerStyle).paddingBottom).toBeGreaterThan(0);
    expect(scroll.props.nestedScrollEnabled).toBe(true);
    expect(scroll.findAllByProps({ testID: 'bottom-sheet-chrome' })).toHaveLength(0);
    expect(scroll.findAllByType(Text).some(node => node.props.children === 'Last content')).toBe(true);
  });
});
