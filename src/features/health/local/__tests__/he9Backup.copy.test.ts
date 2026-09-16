/**
 * He9 — **no code path claims single-device restore** (plan §17 abort row).
 *
 * > **He9 | Q8 unanswered → Ship no restore claim; ≥2-device durability copy only**
 *
 * §5 says why the claim would be a lie rather than an exaggeration: the ledger
 * DEK is `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, an encrypted iCloud/iTunes backup
 * does not carry it, Apple treats Quick Start carrying it as a bug, and Apple's
 * own words for such an item are *"useless if it's restored to a different
 * device"*. So *"restore your data on a new phone"* is copy that would be read,
 * believed, and acted on by someone whose phone is already gone.
 *
 * THIS SUITE IS A GREP, AND THAT IS DELIBERATE
 * --------------------------------------------
 * It does not render a screen. It walks every user-facing string this stage
 * exports and fails on a restore verb or on House/Budget's roster vocabulary.
 * The failure it is built to catch is a **port**: the local-first stack came
 * from Budget and House, where `budgetBackup.ts` and `houseBackup.ts` both DO
 * ship a restore (they key their archives with a 12-word recovery phrase — Q8
 * option (a), decided there and open here). Copy lifted from either of those
 * screens is grammatical, plausible, and wrong.
 *
 * The E2E counterpart is `e2e/maestro/health-two-device/td-40-no-invite-partner-copy.yaml`,
 * which asserts the roster half on real screens. This asserts both halves at the
 * source, where a new constant lands before any screen renders it.
 *
 * Static imports only: `await import()` throws under this Jest config.
 */
import {
  HealthArchiveKeyingUndecidedError,
  HEALTH_ARCHIVE_FAILED_MESSAGE,
  HEALTH_ARCHIVE_KEYING_QUESTION,
  HEALTH_ARCHIVE_NO_SHEET_MESSAGE,
  HEALTH_ARCHIVE_NOTES,
  restoreHealthLedgerFromArchive,
} from '../backupArchive';
import {
  healthDurabilityCopyStrings,
  HEALTH_DURABILITY_COPY,
} from '../durability';

/**
 * Every user-facing string He9 ships, in one array.
 *
 * Assembled by hand rather than by walking the module namespace: a namespace
 * walk would also sweep developer strings (error messages, format ids) and the
 * suite would then be tuned by loosening the patterns — which is how a grep test
 * quietly stops testing anything.
 */
const HE9_USER_FACING_COPY: string[] = [
  ...healthDurabilityCopyStrings(),
  ...HEALTH_ARCHIVE_NOTES,
  HEALTH_ARCHIVE_FAILED_MESSAGE,
  HEALTH_ARCHIVE_NO_SHEET_MESSAGE,
];

/**
 * The vocabulary of getting data back.
 *
 * A bare "no `restore` anywhere" rule would be both too blunt and too weak: too
 * blunt because `HEALTH_ARCHIVE_NOTES` must be allowed to say *"It is not a way
 * to move your records onto a new device"*, and too weak because "we can bring
 * your records back" never says "restore" at all. So the rule is per CLAUSE:
 * a clause may mention getting data back only while negating it.
 */
const RESTORE_TERMS =
  /\b(?:restore[sd]?|restoring|recover(?:s|ed|y)?|new (?:phone|device)|(?:bring|get) (?:it|them|these|those) back|put (?:it|them) back)\b/i;

const NEGATION = /\b(?:not|never|cannot|can't|no|none|nowhere|without|only)\b/i;

/**
 * Clause-level, because a sentence boundary is where a promise ends. Splitting
 * on `.` and `;` also means a writer cannot smuggle a claim past this by
 * appending a disclaimer sentence after it.
 */
function restoreClaimsIn(line: string): string[] {
  return line
    .split(/[.;]/)
    .map((clause) => clause.trim())
    .filter((clause) => RESTORE_TERMS.test(clause) && !NEGATION.test(clause));
}

/** House / Budget roster vocabulary. Health is one person with N devices. */
const ROSTER_PATTERNS: RegExp[] = [
  /\binvite\b/i,
  /\bpartner\b/i,
  /\bhousehold\b/i,
  /\bmembers?\b/i,
  /\bthe owner\b/i,
  /\bsomeone else\b/i,
  /\bshare with\b/i,
];

/** Crypto mechanics — the rule `unsupportedCopy.ts` sets for its own entries. */
const MECHANICS_PATTERNS: RegExp[] = [/\bDEK\b/, /\bHDK\b/, /\bAEAD\b/, /\bkeychain\b/i];

/** Every `line → offending pattern` pair, so a failure names the string. */
function offenders(patterns: RegExp[]): string[] {
  const found: string[] = [];
  for (const line of HE9_USER_FACING_COPY) {
    for (const pattern of patterns) {
      if (pattern.test(line)) found.push(`${String(pattern)} matched: ${line}`);
    }
  }
  return found;
}

describe('no code path claims single-device restore', () => {
  it('has copy to check in the first place', () => {
    // A guard against the suite passing because someone deleted the constants.
    expect(HE9_USER_FACING_COPY.length).toBeGreaterThanOrEqual(10);
    for (const line of HE9_USER_FACING_COPY) expect(typeof line).toBe('string');
  });

  it('makes no restore promise in any He9 string', () => {
    const claims = HE9_USER_FACING_COPY.flatMap(restoreClaimsIn);

    expect(claims).toEqual([]);
  });

  it('would catch a restore promise if one were added', () => {
    // The grep above is only worth running if it can fail. These are the two
    // sentences a well-meaning port would introduce.
    expect(restoreClaimsIn('Restore your health records on a new phone.')).not.toEqual([]);
    expect(restoreClaimsIn('Save this file and we can bring them back later.')).not.toEqual([]);
  });

  it('states the limitation out loud rather than by omission', () => {
    // Silence would also satisfy the grep above, and silence is what lets a
    // person assume the file on their laptop is a way back.
    expect(HEALTH_ARCHIVE_NOTES.join(' ')).toMatch(/not a way to move your records/i);
    expect(HEALTH_DURABILITY_COPY.archiveLimit).toMatch(/cannot be opened on a device/i);
  });

  it('names the mechanism that DOES exist — a second device', () => {
    const singleDevice = HEALTH_DURABILITY_COPY.levels['this-device-only'];
    expect(`${singleDevice.title} ${singleDevice.message}`).toMatch(/other device/i);
    expect(singleDevice.message).toMatch(/only copy|nowhere else/i);
  });
});

describe('the Health voice', () => {
  it('uses no roster vocabulary', () => {
    expect(offenders(ROSTER_PATTERNS)).toEqual([]);
  });

  it('explains no encryption mechanics', () => {
    expect(offenders(MECHANICS_PATTERNS)).toEqual([]);
  });

  it("says where the data lives, in the plan's own terms", () => {
    expect(HEALTH_DURABILITY_COPY.headline).toMatch(/lives on your devices/i);
    expect(HEALTH_DURABILITY_COPY.body).toMatch(/not on our servers/i);
  });
});

describe('Q8 is recorded in code, not only in the plan', () => {
  it('declares the question open with all three options on the table', () => {
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.id).toBe('Q8');
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.status).toBe('open');
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.fallback).toMatch(/no restore claim/i);
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.ruledOut).toMatch(/quick start/i);
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.options.join(' ')).toMatch(/recovery phrase/i);
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.options.join(' ')).toMatch(/iCloud Keychain/i);
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.options.join(' ')).toMatch(/2 enrolled devices/i);
  });

  it('makes the restore verb unusable rather than absent', () => {
    // Absent would let someone add one without ever meeting Q8. Present and
    // throwing means the blocker is read by whoever tries.
    let thrown: unknown;
    try {
      restoreHealthLedgerFromArchive();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HealthArchiveKeyingUndecidedError);
    expect((thrown as Error).message).toMatch(/Q8/);
    expect((thrown as HealthArchiveKeyingUndecidedError).code).toBe(
      'health_archive_keying_undecided',
    );
  });
});
