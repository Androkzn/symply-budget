/**
 * Shared, side-effect-free tree helpers for the House V2 component suites.
 *
 * The sibling of `screens/house-v2/enrolment/__tests__/enrolmentTestKit.tsx`,
 * kept local so a component suite never has to reach into the screen suites'
 * folder. No `jest.mock()` lives here — mocks belong to the file that needs
 * them, and a helper module that installs them would silently change every
 * suite that imports it.
 *
 * Two conventions the suites depend on:
 *  - a control is found by its `testID` **and** an `onPress` prop, which lands
 *    on the composite element rather than the host view the id also reaches —
 *    matching on both is what avoids double matches;
 *  - text is read off HOST nodes only, so a composite and the view it renders
 *    do not each contribute the same sentence twice.
 *
 * (Jest's `testMatch` is `*.test.*`, so this file sits in `__tests__/` without
 * being collected as an empty suite.)
 */
import type ReactTestRenderer from 'react-test-renderer';
import { act } from 'react-test-renderer';

type Tree = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

/** Host (string-typed) nodes carrying a testID. */
export function byTestId(tree: Tree, id: string): Instance[] {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

export function hasTestId(tree: Tree, id: string): boolean {
  return byTestId(tree, id).length > 0;
}

/** Concatenated text of one instance's host subtree. */
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

/** Text under the first host node with this testID ('' when absent). */
export function textOf(tree: Tree, id: string): string {
  const nodes = byTestId(tree, id);
  return nodes.length > 0 ? instanceText(nodes[0]!) : '';
}

/** Every string rendered anywhere in the tree — for "no raw error" assertions. */
export function allText(tree: Tree): string {
  return instanceText(tree.root);
}

/** Flush microtasks after a fire-and-forget handler. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function control(tree: Tree, id: string): Instance {
  const match = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function',
  )[0];
  if (!match) throw new Error(`No element with testID "${id}" and an onPress handler`);
  return match;
}

export async function press(tree: Tree, id: string): Promise<void> {
  await act(async () => {
    control(tree, id).props.onPress();
    await flush();
  });
}

/** True when the control is present and disabled. */
export function isDisabled(tree: Tree, id: string): boolean {
  const match = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function',
  )[0];
  return match?.props.disabled === true;
}

/** Title of a `Button`/`GradientButton` by testID — the button's own label prop. */
export function buttonTitle(tree: Tree, id: string): string | undefined {
  const match = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props?.title === 'string',
  )[0];
  return match?.props.title as string | undefined;
}

/** `accessibilityLabel` of the first node carrying this testID. */
export function labelOf(tree: Tree, id: string): string | undefined {
  const match = tree.root.findAll((n) => n.props?.testID === id)[0];
  return match?.props.accessibilityLabel as string | undefined;
}

/** How many indexed rows (`<prefix>-0`, `<prefix>-1`, …) the tree renders. */
export function countIndexed(tree: Tree, prefix: string): number {
  let count = 0;
  while (hasTestId(tree, `${prefix}-${count}`)) count += 1;
  return count;
}
