import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { Icon, isEmojiIcon } from '../Icon';

/**
 * A ledger restored from the D1 migration stores EMOJI in `category.icon`
 * (❄️ 🚿 ⚡). Ionicons has no glyph for those, so they used to render as the
 * missing-glyph "?" box on every category chip and in the category picker.
 */
describe('Icon — emoji values', () => {
  it('recognises emoji but never mistakes a slug for one', () => {
    expect(isEmojiIcon('❄️')).toBe(true);
    expect(isEmojiIcon('🛒')).toBe(true);
    expect(isEmojiIcon('cloud-download-outline')).toBe(false);
    expect(isEmojiIcon('maintenance-fund')).toBe(false);
    expect(isEmojiIcon('')).toBe(false);
  });

  it('draws an emoji as text instead of a missing-glyph box', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <Icon name="❄️" size={14} />
        </ThemeProvider>,
      );
    });
    const texts = tree.root.findAllByType(Text);
    expect(texts.some((node) => node.props.children === '❄️')).toBe(true);
  });

  it('still renders a real Ionicons name through the icon path', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <Icon name="trash-outline" size={14} />
        </ThemeProvider>,
      );
    });
    const texts = tree.root.findAllByType(Text);
    expect(texts.some((node) => node.props.children === 'trash-outline')).toBe(false);
  });
});
