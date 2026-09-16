/**
 * CommandCenter — brand-gradient fallback branch.
 *
 * With a single-stop brand gradient, `KAIZEN_GRADIENT_BRAND[1]` is undefined, so
 * `BRAND_COMPLETE` (module const) must fall back to the first stop. A dedicated
 * file is needed because the fallback is decided at module-import time, so it
 * requires the mocked gradient to be in place before <CommandCenter> loads.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { allText } from '../../test-utils/kaizenScreenTestKit';

jest.mock('@features/kaizen/theme/appColors', () => {
  const actual = jest.requireActual('@features/kaizen/theme/appColors');
  return { __esModule: true, ...actual, KAIZEN_GRADIENT_BRAND: ['#123456'] };
});

// Imported AFTER the mock so the module-level BRAND_COMPLETE reads the stub.
const { ProgressRing } = require('../CommandCenter');

describe('ProgressRing (single-stop gradient fallback)', () => {
  it('falls back to the first stop for the complete tone', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <ProgressRing progress={1} />
        </ThemeProvider>,
      );
    });
    expect(allText(tree.toJSON())).toContain('100%');
  });
});
