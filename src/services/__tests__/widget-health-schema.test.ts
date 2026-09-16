/**
 * Symply Health widget + watch data contract — source-text guard.
 *
 * The RN app and the Swift widget/watch targets are compiled separately and
 * share nothing but a JSON payload in the App Group. Nothing type-checks across
 * that boundary, so this suite reads both sides as *text* (the pattern in
 * widget-sync-app-group.test.ts) and pins the contract they currently agree
 * (and disagree) on.
 *
 * Several rows below pin known DEFECTS. They assert the CURRENT behaviour on
 * purpose so the suite stays green, and each carries a `// DEFECT (...)` note
 * describing what should happen instead. Any change to either side flips these
 * red, which is the point.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

const WIDGET_SWIFT = path.join(root, 'ios/SymplyEcosystemWidget/SymplyHealthWidgetContent.swift');
const WATCH_SWIFT = path.join(root, 'ios/SymplyEcosystemWatch/Views/SymplyHealthWatchView.swift');
const TOKENS_SWIFT = path.join(root, 'ios/SymplyEcosystemWidget/DesignTokens.generated.swift');
const SYNC_MODULE_SWIFT = path.join(root, 'modules/widget-sync/ios/WidgetSyncModule.swift');
const HEALTH_HOME_SCREEN = path.join(root, 'src/features/health/screens/HealthHomeScreen.tsx');

const read = (p: string) => fs.readFileSync(p, 'utf8');

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Extract the wire keys (raw values) declared by a Swift `CodingKeys` enum.
 * `case steps` → "steps"; `case stepsGoal = "steps_goal"` → "steps_goal".
 */
function parseCodingKeys(swift: string): string[] {
  const block = swift.match(/enum CodingKeys:\s*String,\s*CodingKey\s*\{([\s\S]*?)\n\s*\}/);
  if (!block) throw new Error('no CodingKeys enum found');
  const keys: string[] = [];
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*case\s+(\w+)\s*(?:=\s*"([^"]+)")?\s*$/);
    if (m) keys.push(m[2] ?? m[1]);
  }
  return keys;
}

/** Swift property name → declared type, for the properties of a Codable struct. */
function parseStructProperties(swift: string, structName: string): Record<string, string> {
  const block = swift.match(new RegExp(`struct ${structName}\\s*:\\s*Codable\\s*\\{([\\s\\S]*?)\\n\\s{4}enum CodingKeys`));
  if (!block) throw new Error(`no Codable struct ${structName} found`);
  const props: Record<string, string> = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*let\s+(\w+):\s*([\w.]+)\??\s*$/);
    if (m) props[m[1]] = m[2];
  }
  return props;
}

/**
 * Top-level keys of the object literal a mapper RETURNS.
 *
 * `anchor` is any text immediately preceding the literal — e.g. the mapper's
 * signature. Reading the returned object rather than the interface proves what
 * is actually SERIALISED: a field can be declared and never assigned.
 */
function parseReturnedObjectKeys(source: string, anchor: string): string[] {
  const start = source.indexOf(anchor);
  if (start < 0) throw new Error(`anchor not found: ${anchor}`);
  const braceStart = source.indexOf('return {', start) + 'return '.length;
  if (braceStart < 'return '.length) throw new Error(`no returned literal after: ${anchor}`);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(braceStart + 1, end);
  // Only depth-0 keys of this literal. Both `water_ml: …` and the ES6 shorthand
  // `steps,` count — missing the shorthand form would silently under-report the
  // writer and manufacture a reader/writer gap that does not exist. A nested
  // object (`next_reminder: { … }`) contributes only its own key.
  const keys: string[] = [];
  let nested = 0;
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*(?::|,\s*$)/);
    if (m && nested === 0) keys.push(m[1]);
    nested += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
  }
  return keys;
}

/**
 * Every key `widgetSync.setSnapshot` is called with in a file.
 *
 * Call sites use BOTH string literals (`setSnapshot('widget_health_today', …)`)
 * and exported constants (`setSnapshot(HEALTH_WATCH_KEY, …)`), so an identifier
 * argument is resolved against a `const NAME = '…'` binding in the same file.
 * A literal-only scan is how `watch_health_today` acquired its first writer
 * while the WATCH-005 guard below stayed green — the writer passes a constant.
 */
function parseSnapshotKeys(source: string): string[] {
  const keys: string[] = [];
  for (const call of source.matchAll(
    /\.setSnapshot\(\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))/g,
  )) {
    const literal = call[1] ?? call[2];
    if (literal) {
      keys.push(literal);
      continue;
    }
    const bound = source.match(
      new RegExp(`\\b(?:const|let|var)\\s+${call[3]}\\s*(?::[^=]+)?=\\s*['"]([^'"]+)['"]`),
    );
    // An unresolvable identifier fails loudly rather than shrinking the guard.
    if (!bound) throw new Error(`setSnapshot(${call[3]}, …) does not resolve to a local constant`);
    keys.push(bound[1]);
  }
  return keys;
}

/** The string literals inside `Function("clear") { … }`'s removeObject allowlist. */
function parseClearAllowlist(swift: string): string[] {
  const block = swift.match(/Function\("clear"\)\s*\{([\s\S]*?)removeObject/);
  if (!block) throw new Error('no clear() allowlist found');
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Every JS/TS source file under the app's own trees. */
function listJsTsFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', 'build', 'dist', 'coverage', '__snapshots__']);
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(full);
      } else if (/\.(ts|tsx|js|jsx|cjs|mjs)$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  ['src', 'app', 'modules'].forEach((d) => walk(path.join(root, d)));
  return out;
}

// ---------------------------------------------------------------------------
// WIDGET-022 — reader/writer field drift on `widget_health_today`
// ---------------------------------------------------------------------------

describe('WIDGET-022 — widget_health_today reader vs writer schema', () => {
  const readerKeys = parseCodingKeys(read(WIDGET_SWIFT));
  const PUBLISHER = path.join(root, 'src/features/health/healthWidgetStorage.ts');

  it('WIDGET-022: the Swift widget declares exactly 12 wire fields', () => {
    // Widened 2026-07-29: the widget now also carries weight, nutrition and
    // workouts (+ their weekly trends) and the layout `preferences` block —
    // see the file header of `healthWidgetStorage.ts` ("The widget now
    // carries weight, nutrition and workouts — deliberately").
    expect(readerKeys).toEqual([
      'steps',
      'steps_goal',
      'water_ml',
      'water_goal_ml',
      'move_pct',
      'next_reminder',
      'weight',
      'weight_trend',
      'nutrition',
      'nutrition_trend',
      'workouts',
      'preferences',
    ]);
    expect(readerKeys).toHaveLength(12);
  });

  it('WIDGET-022: Home no longer builds the payload inline — it delegates to ONE publisher', () => {
    // WAS a pinned DEFECT: Home used to construct `{ water_ml, water_goal_ml }`
    // (and later five of six fields) directly in a `setSnapshot` call, which is
    // how the watch key went unwritten for so long — a second producer was never
    // built because there was no shared place to put one. Fixed 2026-07-26: Home
    // now hands named FACTS to `publishHealthGlance`, which is the only place
    // that maps a fact onto either native contract.
    const home = read(HEALTH_HOME_SCREEN);
    expect(home).toContain('publishHealthGlance({');
    expect(home).not.toMatch(/setSnapshot\(/);
    // The facts Home supplies, verbatim — steps/goal pass through, water
    // converts cups→ml, move is pre-clamped into a fraction by `moveFraction`.
    expect(home).toMatch(/waterMl:\s*\(waterDay\.cups \?\? 0\) \* CUP_ML/);
    expect(home).toMatch(/waterGoalMl:\s*\(waterDay\.target \?\? DEFAULT_WATER_TARGET\) \* CUP_ML/);
    expect(home).toMatch(/movePct:\s*moveFraction\(moveMinutes, activityGoals\.minutes\)/);
  });

  it('WIDGET-022: the publisher declares the FULL six-field payload — next_reminder included', () => {
    // `healthWidgetStorage.ts` (2026-07-26) closed the last gap: its
    // `HealthWidgetPayload` interface is the widget's schema, field for field,
    // and `toHealthWidgetPayload` actually POPULATES `next_reminder` from
    // whichever fact object it is given (Home passes none explicitly, so
    // `publishHealthGlance` falls back to the reminder-scheduler mirror).
    // Parsed from the interface AND the mapper's return, so a field declared but
    // never assigned would still be caught.
    const module = read(PUBLISHER);
    const iface = module.match(/export interface HealthWidgetPayload \{([\s\S]*?)\n\}/);
    expect(iface).not.toBeNull();
    const declaredKeys = [...iface![1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    expect([...declaredKeys].sort()).toEqual([...readerKeys].sort());

    const mapperKeys = parseReturnedObjectKeys(module, 'export function toHealthWidgetPayload');
    expect([...mapperKeys].sort()).toEqual([...readerKeys].sort());
  });
});

// ---------------------------------------------------------------------------
// WIDGET-023 — generated brand tokens baked into the widget target
// ---------------------------------------------------------------------------

describe('WIDGET-023 — DesignTokens.generated.swift brand identity', () => {
  const tokens = read(TOKENS_SWIFT);
  const KNOWN_APP_KEYS = ['house', 'budget', 'kaizen', 'language', 'health'];

  it('WIDGET-023: declares a BrandTokens.appKey naming one of the five fleet brands', () => {
    const m = tokens.match(/static let appKey = "([^"]+)"/);
    expect(m).not.toBeNull();
    const appKey = m![1];

    // DEFECT (HEALTH-WIDGET-023): this file is a build artefact of
    // `APP_BRAND=… npm run design:build` and is COMMITTED, so whichever brand
    // was built last wins for everyone. It is currently baked to "budget"
    // (header: APP_BRAND=symply-budget, appGroup group.com.symply.budget), which
    // means a Health widget built from a clean checkout picks up Budget's green
    // palette and Budget's App Group. It should either be generated per-brand at
    // build time and gitignored, or the widget should read the brand at runtime.
    //
    // Asserting membership rather than the literal "budget" keeps this stable
    // across local brand builds while still failing if the generator drifts to
    // an unknown key.
    expect(KNOWN_APP_KEYS).toContain(appKey);

    // Whatever brand it is baked to, the three identity fields must agree with
    // each other — a mixed bake is always a bug.
    const brandId = tokens.match(/static let brandId = "([^"]+)"/)![1];
    const appGroup = tokens.match(/static let appGroup = "([^"]+)"/)![1];
    expect(brandId).toBe(`symply-${appKey}`);
    expect(appGroup).toBe(`group.com.symply.${appKey}`);
  });
});

// ---------------------------------------------------------------------------
// WATCH-005 — nobody writes the watch snapshot
// ---------------------------------------------------------------------------

describe('WATCH-005 — watch_health_today finally has a writer', () => {
  const KEY = 'watch_health_today';
  const PUBLISHER = path.join(root, 'src/features/health/healthWidgetStorage.ts');

  it('WATCH-005: the Swift watch view declares it as its App Group key', () => {
    const watch = read(WATCH_SWIFT);
    expect(watch).toContain(`static let appGroupKey = "${KEY}"`);
    expect(watch).toMatch(/AppGroup\.defaults\.data\(forKey: appGroupKey\)/);
  });

  it('WATCH-005: exactly one JS/TS module declares the key, and it is the publisher', () => {
    const sources = listJsTsFiles().filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));

    // A "writer" is a real code occurrence of the key — doc-comment prose that
    // merely names the key (e.g. budgetSnapshot.ts explaining the same gap for
    // its own brand) is not.
    const isCommentLine = (line: string) => /^\s*(\/\/|\/\*|\*|\|)/.test(line);
    const writers = sources
      .filter((f) =>
        read(f)
          .split('\n')
          .some((line) => line.includes(KEY) && !isCommentLine(line)),
      )
      .map((f) => path.relative(root, f));

    // WAS a P1 DEFECT (HEALTH-WATCH-005): the Apple Watch face decoded
    // `watch_health_today` but nothing in JS ever wrote it, so the view could
    // only ever render its SymplyEmptyState. Closed 2026-07-26 by
    // `healthWidgetStorage.publishHealthGlance`, which writes BOTH App Group
    // keys from one set of facts. Pinned to a SINGLE writer: a second publisher
    // means two code paths can disagree about the same day on a lock screen.
    expect(writers).toEqual(['src/features/health/healthWidgetStorage.ts']);
  });

  it('WATCH-005: the publisher really calls setSnapshot with the watch key', () => {
    // The call site passes a CONSTANT, which a literal-only scan cannot see —
    // exactly how this guard stayed green through the gap. `parseSnapshotKeys`
    // resolves local bindings, so both keys are visible here.
    const keys = parseSnapshotKeys(read(PUBLISHER));
    expect(keys).toEqual(['widget_health_today', 'watch_health_today']);
  });

  it('WATCH-005: every watch_* key any app writes is in the logout wipe', () => {
    // The privacy half of shipping a watch writer: a household-scoped snapshot
    // that survives sign-out shows the next person on the handset the previous
    // member's day (the WATCH-014 class of bug).
    const cleared = parseClearAllowlist(read(SYNC_MODULE_SWIFT));
    // The wrapper itself declares `setSnapshot(key, …)` — a forwarder, not a
    // call site, and its `key` parameter is unresolvable by design.
    const wrapper = path.join(root, 'src/services/widget-sync.ts');
    const written = listJsTsFiles()
      .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`) && f !== wrapper)
      .flatMap((f) => parseSnapshotKeys(read(f)));

    expect(written).toContain(KEY);
    expect(written.filter((k) => !cleared.includes(k))).toEqual([]);
  });

  it('WATCH-005: the widget target does not read the watch key', () => {
    const swiftMentions = [WATCH_SWIFT, SYNC_MODULE_SWIFT].filter((f) => read(f).includes(KEY));
    expect(swiftMentions).toHaveLength(2);
    // Two keys, two schemas — conflating them is WATCH-015.
    expect(read(WIDGET_SWIFT)).not.toContain(KEY);
  });
});

// ---------------------------------------------------------------------------
// WATCH-014 — the logout wipe allowlist
// ---------------------------------------------------------------------------

describe('WATCH-014 — WidgetSyncModule clear() allowlist coverage', () => {
  const allowlist = parseClearAllowlist(read(SYNC_MODULE_SWIFT));

  it('WATCH-014: contains every brand widget_* snapshot key', () => {
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'widget_home_insight',
        'widget_tasks',
        'widget_updated_at',
        'widget_budget_summary',
        'widget_kaizen_today',
        'widget_language_today',
        'widget_health_today',
      ]),
    );
  });

  it('WATCH-014: also wipes the auth identity keys', () => {
    expect(allowlist).toEqual(
      expect.arrayContaining(['auth_token', 'companion_token', 'current_household_id', 'user_id']),
    );
  });

  it('WATCH-014: the allowlist DOES currently include the watch_* keys', () => {
    const watchKeys = allowlist.filter((k) => k.startsWith('watch_'));

    // NOTE (HEALTH-WATCH-014): the matrix row was written against an earlier
    // revision in which clear() covered only `widget_*` keys, leaving
    // household-scoped watch snapshots alive after sign-out. That gap is already
    // closed in the current source — all four brands' `watch_*` keys are wiped —
    // so this row asserts the (correct) present-day behaviour rather than the
    // historic defect. It is kept as a regression guard: dropping a watch key
    // from the allowlist would resurrect the privacy leak.
    expect(watchKeys).toEqual([
      'watch_budget_today',
      'watch_kaizen_today',
      'watch_language_today',
      'watch_health_today',
    ]);
  });
});

// ---------------------------------------------------------------------------
// WATCH-015 — the watch and widget schemas are not the same schema
// ---------------------------------------------------------------------------

describe('WATCH-015 — watch and widget Health schemas disagree', () => {
  const watchSwift = read(WATCH_SWIFT);
  const widgetSwift = read(WIDGET_SWIFT);

  const watchKeys = parseCodingKeys(watchSwift);
  const widgetKeys = parseCodingKeys(widgetSwift);
  const watchProps = parseStructProperties(watchSwift, 'HealthTodaySnapshot');
  const widgetProps = parseStructProperties(widgetSwift, 'HealthWidgetData');

  it('WATCH-015: the watch declares its own 8-field snake_case schema', () => {
    expect(watchKeys).toEqual([
      'move_goal_percent',
      'steps',
      'steps_goal',
      'water_ml',
      'water_goal_ml',
      'next_reminder',
      'next_reminder_time',
      'date',
    ]);
  });

  it('WATCH-015: move progress uses a different key and a different type on each side', () => {
    // DEFECT (HEALTH-WATCH-015): the watch and the widget describe the same
    // "today" snapshot but do not share a schema — a single writer cannot
    // satisfy both. They should be unified behind one contract (ideally a shared
    // Codable + one TS type) instead of two hand-maintained enums.
    expect(watchKeys).toContain('move_goal_percent');
    expect(widgetKeys).toContain('move_pct');
    expect(watchKeys).not.toContain('move_pct');
    expect(widgetKeys).not.toContain('move_goal_percent');

    expect(watchProps.moveGoalPercent).toBe('Int');
    expect(widgetProps.movePct).toBe('Double');
  });

  it('WATCH-015: next_reminder is a String on the watch but an object on the widget', () => {
    // Same wire key, incompatible shapes — a payload that decodes on one target
    // silently drops the field on the other.
    expect(watchKeys).toContain('next_reminder');
    expect(widgetKeys).toContain('next_reminder');

    expect(watchProps.nextReminder).toBe('String');
    expect(widgetProps.nextReminder).toBe('HealthReminder');
    expect(widgetSwift).toMatch(/struct HealthReminder: Codable \{[\s\S]*?let title: String\?[\s\S]*?let at: String\?/);

    // The watch carries a second, pre-formatted field the widget has no notion of;
    // the widget instead parses ISO-8601 out of `next_reminder.at` itself.
    expect(watchKeys).toContain('next_reminder_time');
    expect(widgetKeys).not.toContain('next_reminder_time');
  });

  it('WATCH-015: only the four shared fields overlap; each side has exclusives', () => {
    const shared = watchKeys.filter((k) => widgetKeys.includes(k));
    expect(shared).toEqual(['steps', 'steps_goal', 'water_ml', 'water_goal_ml', 'next_reminder']);

    expect(watchKeys.filter((k) => !widgetKeys.includes(k))).toEqual([
      'move_goal_percent',
      'next_reminder_time',
      'date',
    ]);
    // Widened 2026-07-29 alongside WIDGET-022 above: the widget's exclusive
    // set grew from just `move_pct` to include every widget-only domain.
    expect(widgetKeys.filter((k) => !watchKeys.includes(k))).toEqual([
      'move_pct',
      'weight',
      'weight_trend',
      'nutrition',
      'nutrition_trend',
      'workouts',
      'preferences',
    ]);
  });
});
