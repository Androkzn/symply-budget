/**
 * A horizontal ScrollView must not let its children stretch on the cross axis.
 *
 * Why this test exists
 * --------------------
 * Savings → "Previous years" rendered its single "2026" year chip as a
 * page-tall green pill, with the monthly table pushed far down behind a large
 * empty gap (reported from a device 2026-08-23). Two ordinary-looking omissions
 * produced it:
 *
 *   1. `contentContainerStyle` had no `alignItems`. A horizontal ScrollView
 *      lays content out on the CROSS axis with the flex default `stretch`, so
 *      every chip grew to the full height of the row — and `borderRadius: 999`
 *      turned that into a pill the height of the screen.
 *   2. The ScrollView had no `flexGrow: 0`. As a plain flex child it claimed
 *      every remaining vertical point, which is what gave the chip that height
 *      to stretch into.
 *
 * NO E2E ASSERTION CATCHES THIS. Maestro checks that an element exists in the
 * hierarchy and that its frame is on screen; a chip 900pt tall satisfies both.
 * The savings-year-history flow ran against this exact screen and failed on an
 * unrelated missing button, never on the blown-up chip. So the guard has to be
 * structural, and it lives here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const screensRoot = join(__dirname, '..');

/** Screen + the contentContainerStyle key of its horizontal chip rail. */
const HORIZONTAL_RAILS: Array<{ file: string; contentStyle: string; scrollStyle?: string }> = [
  {
    file: 'savings/SavingsYearHistoryScreen.tsx',
    contentStyle: 'yearRow',
    scrollStyle: 'yearScroll',
  },
];

describe('horizontal chip rails do not stretch their children', () => {
  for (const rail of HORIZONTAL_RAILS) {
    const source = readFileSync(join(screensRoot, rail.file), 'utf8');

    it(`${rail.file}: ${rail.contentStyle} pins alignItems`, () => {
      // Grab the style object literal, then assert the cross-axis is pinned.
      const block = source.match(new RegExp(`${rail.contentStyle}:\\s*\\{[^}]*\\}`));
      expect(block).not.toBeNull();
      expect(block?.[0]).toMatch(/alignItems:\s*'(center|flex-start|flex-end)'/);
    });

    it(`${rail.file}: the ScrollView hugs its content instead of filling the screen`, () => {
      const block = source.match(new RegExp(`${rail.scrollStyle}:\\s*\\{[^}]*\\}`));
      expect(block).not.toBeNull();
      expect(block?.[0]).toMatch(/flexGrow:\s*0/);
    });

    it(`${rail.file}: the rail actually uses both styles`, () => {
      expect(source).toContain(`contentContainerStyle={styles.${rail.contentStyle}}`);
      expect(source).toContain(`style={styles.${rail.scrollStyle}}`);
    });
  }
});
