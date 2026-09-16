/**
 * Shared pure helpers for Symply Kaizen (`symply-kaizen`) screen UI tests.
 *
 * Contract for every Kaizen screen UI suite:
 *  1. Render the real screen (ThemeProvider), not a shallow stub of the screen.
 *  2. Press every primary button / link and assert the side effect
 *     (router.push, store action, or API mock).
 *  3. Type into every TextInput that drives a submit path and assert the call.
 *  4. Assert error/empty UI when the mocked store/API rejects.
 *  5. Assert Enable-AI / disclosure / gated CTAs stay on the same screen
 *     (no unexpected navigation).
 *
 * Only side-effect-free utilities live here — jest.mock() stays in each test file.
 */

import type ReactTestRenderer from 'react-test-renderer';

export const IPHONE = { width: 393, height: 852, scale: 3, fontScale: 1 };
export const IPAD = { width: 1024, height: 1366, scale: 2, fontScale: 1 };

type Tree = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

/** Flatten every string/number in a rendered host tree, preserving concatenation. */
export function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

/** Concatenated text of a single component instance's subtree. */
export function instanceText(inst: Instance): string {
  return inst
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String)
    .join('');
}

/** Host (string-typed) nodes carrying a testID — avoids composite double-matches. */
export function byTestId(tree: Tree, id: string): Instance[] {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

export function hasTestId(tree: Tree, id: string): boolean {
  return byTestId(tree, id).length > 0;
}

/** Primary vertical ScrollView for a screen tree (first match). */
export function primaryScrollView(tree: Tree): Instance | undefined {
  return tree.root.findAll((n) => String(n.type) === 'ScrollView')[0];
}

/**
 * Asserts the screen uses a bounded, enabled vertical scroll container.
 * Kaizen screens must use `flex: 1` on ScrollView so content scrolls on device.
 */
export function expectScrollableScreen(tree: Tree, scrollTestId?: string): void {
  const scroll = scrollTestId
    ? tree.root.findAll(
        (n) => typeof n.type === 'string' && n.props?.testID === scrollTestId,
      )[0]
    : primaryScrollView(tree);
  expect(scroll).toBeTruthy();
  expect(scroll!.props.scrollEnabled).not.toBe(false);
  const flat = Array.isArray(scroll!.props.style)
    ? Object.assign({}, ...scroll!.props.style.filter(Boolean))
    : scroll!.props.style ?? {};
  expect(flat.flex).toBe(1);
}

/** Every distinct pressable whose rendered subtree contains `text`. */
export function pressablesWithText(tree: Tree, text: string): Instance[] {
  return tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function' && instanceText(n).includes(text),
  );
}

/** Fire onPress on the outermost pressable whose subtree contains `text`. */
export function pressByText(tree: Tree, text: string): void {
  const matches = pressablesWithText(tree, text);
  if (matches.length === 0) {
    throw new Error(`No pressable found containing text: "${text}"`);
  }
  matches[0].props.onPress();
}

/** Collect void'd async handler rejections while running an interaction. */
export function trackUnhandledRejections(): {
  getRejections: () => unknown[];
  restore: () => void;
} {
  const rejections: unknown[] = [];
  const handler = (reason: unknown) => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', handler);
  return {
    getRejections: () => rejections,
    restore: () => process.removeListener('unhandledRejection', handler),
  };
}

/** Flush microtasks/setImmediate ticks after a fire-and-forget async handler. */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * One-shot rejecting mock that attaches `.catch` immediately so void store calls
 * do not surface as unhandled rejections in Jest, while still rejecting to callers.
 */
export function mockHandledRejection(fn: jest.Mock, message = 'offline'): void {
  fn.mockImplementationOnce(() => {
    const pending = new Promise((_resolve, reject) => {
      setImmediate(() => reject(new Error(message)));
    });
    void pending.catch(() => undefined);
    return pending;
  });
}

/**
 * Attach a handler to the promise returned by the latest mock call so Jest does
 * not treat a screen's void'd async handler as an unhandled rejection.
 */
export async function drainMockRejection(fn: jest.Mock): Promise<void> {
  await flushMicrotasks();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const pending = fn.mock.results.at(-1)?.value as Promise<unknown> | undefined;
  if (pending && typeof pending.catch === 'function') {
    await pending.catch(() => undefined);
  }
  await flushMicrotasks();
}

/**
 * Capture a rejection from a screen's void'd async handler (e.g. `void review()`)
 * so Jest does not fail the suite while still asserting failure behavior.
 */
export function captureVoidAsyncRejection(timeoutMs = 250): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    const handler = (reason: unknown) => {
      cleanup();
      resolve(reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, timeoutMs);
    const cleanup = () => {
      process.removeListener('unhandledRejection', handler);
      clearTimeout(timer);
    };
    process.prependListener('unhandledRejection', handler);
  });
}

/**
 * Press the innermost pressable that has an exact Text label child.
 * Prefer this over pressByText when a subtitle elsewhere also contains the word
 * (e.g. Settings detail "Systems, notifications…" vs row label "Systems").
 */
export function pressByExactLabel(tree: Tree, label: string): void {
  const pressables = tree.root.findAll((n) => typeof n.props?.onPress === 'function');
  const withExact = pressables.filter((n) =>
    n.findAll(
      (c) =>
        typeof c.type === 'string' &&
        String(c.type) === 'Text' &&
        (c.props?.children === label ||
          (Array.isArray(c.props?.children) &&
            c.props.children.length === 1 &&
            c.props.children[0] === label)),
    ).length > 0,
  );
  if (withExact.length === 0) {
    throw new Error(`No pressable with exact label: "${label}"`);
  }
  // Innermost = last in depth-first order among matches that aren't ancestors of others.
  const innermost = withExact.reduce((best, n) => {
    if (best.findAll((c) => c === n).length > 0) return n;
    if (n.findAll((c) => c === best).length > 0) return best;
    return n;
  });
  innermost.props.onPress();
}

/** All TextInput host nodes in the tree (stable order). */
export function textInputs(tree: Tree): Instance[] {
  return tree.root.findAll((n) => String(n.type) === 'TextInput');
}

/** Type into the n-th TextInput (default 0). */
export function typeIn(tree: Tree, value: string, index = 0): void {
  const inputs = textInputs(tree);
  if (!inputs[index]) {
    throw new Error(`No TextInput at index ${index} (found ${inputs.length})`);
  }
  inputs[index].props.onChangeText?.(value);
}

/** Press a control by accessibilityLabel (e.g. Send). */
export function pressByA11yLabel(tree: Tree, label: string): void {
  const match = tree.root.findAll(
    (n) =>
      n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
  )[0];
  if (!match) {
    throw new Error(`No pressable with accessibilityLabel: "${label}"`);
  }
  match.props.onPress();
}

/** Flatten style arrays/objects for minHeight / flex assertions. */
export function flattenStyle(style: unknown): Record<string, unknown> {
  if (style == null) return {};
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
  }
  if (typeof style === 'object') return style as Record<string, unknown>;
  return {};
}

/**
 * Chat / coach empty states must not reserve a tall dead band (regression:
 * Guide tab `minHeight: 260` left a barren void after Enable AI).
 */
export function expectNoDeadMinHeightBand(
  tree: Tree,
  opts: { testID?: string; maxMinHeight?: number } = {},
): void {
  const max = opts.maxMinHeight ?? 120;
  const nodes = opts.testID
    ? byTestId(tree, opts.testID)
    : tree.root.findAll((n) => typeof n.type === 'string' && n.props?.style != null);
  for (const node of nodes) {
    const flat = flattenStyle(node.props.style);
    const minH = flat.minHeight;
    if (typeof minH === 'number') {
      expect(minH).toBeLessThanOrEqual(max);
    }
  }
}

/**
 * Assert a CTA stays on the same screen: no router navigation fired.
 * Use after Enable AI / disclosure / inline toggles.
 */
export function expectNoNavigation(
  routerMock: { push: jest.Mock; replace?: jest.Mock; navigate?: jest.Mock },
): void {
  expect(routerMock.push).not.toHaveBeenCalled();
  if (routerMock.replace) expect(routerMock.replace).not.toHaveBeenCalled();
  if (routerMock.navigate) expect(routerMock.navigate).not.toHaveBeenCalled();
}

/** Assert screen root testID still mounted after an interaction. */
export function expectStillOnScreen(tree: Tree, screenTestId: string): void {
  expect(hasTestId(tree, screenTestId)).toBe(true);
}

/**
 * Assert a store/API mock was invoked with expected args (partial match on
 * first call). Use for submit paths that hit the backend via the Zustand store.
 */
export function expectCalledWithPartial(
  fn: jest.Mock,
  partial: unknown[] | Record<string, unknown>,
): void {
  expect(fn).toHaveBeenCalled();
  const args = fn.mock.calls[fn.mock.calls.length - 1];
  if (Array.isArray(partial)) {
    partial.forEach((expected, i) => {
      if (expected !== undefined) {
        expect(args[i]).toEqual(expected);
      }
    });
  } else {
    expect(args[0]).toEqual(expect.objectContaining(partial));
  }
}

/** Labels of every pressable that has visible text (for coverage audits). */
export function listPressableLabels(tree: Tree): string[] {
  const labels = new Set<string>();
  tree.root
    .findAll((n) => typeof n.props?.onPress === 'function')
    .forEach((n) => {
      const t = instanceText(n).trim();
      if (t) labels.add(t.slice(0, 80));
      const a11y = n.props?.accessibilityLabel;
      if (typeof a11y === 'string' && a11y) labels.add(a11y);
    });
  return [...labels].sort();
}
