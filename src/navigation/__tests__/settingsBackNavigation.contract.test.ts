/**
 * Static back-navigation contract for the More tab.
 *
 * Every row in the More list opens a screen registered in `SettingsNavigator`,
 * and that navigator sets `headerShown: false` — so a destination that forgets
 * to draw its own header is a dead end with no way back. Two rules keep the
 * list consistent, and both are the kind of thing a new screen silently gets
 * wrong:
 *
 *  1. **Every registered screen draws a back affordance** — `ScreenHeader` with
 *     `showBackButton`, or one of the shells that wraps it (`EnrolmentShell`,
 *     `AIFlowScaffold`). Without it the member is stranded on the screen.
 *
 *  2. **It pops with `navigation.goBack()`, never `router.back()`.** The More
 *     tab mounts this navigator inside a `NavigationIndependentTree`
 *     (`app/(tabs)/settings.tsx`), so expo-router's `router` addresses the ROOT
 *     stack. A `router.back()` back button therefore leaves the More tab rather
 *     than popping the screen the member is looking at — it *looks* wired and
 *     is not, which is exactly why this is a test and not a code review note.
 *
 * Screens mounted BOTH here and at an `app/` route (e.g. the persona settings
 * screen) still satisfy rule 2: `useNavigation()` resolves to whichever stack
 * actually holds the screen, so `goBack()` is correct in both contexts while
 * `router.back()` is only correct in one.
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const NAVIGATOR = path.join(REPO_ROOT, 'src/navigation/SettingsNavigator.tsx');

/** tsconfig `paths` entries this navigator's imports actually use. */
const ALIASES: Record<string, string> = {
  '@components': 'src/components',
  '@features': 'src/features',
  '@navigation': 'src/navigation',
  '@screens': 'src/screens',
};

/** Shells that draw a `ScreenHeader` with a back button on their child's behalf. */
const HEADER_SHELLS = ['EnrolmentShell', 'AIFlowScaffold', 'HealthSettingsShell'];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function resolveFile(base: string): string | null {
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, 'index.tsx'),
    path.join(base, 'index.ts'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** `@screens/ai` / `./types` / … → an absolute file path, or null. */
function resolveModule(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) {
    return resolveFile(path.resolve(path.dirname(fromFile), spec));
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (spec === alias || spec.startsWith(`${alias}/`)) {
      const rest = spec.slice(alias.length).replace(/^\//, '');
      return resolveFile(path.join(REPO_ROOT, target, rest));
    }
  }
  return null;
}

/** identifier → module specifier, for every named import in `src`. */
function importMap(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) map.set(name, m[2]);
    }
  }
  return map;
}

/**
 * Follow a barrel file's `export { Name } from './X'` to the file that actually
 * defines `Name`. Barrels are how half this navigator imports its screens.
 */
function definitionFile(name: string, file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return file;
  seen.add(file);
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  if (new RegExp(`(function|const|class)\\s+${name}\\b`).test(src)) return file;

  const re = /export\s+\{([^}]+)\}\s+from\s+'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()?.trim());
    if (!names.includes(name)) continue;
    const next = resolveModule(m[2], file);
    if (next) return definitionFile(name, next, seen);
  }
  return file;
}

const navigatorSrc = fs.readFileSync(NAVIGATOR, 'utf8');
const navigatorImports = importMap(navigatorSrc);

/**
 * Every component the navigator registers. `component={X}` covers the declared
 * screens; `SettingsScreen` is rendered inline as `SettingsMain` and is the More
 * list itself (a tab root — it has no back button, and is excluded below).
 */
const registered = Array.from(
  new Set(
    Array.from(stripComments(navigatorSrc).matchAll(/component=\{(\w+)\}/g)).map((m) => m[1])
  )
);

/** Aliases assigned in the navigator body, e.g. `const HouseholdRootScreen = …`. */
function resolveIdentifier(name: string): string[] {
  if (navigatorImports.has(name)) return [name];
  const assignment = new RegExp(`const\\s+${name}\\s*=([\\s\\S]*?);`).exec(navigatorSrc);
  if (!assignment) return [];
  return Array.from(new Set(assignment[1].match(/\b\w+Screen\b/g) ?? [])).filter((n) =>
    navigatorImports.has(n)
  );
}

const screenFiles = new Map<string, string>();
for (const identifier of registered) {
  for (const name of resolveIdentifier(identifier)) {
    const spec = navigatorImports.get(name);
    if (!spec) continue;
    const entry = resolveModule(spec, NAVIGATOR);
    if (!entry) continue;
    screenFiles.set(name, definitionFile(name, entry));
  }
}

const sources = Array.from(screenFiles.entries()).map(([name, file]) => ({
  name,
  file,
  rel: path.relative(REPO_ROOT, file),
  src: stripComments(fs.readFileSync(file, 'utf8')),
}));

/**
 * Does this file put a back button on screen — itself, through a shell, or
 * through the screen it delegates to?
 *
 * The third case is real: `SoftTransferFlowRouteScreen` exists only to turn
 * route params into props for `SoftTransferFlowScreen`, which draws the header.
 * A wrapper is followed one screen at a time (bounded, so a cycle can't hang
 * the suite) rather than being exempted, so a wrapper around a HEADERLESS
 * screen still fails.
 */
function hasBackAffordance(file: string, depth = 0): boolean {
  if (depth > 3) return false;
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  if (/<ScreenHeader[\s\S]*?showBackButton/.test(src)) return true;
  if (HEADER_SHELLS.some((shell) => new RegExp(`<${shell}\\b`).test(src))) return true;

  const imports = importMap(src);
  for (const rendered of new Set(Array.from(src.matchAll(/<(\w+Screen)\b/g)).map((m) => m[1]))) {
    const spec = imports.get(rendered);
    if (!spec) continue;
    const entry = resolveModule(spec, file);
    if (entry && hasBackAffordance(definitionFile(rendered, entry), depth + 1)) return true;
  }
  return false;
}

describe('More tab back-navigation contract', () => {
  it('resolves every screen the Settings stack registers', () => {
    // A resolver that silently finds nothing would make both cases below pass.
    expect(registered.length).toBeGreaterThan(20);
    expect(screenFiles.size).toBeGreaterThanOrEqual(registered.length - 1);
  });

  it('gives every registered screen a back affordance', () => {
    // Offenders are listed by path: the failure names the screen to fix rather
    // than reporting "expected true, got false" against an anonymous case.
    const stranded = sources
      .filter(({ file }) => !hasBackAffordance(file))
      .map(({ rel }) => rel);

    // Every entry here is registered under `headerShown: false` and renders no
    // ScreenHeader with showBackButton and no header shell — opening it from
    // the More list strands the member with no way back.
    expect(stranded).toEqual([]);
  });

  it('pops the Settings stack with goBack(), never expo-router back()', () => {
    const wrongRouter = sources
      .filter(({ src }) => /onBackPress=\{\(\)\s*=>\s*router\.back\(\)\}/.test(src))
      .map(({ rel }) => rel);

    // Every entry here pops with expo-router's `router.back()`. The More tab
    // mounts this stack in a NavigationIndependentTree, so `router` addresses
    // the ROOT stack and the back button leaves the tab instead of popping the
    // screen. Use `navigation.goBack()`.
    expect(wrongRouter).toEqual([]);
  });
});
