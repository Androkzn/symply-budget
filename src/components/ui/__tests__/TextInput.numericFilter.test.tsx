/**
 * The shared field is the app-wide chokepoint that makes "a number field cannot
 * take letters" actually true.
 *
 * Picking `decimal-pad` is necessary but not sufficient: a keypad is a
 * suggestion, not a constraint, and letters still arrive by paste, by Bluetooth
 * keyboard, and from Android IMEs that keep their alphabetic row. Reported from
 * a physical iPhone on Budget's Savings → Projection goal sheet, which shipped
 * with the letters-capable `numbers-and-punctuation` keypad.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { TextInput } from '../TextInput';

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

/** The host field node — RN's `TextInput` is a composite over a host of the same props. */
const field = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.find((n) => typeof n.type === 'string' && typeof n.props?.onChangeText === 'function');

async function type(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  await act(async () => {
    field(tree).props.onChangeText(text);
  });
}

describe('shared TextInput — numeric fields refuse letters', () => {
  it.each(['decimal-pad', 'number-pad', 'numeric'] as const)(
    'strips letters on a %s field',
    async (keyboardType) => {
      const onChangeText = jest.fn();
      const tree = await render(
        <TextInput keyboardType={keyboardType} value="" onChangeText={onChangeText} />
      );

      await type(tree, '12abc34');

      expect(onChangeText).toHaveBeenCalledWith('1234');
    }
  );

  it('keeps the separators and sign a formatted money value carries', async () => {
    const onChangeText = jest.fn();
    const tree = await render(
      <TextInput keyboardType="decimal-pad" value="" onChangeText={onChangeText} />
    );

    await type(tree, '-1,200.50');

    expect(onChangeText).toHaveBeenCalledWith('-1,200.50');
  });

  it('leaves a free-text field completely alone', async () => {
    const onChangeText = jest.fn();
    const tree = await render(<TextInput value="" onChangeText={onChangeText} />);

    await type(tree, 'Hydro bill');

    expect(onChangeText).toHaveBeenCalledWith('Hydro bill');
  });

  it.each(['email-address', 'phone-pad', 'url'] as const)(
    'leaves a %s field alone — it is not in the numeric family',
    async (keyboardType) => {
      const onChangeText = jest.fn();
      const tree = await render(
        <TextInput keyboardType={keyboardType} value="" onChangeText={onChangeText} />
      );

      await type(tree, 'ada@example.com');

      expect(onChangeText).toHaveBeenCalledWith('ada@example.com');
    }
  );
});
