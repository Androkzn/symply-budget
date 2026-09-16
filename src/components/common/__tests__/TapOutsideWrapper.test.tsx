/**
 * TapOutsideWrapper — must never mount a root Pressable (iOS Fabric scroll bug).
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { TapOutsideProvider } from '@contexts/TapOutsideContext';

import { TapOutsideWrapper } from '../TapOutsideWrapper';

describe('TapOutsideWrapper', () => {
  it('wraps children in a View, not a Pressable (RN #56879)', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <TapOutsideProvider>
          <TapOutsideWrapper>
            <Text>child</Text>
          </TapOutsideWrapper>
        </TapOutsideProvider>,
      );
    });

    expect(tree.root.findAllByType(Pressable)).toHaveLength(0);
    expect(tree.root.findAllByType(View).length).toBeGreaterThan(0);
    expect(tree.root.findByType(Text).props).toBeTruthy();
  });
});
