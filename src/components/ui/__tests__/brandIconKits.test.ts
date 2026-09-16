/**
 * On-disk integrity coverage for the per-brand PNG icon kits produced by the
 * brush-icon extraction (see the brand-icon-kit pipeline).
 *
 * The committed `icons.generated.ts` require-map is regenerated per `APP_BRAND`
 * at build time and only ever holds ONE brand (House by default), so the
 * render-contract tests in Icon.test.tsx can't see the other four kits. A
 * half-copied state, a typo'd tab `brandIcon`, or a truncated PNG would ship
 * silently. This suite guards every brand's kit on disk instead.
 */
/// <reference types="node" />
import fs from 'fs';
import path from 'path';

const BRANDS_DIR = path.resolve(__dirname, '../../../../brands');
const CORE_STATES = ['selected', 'unselected-dark', 'unselected-light'] as const;

const kitPath = (brand: string, state: string) =>
  path.join(BRANDS_DIR, brand, 'src/assets/icons/png', state);

const hasKit = (brand: string) => fs.existsSync(kitPath(brand, 'selected'));

const names = (brand: string, state: string): string[] =>
  fs.existsSync(kitPath(brand, state))
    ? fs
        .readdirSync(kitPath(brand, state))
        .filter(f => f.endsWith('.png'))
        .map(f => f.replace(/\.png$/, ''))
    : [];

const brandIconOverrides = (brand: string): string[] => {
  const cfg = fs.readFileSync(path.join(BRANDS_DIR, brand, 'brand.cjs'), 'utf8');
  return [...cfg.matchAll(/["']?brandIcon["']?\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
};

const BRANDS = fs.readdirSync(BRANDS_DIR).filter(hasKit).sort();

describe('brand icon kits — on-disk integrity', () => {
  it('ships a kit for each of the five ecosystem brands', () => {
    expect(BRANDS).toEqual(
      expect.arrayContaining([
        'symply-budget',
        'symply-health',
        'symply-house',
        'symply-kaizen',
        'symply-language',
      ]),
    );
  });

  describe.each(BRANDS)('%s', brand => {
    const selected = new Set(names(brand, 'selected'));

    it('has a non-empty selected kit', () => {
      expect(selected.size).toBeGreaterThan(0);
    });

    it('unselected-dark / unselected-light mirror the selected name set exactly', () => {
      expect(new Set(names(brand, 'unselected-dark'))).toEqual(selected);
      expect(new Set(names(brand, 'unselected-light'))).toEqual(selected);
    });

    it('filled-accent (when present) is a subset of selected', () => {
      for (const n of names(brand, 'filled-accent')) {
        expect(selected.has(n)).toBe(true);
      }
    });

    it('every core-state PNG is a non-empty file', () => {
      for (const state of CORE_STATES) {
        for (const n of names(brand, state)) {
          const size = fs.statSync(path.join(kitPath(brand, state), `${n}.png`)).size;
          expect(size).toBeGreaterThan(0);
        }
      }
    });

    it('every tab brandIcon override resolves to a kit icon', () => {
      for (const override of brandIconOverrides(brand)) {
        expect(selected.has(override)).toBe(true);
      }
    });
  });
});

describe('symply-budget kit — no fragments cut in from a neighbouring tile', () => {
  /**
   * The sheet extractor cuts each glyph out of a painted contact sheet, and a
   * cut that lands wide drags in a piece of the icon next door. It shipped:
   * `utilities` carried a scrap under the droplet, `transport` an arc over the
   * car, `shopping` two marks below the bag. Worse, the damage was invisible in
   * the name-set checks above — the files exist and are non-empty — and it
   * compounded, because trim-and-centre then fitted "glyph + scrap" into the
   * inner box, leaving the real glyph undersized and off-centre.
   *
   * Scoped to symply-budget: the other kits lean on detached decoration
   * (kaizen `widget-mark` is a grid, `voice` a waveform, house `search` has
   * motion lines) that this rule cannot tell from a foreign scrap.
   * `scripts/icon-gen/repair-stray-fragments.mjs` fixes what this catches.
   */
  const CANVAS_GAP = 0.1; // clear canvas that marks a blob as foreign
  const CORE_SHARE = 0.15;

  /** Ink blobs (4-connected over alpha) with their pixel counts and boxes. */
  const blobsOf = (file: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node-only test helper
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(fs.readFileSync(file));
    const { width: w, height: h, data } = png;
    const on = (i: number) => data[i * 4 + 3] > 24;
    const lab = new Int32Array(w * h).fill(-1);
    const out: Array<{ count: number; box: number[] }> = [];
    for (let s = 0; s < w * h; s++) {
      if (!on(s) || lab[s] !== -1) continue;
      const id = out.length;
      let count = 0;
      let x0 = w;
      let y0 = h;
      let x1 = -1;
      let y1 = -1;
      const stack = [s];
      lab[s] = id;
      while (stack.length) {
        const p = stack.pop() as number;
        count++;
        const x = p % w;
        const y = Math.floor(p / w);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && on(q) && lab[q] === -1) {
            lab[q] = id;
            stack.push(q);
          }
        }
      }
      out.push({ count, box: [x0, y0, x1, y1] });
    }
    return { blobs: out, size: w };
  };

  const straysIn = (file: string): number[][] => {
    const { blobs, size } = blobsOf(file);
    if (blobs.length < 2) return [];
    const total = blobs.reduce((n, b) => n + b.count, 0);
    const core = blobs.filter(b => b.count / total >= CORE_SHARE);
    if (!core.length) return [];
    const cx0 = Math.min(...core.map(b => b.box[0]));
    const cy0 = Math.min(...core.map(b => b.box[1]));
    const cx1 = Math.max(...core.map(b => b.box[2]));
    const cy1 = Math.max(...core.map(b => b.box[3]));
    const gap = size * CANVAS_GAP;
    return blobs
      .filter(b => b.count / total < CORE_SHARE)
      .filter(b => {
        const [x0, y0, x1, y1] = b.box;
        return x1 < cx0 - gap || x0 > cx1 + gap || y1 < cy0 - gap || y0 > cy1 + gap;
      })
      .map(b => b.box);
  };

  it('leaves no orphan fragment in any selected-state glyph', () => {
    const damaged = names('symply-budget', 'selected')
      .map(n => ({ n, strays: straysIn(path.join(kitPath('symply-budget', 'selected'), `${n}.png`)) }))
      .filter(r => r.strays.length);

    expect(damaged.map(r => `${r.n} ${JSON.stringify(r.strays)}`)).toEqual([]);
  });

  it('composes every glyph to fill the kit box, so none reads half-size', () => {
    // A glyph whose ink spans well under the ~85% inner box is the tell-tale of
    // a fragment having stretched the trim box before it was centred.
    const undersized = names('symply-budget', 'selected')
      .map(n => {
        const { blobs, size } = blobsOf(path.join(kitPath('symply-budget', 'selected'), `${n}.png`));
        const w = Math.max(...blobs.map(b => b.box[2])) - Math.min(...blobs.map(b => b.box[0])) + 1;
        const h = Math.max(...blobs.map(b => b.box[3])) - Math.min(...blobs.map(b => b.box[1])) + 1;
        return { n, span: Math.max(w, h) / size };
      })
      .filter(r => r.span < 0.7);

    expect(undersized.map(r => `${r.n} @ ${Math.round(r.span * 100)}%`)).toEqual([]);
  });
});

describe('header notification bell — branded in every kit', () => {
  // The header renders <Icon name="notifications" active> in all apps. Regression
  // guards: House once shipped no bell, and Kaizen's file was `notification`
  // (singular) so it never resolved and fell back to a generic Ionicons bell.
  it.each(BRANDS)('%s ships a "notifications" icon in all core states', brand => {
    for (const state of CORE_STATES) {
      expect(names(brand, state)).toContain('notifications');
    }
  });
});

describe('info icon — branded in every kit', () => {
  // Every `<Icon name="information-circle"/>` / "-outline" call site across the
  // app resolves through ioniconAliases to this brush-kit slug; without it they
  // all silently fall back to the generic (filled) Ionicons glyph.
  it.each(BRANDS)('%s ships an "information" icon in all core states', brand => {
    for (const state of CORE_STATES) {
      expect(names(brand, state)).toContain('information');
    }
  });

  it('aliases both information-circle glyph variants to the kit slug', () => {
    const { aliasToBrandIcon } = require('../ioniconAliases');
    expect(aliasToBrandIcon('information-circle')).toBe('information');
    expect(aliasToBrandIcon('information-circle-outline')).toBe('information');
    expect(aliasToBrandIcon('information')).toBe('information');
  });
});

describe('symply-language kit — brush-icon refresh', () => {
  const selected = new Set(names('symply-language', 'selected'));

  it('exposes 112 icons across the three core states', () => {
    for (const state of CORE_STATES) {
      expect(names('symply-language', state)).toHaveLength(112);
    }
  });

  it('adds the dialogue-scenario glyphs (medkit, hotel) in all core states', () => {
    for (const state of CORE_STATES) {
      expect(names('symply-language', state)).toEqual(
        expect.arrayContaining(['medkit', 'hotel']),
      );
    }
  });

  it('adds the 13 new glyphs extracted from the sheets', () => {
    for (const n of [
      'dictionary',
      'quiz',
      'translate',
      'conjugation',
      'phrases',
      'alphabet',
      'flashcards',
      'xp-points',
      'badge',
      'offline-download',
      'favorites',
      'leaderboard',
      'lessons',
    ]) {
      expect(selected.has(n)).toBe(true);
    }
  });

  it('keeps the refreshed core names and the preserved learning-plan', () => {
    for (const n of ['learn', 'teaching-chat', 'vocabulary', 'grammar', 'streak', 'learning-plan']) {
      expect(selected.has(n)).toBe(true);
    }
  });

  it('backs both Language tab overrides (learn, teaching-chat) with kit art', () => {
    const overrides = brandIconOverrides('symply-language');
    expect(overrides).toEqual(
      expect.arrayContaining(['learn', 'teaching-chat'])
    );
    for (const override of overrides) {
      expect(selected.has(override)).toBe(true);
    }
  });
});
