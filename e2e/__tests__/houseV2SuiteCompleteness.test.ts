/**
 * HOUSE-LF — the House V2 local-first Maestro suite must be runnable without
 * booting a simulator to find out.
 *
 * Two failure modes this catches, both of which cost real time here:
 *
 * 1. **A flow references a `testID` the app does not render.** This is the
 *    single most common way these flows fail, and it fails LATE — after a
 *    build, an install, a Metro boot and several minutes of driver warm-up,
 *    with an error ("Assertion is false") that looks identical to a genuine
 *    product regression. Nothing else in the tree checks it, because the flows
 *    are YAML and the screens are TSX. The backup flows are the worst case:
 *    several of them seal a real archive first, so a typo in a selector at the
 *    bottom of the file is discovered three Argon2 minutes in.
 *
 * 2. **A flow exists on disk but the suite never runs it.** `run-house-suite.sh`
 *    passes an explicit list of feature directories, and `house-v2` was absent
 *    from it — so all eighteen `lf-*` flows were written, linked from the
 *    matrix, and never executed. Same defect the Budget suite had; see
 *    `budgetSuiteCompleteness.test.ts`.
 *
 * ON DERIVED IDs. Almost nothing here hard-codes a leaf id. Two constructions
 * dominate, and both have to be understood or the guard reports every real id
 * as missing:
 *
 *   FORWARD  — the parent owns the prefix and interpolates the leaf:
 *              ``testID={`house-backup-summary-row-${entry.table}`}``
 *   BACKWARD — a shared component takes a base id as a PROP and appends its own
 *              suffix, so neither half is ever written out in full:
 *              `<HousePropertyPicker testIDPrefix="house-backup" />`
 *              +  ``testID={`${testIDPrefix}-property-${id}`}``
 *              This is how the property picker, `BackupOptionSheet`
 *              (`-notes`, `-cancel`, `-retry`), `RecoveryPhraseSheet`
 *              (`-word-N`, `-copy`, `-done`) and `CloudFolderPickerSheet`
 *              (`-crumb-N`, `-use-here`) all work.
 *
 * So the rule this file can actually enforce, stated without flattery:
 * **some hyphen-prefix of the id must appear literally in app source.**
 *
 * It does NOT validate the leaf. `house-backup-summary-row-widgets` passes
 * because `house-backup-summary-row` exists, even though `widgets` is not a
 * table. Checking the leaf would mean evaluating the templates, i.e. running
 * the app — which is the simulator run this guard exists to fail *before*.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';

const HOUSE_V2_DIR = join(__dirname, '../maestro/house-v2');
const REPO_ROOT = join(__dirname, '../..');
const SOURCE_DIRS = ['src', 'app'];
/** Every runner that has to know which directories the House suite covers. */
const ALL_RUNNERS = [
  join(REPO_ROOT, 'scripts/e2e/run-house-suite.sh'),
  join(REPO_ROOT, 'scripts/e2e/run-house-suite-sequential.sh'),
  join(REPO_ROOT, 'scripts/e2e/run-house-suite-resume.sh'),
  join(REPO_ROOT, 'scripts/e2e/run-house-suite-live-report.sh'),
];

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__snapshots__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * All app source, concatenated.
 *
 * NOT filtered to lines containing `testID`: base ids also arrive through
 * differently-named props (`testIDPrefix`, `screenTestID`), and filtering on
 * the exact string `testID` silently drops them.
 */
const appSource = SOURCE_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/* ------------------------------------------------------------------ */
/* Flows                                                               */
/* ------------------------------------------------------------------ */

function flowFiles(): string[] {
  return readdirSync(HOUSE_V2_DIR)
    .filter((entry) => entry.endsWith('.yaml') && entry !== 'config.yaml')
    .map((entry) => join(HOUSE_V2_DIR, entry));
}

/** `id: 'house-foo'` selectors in a flow. */
function testIdsIn(source: string): string[] {
  return [...source.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Does the app render this id, or a prefix a template could have extended?
 *
 * See the note at the top: this checks the PREFIX only, deliberately. The
 * longest prefix wins, so the closer a flow's id is to a real one the more of
 * it is actually verified.
 */
function appRenders(id: string): boolean {
  // `house-backup-delete-.*` is a regex selector — only its stable prefix is a
  // real id, so trim the pattern and any trailing separator.
  const literal = id.replace(/\.\*/g, '').replace(/-+$/, '');
  if (!literal) return true;

  const parts = literal.split('-');
  for (let k = parts.length; k > 0; k -= 1) {
    if (appSource.includes(parts.slice(0, k).join('-'))) return true;
  }
  return false;
}

const flows = flowFiles();

describe('house-v2 Maestro flows', () => {
  it('finds the flow directory at all (guard against a vacuous suite)', () => {
    // If the directory moves and this file keeps resolving to an empty list,
    // every assertion below passes for the wrong reason.
    expect(flows.length).toBeGreaterThan(10);
  });

  it.each(flows.map((f) => [basename(f), f] as const))(
    '%s only asserts ids the app renders',
    (_name, file) => {
      const missing = testIdsIn(readFileSync(file, 'utf8')).filter((id) => !appRenders(id));
      expect(missing).toEqual([]);
    },
  );

  /**
   * The backup surface specifically. These are the ids the flows lean on
   * hardest, and the ones a screen refactor is most likely to rename — the
   * inline list and the phrase panel only exist because Backup and Restore were
   * merged into one screen, so nothing else in the tree is watching them.
   */
  it('renders every id the backup flows depend on', () => {
    const required = [
      'house-backup-screen',
      'house-backup-status-card',
      'house-backup-status-title',
      'house-backup-now',
      'house-backup-destination-sheet',
      'house-backup-to-device',
      'house-backup-auto-toggle',
      'house-backup-frequency-row',
      'house-backup-auto-destination-row',
      'house-backup-show-phrase',
      'house-backup-run-now',
      'house-backup-keep-every-copy',
      'house-backup-drive-folder-row',
      'house-backup-drive-account-row',
      'house-backup-summary',
      'house-backup-blob-manifest',
      'house-backup-empty-message',
      'house-backup-restore-sources',
      'house-backup-restore-files',
      'house-backup-restore-phrase-panel',
      'house-backup-restore-phrase',
      'house-backup-restore-confirm',
      'house-backup-restore-cancel',
      'house-backup-restore-foreign-warning',
      'house-backup-restore-foreign-confirm',
      'house-recovery-phrase-sheet',
    ];
    expect(required.filter((id) => !appSource.includes(id))).toEqual([]);
  });

  /**
   * The two ids no literal search can find, because both halves live in
   * different files.
   *
   * `house-backup-property-picker` and `house-folder-picker` are composed at
   * render time from a prefix the SCREEN passes and a suffix the COMPONENT
   * appends — so a rename of either half breaks the flows while leaving a
   * whole-source grep perfectly happy. Both halves are asserted here, in the
   * files that own them.
   */
  it('composes the two prefix-derived ids the flows drive', () => {
    const screen = readFileSync(
      join(REPO_ROOT, 'src/screens/house-v2/backup/HouseBackupScreen.tsx'),
      'utf8',
    );
    const picker = readFileSync(
      join(REPO_ROOT, 'src/screens/house-v2/backup/HousePropertyPicker.tsx'),
      'utf8',
    );
    const folders = readFileSync(
      join(REPO_ROOT, 'src/components/backup/CloudFolderPickerSheet.tsx'),
      'utf8',
    );

    // `house-backup` + `-property-picker`
    expect(screen).toContain('testIDPrefix="house-backup"');
    expect(picker).toContain('`${testIDPrefix}-property-picker`');

    // `house-folder` + `-picker`
    expect(screen).toContain('testIDPrefix="house-folder"');
    expect(folders).toContain('`${testIDPrefix}-picker`');

    // `house-backup-location` + `-where`, threaded through the phrase sheet:
    // the card is rendered by RecoveryPhraseSheet, so the prefix crosses THREE
    // files before it reaches a testID.
    const sheet = readFileSync(
      join(REPO_ROOT, 'src/components/backup/RecoveryPhraseSheet.tsx'),
      'utf8',
    );
    const card = readFileSync(
      join(REPO_ROOT, 'src/components/backup/BackupLocationCard.tsx'),
      'utf8',
    );
    expect(screen).toContain('locationTestIDPrefix="house-backup-location"');
    expect(sheet).toContain('testIDPrefix: locationTestIDPrefix');
    expect(card).toContain('`${testIDPrefix}-where`');
  });

  /**
   * The doorway. `settings-row-house-backup` is the only way into the whole
   * surface now that Restore no longer has its own row, and an engine with no
   * doorway is not a feature — H9 shipped in exactly that state for a day.
   */
  it('still has exactly one Settings doorway, and it is the backup row', () => {
    expect(appSource).toContain('settings-row-house-backup');
    // The second row was removed when restore moved inside the screen; a flow
    // asserting its ABSENCE (lf-011) is the only place it may still appear.
    const rendered = readFileSync(
      join(REPO_ROOT, 'src/screens/main/SettingsScreen.tsx'),
      'utf8',
    );
    expect(rendered).not.toContain('settings-row-house-restore');
  });
});

/**
 * Coverage that never runs reads as green, which is worse than no coverage.
 *
 * `house-v2` was absent from every House runner's flow-directory list, so all
 * eighteen `lf-*` flows were written, linked from the matrix, and never
 * executed. The list existed in FOUR copies — the three runners below plus the
 * live-report wrapper — and they drifted, which is how one omission became four.
 * They now read a single `maestro_house_flow_dirs()` from the fleet registry,
 * and these tests pin both halves: the registry names the directory, and no
 * runner has quietly grown its own copy again.
 */
describe('the House suite actually runs these flows', () => {
  const registry = readFileSync(join(REPO_ROOT, 'scripts/e2e/maestro-fleet-brand.sh'), 'utf8');

  it('the registry names house-v2 as a House flow directory', () => {
    expect(registry).toMatch(/maestro_house_flow_dirs\(\)/);
    expect(registry).toMatch(/^\s*house-v2\s*$/m);
  });

  it.each(ALL_RUNNERS.map((r) => [basename(r), r] as const))(
    '%s reads the directory list from the registry',
    (_name, runner) => {
      const source = readFileSync(runner, 'utf8');
      expect(source).toContain('maestro_house_flow_dirs');
      // A literal list is how the four copies drifted in the first place. The
      // tail of the old array is the cheapest fingerprint of one coming back.
      expect(source).not.toMatch(/floor-plans contractors gardening/);
    },
  );
});
