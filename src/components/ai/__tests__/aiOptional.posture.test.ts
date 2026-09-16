/**
 * Fleet-wide **"core works without AI" posture guard**.
 *
 * ============================ WHY THIS EXISTS ============================
 * The commercial shape of every Symply app is: the app is FREE and fully usable
 * with no AI at all. AI is the one thing that costs real money per use, so it is
 * unlocked either by a PRO subscription or by the member connecting their own
 * provider key (BYOK — `app/ai-access/*`). Nothing else may hide behind it.
 *
 * That splits every surface into two kinds:
 *
 *   A. AI-NATIVE — the surface IS the model call. A coach chat with no model is
 *      an empty box, so it may legitimately render `<AIAccessGate>` and show the
 *      unlock CTA in place of itself. These are enumerated below.
 *
 *   B. EVERYTHING ELSE — core. Storing a document, adding a floor plan, putting
 *      quotes side by side, logging a meal. These must render and work with no
 *      provider connected; the AI part is an ACTION inside them, gated with
 *      `ensureCanUseAI()` at the button, never a wrapper around the screen.
 *
 * The failure this guards against is subtle and expensive: wrapping a whole
 * screen in `<AIAccessGate>` is one line, reads as prudent, and silently paywalls
 * a feature the member was promised for free. It has happened three times
 * already — Reports (upload), floor plans (add) and quote comparison were each
 * fully blocked while their BACKEND routes were never AI-gated at all.
 *
 * So: a screen-level gate is opt-in via this allowlist, and adding a file to it
 * is a product decision that must be argued in review, not a silent import.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SCANNED_DIRS = ['src/screens', 'src/features', 'src/components', 'app'];

/**
 * Surfaces that ARE the model call — with nothing to fall back to, the unlock
 * CTA is the honest empty state. Keep this list short and justified.
 */
const AI_NATIVE_SURFACES = [
  // Mira, the House AI housekeeper — a chat with the assistant.
  'src/screens/aihousekeeper/AihousekeeperChatScreen.tsx',
  // "Explain this technical term/spec" — a pure model answer.
  'src/screens/labor-hub/AITechnicalInfoScreen.tsx',
  // Budget's AI-only entry points. Every one has a MANUAL sibling reachable from
  // the same list (add item by hand, type an expense, enter a savings row), so
  // gating the AI variant does not remove any capability.
  'src/screens/budget/BudgetItemAIScreen.tsx',
  'src/screens/budget/BudgetReceiptScanScreen.tsx',
  'src/screens/budget/pension/PensionImportScreen.tsx',
  'src/screens/budget/savings/SavingsImportScreen.tsx',
  // Kaizen — the model reads the resume / holds the conversation. Manual
  // practice, question banks and book chapters stay un-gated.
  'src/features/kaizen/screens/ResumeReviewScreen.tsx',
  'src/features/kaizen/screens/CoachChatScreen.tsx',
];

/**
 * Core surfaces that were previously blocked outright and must stay degradable:
 * they render for everyone and keep `canUseAI` only to decide whether the
 * OPTIONAL model pass runs.
 */
const MUST_DEGRADE_NOT_BLOCK = [
  'src/screens/reports/ReportsScreen.tsx',
  'src/screens/floor-plans/FloorPlanUploadScreen.tsx',
  'src/screens/tasks/QuoteComparisonScreen.tsx',
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = SCANNED_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
const repoPath = (file: string) => relative(REPO_ROOT, file).split(sep).join('/');

describe('core features work without AI', () => {
  it('scans a non-trivial slice of the app (guard is actually wired up)', () => {
    expect(sourceFiles.length).toBeGreaterThan(200);
  });

  it('screen-level AI gates exist only on AI-native surfaces', () => {
    // Match the JSX application, not the identifier — a file may name the gate
    // in a comment (SubscriptionSection does) without applying it.
    const gated = sourceFiles
      .filter((file) => readFileSync(file, 'utf8').includes('<AIAccessGate'))
      .map(repoPath)
      .filter((file) => !AI_NATIVE_SURFACES.includes(file));

    expect(gated).toEqual([]);
  });

  it('every allowlisted AI-native surface still exists (list has not gone stale)', () => {
    const present = sourceFiles.map(repoPath);
    for (const surface of AI_NATIVE_SURFACES) {
      expect(present).toContain(surface);
    }
  });

  it('previously-blocked core surfaces degrade instead of gating', () => {
    for (const file of MUST_DEGRADE_NOT_BLOCK) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      // No wrapper…
      expect(source).not.toContain('AIAccessGate');
      // …but the screen is still AI-aware, i.e. it branches on entitlement to
      // decide whether the optional model pass runs.
      expect(source).toContain('canUseAI');
    }
  });
});
