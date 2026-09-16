/**
 * Symply Language widget/watch snapshot contract.
 *
 * The app writes `widget_language_today` + `watch_language_today` and the two
 * native surfaces decode them: `LanguageWidgetData` (widget) and
 * `LanguageWatchSnapshot` (watch). Nothing in the JS suite could previously see
 * across that boundary, so the two drifted: the widget declared `xp`/`xp_goal`
 * as non-optional `let`s with the synthesized `Codable` init, the app never
 * wrote them, and `JSONDecoder` threw `keyNotFound` on every real payload.
 * `load()`'s `try?` swallowed the throw, so every signed-in learner saw the
 * "Sign in to track your streak" empty state and no test failed.
 *
 * **Updated 2026-08-10.** The producer moved out of `LanguageLearnScreen` into
 * `src/features/language/languageWidgetSnapshot.ts`, because a screen-bound writer
 * never runs for a signed-in learner who has not finished onboarding (`app/_layout.tsx`
 * withholds the tab shell until then) — and because `watch_language_today` had no
 * writer at all. The payloads are now also explicitly DIFFERENT (`xp` vs `xp_today`),
 * so the written-key sets are asserted per surface rather than as one shared list.
 *
 * These are source-contract assertions (same approach as
 * widget-sync-app-group.test.ts) — they cannot run Swift, but they do pin the
 * two properties that would have caught the defect:
 *   1. every field the native models decode is decoded leniently, so a missing
 *      key degrades one value instead of nulling the whole snapshot;
 *   2. every key the app actually writes is a key the native side knows about.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

/** Body of a `struct <name>` … up to the matching close at column 0. */
function structBody(swift: string, name: string): string {
  const start = swift.indexOf(`struct ${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = swift.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end);
}

/** `case foo = "foo_bar"` / `case foo` → wire key. */
function codingKeys(structSrc: string): string[] {
  const block = structSrc.slice(structSrc.indexOf('enum CodingKeys'));
  return [...block.matchAll(/case\s+(\w+)(?:\s*=\s*"([^"]+)")?/g)].map((m) => m[2] ?? m[1]);
}

/** Body of an exported TS function, up to the closing brace at column 0. */
function fnBody(ts: string, name: string): string {
  const start = ts.indexOf(`export function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = ts.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('Language snapshot contract — app ⇄ widget/watch', () => {
  const producer = read('src/features/language/languageWidgetSnapshot.ts');
  const widget = read('ios/SymplyEcosystemWidget/SymplyLanguageWidgetContent.swift');
  const watch = read('ios/SymplyEcosystemWatch/Views/SymplyLanguageWatchView.swift');

  /** The keys each shape actually writes into the App Group. */
  const widgetWrittenKeys = ['streak', 'xp', 'xp_goal', 'words_due', 'next_lesson'];
  const watchWrittenKeys = ['streak', 'xp_today', 'xp_goal', 'words_due', 'next_lesson'];

  it('the producer writes both keys the native surfaces read', () => {
    // Screen-independent: a producer bound to a screen cannot run before onboarding
    // completes, which is the defect this module was extracted to fix.
    expect(producer).toContain("LANGUAGE_WIDGET_KEY = 'widget_language_today'");
    expect(producer).toContain("LANGUAGE_WATCH_KEY = 'watch_language_today'");
    expect(producer).toMatch(/setSnapshot\(LANGUAGE_WIDGET_KEY/);
    expect(producer).toMatch(/setSnapshot\(LANGUAGE_WATCH_KEY/);
  });

  it('each shape emits exactly the keys its own decoder expects', () => {
    const widgetShape = fnBody(producer, 'toLanguageWidgetSnapshot');
    const watchShape = fnBody(producer, 'toLanguageWatchSnapshot');

    for (const key of widgetWrittenKeys) {
      expect(widgetShape).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
    for (const key of watchWrittenKeys) {
      expect(watchShape).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
    // The shapes genuinely differ — guard the easy copy-paste mistake.
    expect(watchShape).not.toMatch(/\bxp\s*:/);
    expect(widgetShape).not.toMatch(/\bxp_today\s*:/);
  });

  it('the widget decodes every field leniently (regression: xp/xp_goal keyNotFound)', () => {
    const body = structBody(widget, 'LanguageWidgetData');

    // A hand-written init is what makes a missing key survivable. Without it
    // Swift synthesizes one that throws on the first absent non-optional field.
    expect(body).toMatch(/init\(from decoder: Decoder\) throws/);

    // Every CodingKey must be decoded with `try?` — never a bare `try c.decode`.
    for (const key of codingKeys(body)) {
      const prop = key.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
      expect(body).toMatch(new RegExp(`(try\\? c\\.decode[^\\n]*\\.${prop}\\b)`));
    }
    expect(body).not.toMatch(/^\s*\w+\s*=\s*try c\.decode/m);
  });

  it('the watch decodes every field leniently', () => {
    const body = structBody(watch, 'LanguageWatchSnapshot');
    expect(body).toMatch(/init\(from decoder: Decoder\) throws/);
    expect(body).not.toMatch(/^\s*\w+\s*=\s*try c\.decode/m);
  });

  it('every key the app writes is known to its native decoder', () => {
    const widgetKeys = codingKeys(structBody(widget, 'LanguageWidgetData'));
    const watchKeys = codingKeys(structBody(watch, 'LanguageWatchSnapshot'));

    for (const key of widgetWrittenKeys) {
      expect(widgetKeys).toContain(key);
    }
    for (const key of watchWrittenKeys) {
      expect(watchKeys).toContain(key);
    }
  });

  it('the widget still gates its XP tiles — Language has no XP source', () => {
    // XP is now WRITTEN (as a literal 0) rather than omitted, which is what keeps
    // the payload complete for a strict decoder. But Language genuinely has no XP
    // model — its daily unit is three booleans — so the gate must stay, or both
    // layouts render a meaningless "0/0" on every real snapshot.
    expect(widget).toMatch(/var hasXP: Bool/);
    expect(widget).toMatch(/d\.hasXP/);
    expect(fnBody(producer, 'toLanguageWidgetSnapshot')).toMatch(/xp:\s*0/);
    expect(fnBody(producer, 'toLanguageWatchSnapshot')).toMatch(/xp_today:\s*0/);
  });
});
