/**
 * Shared pure helpers for the Symply Language (`symply-language`) screen tests.
 *
 * Only side-effect-free utilities live here — every jest.mock() must stay in the
 * individual test file because jest hoists mock factories per module. Window
 * presets let each screen assert it renders on both iPhone- and iPad-class
 * windows. Mirrors src/features/kaizen/test-utils/kaizenScreenTestKit.tsx so the
 * two feature suites read the same way.
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

/** All host nodes whose accessibilityRole matches (e.g. "checkbox", "button"). */
export function byRole(tree: Tree, role: string): Instance[] {
  return tree.root.findAll((n) => n.props?.accessibilityRole === role);
}
