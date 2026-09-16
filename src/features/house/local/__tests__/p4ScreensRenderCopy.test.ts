/**
 * DoD H7, the POSITIVE half — the P4 copy actually reaches a screen.
 *
 * `unsupportedCopy.test.ts` proves every disabled method HAS copy.
 * `memberFacingError.test.ts` proves `toMemberFacingError` PICKS that copy.
 * Neither proves anything renders it, and until 2026-08-14 nothing did:
 * `e2e/maestro/house-v2/h7-p4-no-identifier-in-front-of-member.yaml` records the
 * audit in its own comments — every reachable P4 call site substituted a
 * hardcoded string of its own.
 *
 *   getTaskQuotes            → TaskDetailScreen: console.error only, nothing on screen
 *   getTaskQuotes            → QuoteManagementScreen: 'Failed to load quotes'
 *   requestTaskQuotes        → ContractorSelectionScreen: 'Failed to request quotes'
 *   compareTaskQuotesWithAI  → QuoteComparisonScreen: "We couldn't compare these quotes."
 *   aiDetect                 → GarbageDetectScreen: fell back to its own sentence
 *
 * The Maestro flows walk those surfaces on a device, which is the right place
 * for the final proof — but they run against a built app on a simulator and
 * cannot fail a pull request. This suite is the cheap regression lock underneath
 * them, in two halves:
 *
 *  1. **Structural** — each call site still routes its error through the
 *     extractor. Reverting one to a hardcoded Alert body fails here, at the
 *     commit that does it, rather than on the next device run.
 *  2. **Behavioural** — the copy those sites will render, for every P4 error
 *     they can receive, contains none of the identifiers the Maestro flows
 *     forbid. This is asserted on the real copy map, not on a fixture.
 *
 * All six reachable call sites are now covered. `PurchaseSuggestionChip`
 * ('Could not add to budget', `createBudgetItemFromTask`) was the last to land:
 * it was held back while `src/components/tasks/**` was owned by the H6
 * attachment change, and was added as soon as that cleared.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { HouseLocalUnsupportedError } from '../errors';
import { toMemberFacingError } from '../memberFacingError';
import { HOUSE_UNSUPPORTED_COPY } from '../unsupportedCopy';

const SRC = join(__dirname, '..', '..', '..', '..');

/**
 * Every string the three `h7-p4-*.yaml` flows assert is NOT visible, minus
 * `task-purchase-added` which is a testID rather than an error string. Kept in
 * sync by hand with the flows; the flows are the authority.
 */
const FORBIDDEN = [
  'appliancesApi.addDocument',
  'appliancesApi.getDocuments',
  'garbage-collection.aiDetect',
  'households.invite',
  'households.searchUsers',
  'households.uploadPhoto',
  'is not available offline yet',
  'task-drafts.generate',
  'tasks.compareTaskQuotesWithAI',
  'tasks.createBudgetItemFromTask',
  'tasks.getTaskQuotes',
  'tasks.requestTaskQuotes',
];

type CallSite = {
  /** Path relative to `src/`. */
  file: string;
  /** The P4 method whose error can arrive here. */
  method: string;
  /** The hardcoded sentence this site used to render instead of the copy. */
  wasHardcoded: string;
};

const CALL_SITES: CallSite[] = [
  {
    file: 'screens/tasks/QuoteManagementScreen.tsx',
    method: 'tasks.getTaskQuotes',
    wasHardcoded: "Alert.alert('Error', 'Failed to load quotes')",
  },
  {
    file: 'screens/tasks/ContractorSelectionScreen.tsx',
    method: 'tasks.requestTaskQuotes',
    wasHardcoded: "Alert.alert('Error', 'Failed to request quotes')",
  },
  {
    file: 'screens/tasks/QuoteComparisonScreen.tsx',
    method: 'tasks.compareTaskQuotesWithAI',
    wasHardcoded: "Alert.alert('Quotes', 'We couldn’t compare these quotes. Please try again.')",
  },
  {
    file: 'screens/tasks/TaskDetailScreen.tsx',
    method: 'tasks.getTaskQuotes',
    // This one rendered nothing at all — the regression is the notice state
    // disappearing again, so the marker is its testID.
    wasHardcoded: '',
  },
  {
    file: 'screens/garbage/GarbageDetectScreen.tsx',
    method: 'garbage-collection.aiDetect',
    wasHardcoded: '',
  },
  {
    // The sixth site, added once `src/components/tasks/**` was no longer held
    // by a concurrent change. This is the surface
    // `h7-p4-purchase-suggestion-no-false-success.yaml` drives directly.
    file: 'components/tasks/PurchaseSuggestionChip.tsx',
    method: 'tasks.createBudgetItemFromTask',
    wasHardcoded: "showToast('error', 'Could not add to budget')",
  },
  {
    // The seventh, and the one the original H7 audit missed entirely: the two
    // ONBOARDING uploads. Both flattened every failure into `Alert.alert(
    // 'Upload Failed', error.message)`, which keeps the copy's body and throws
    // away its title — so "Adding a floor plan is not on this build yet"
    // reached a member under a heading that reads as a crash. It was reported
    // from a device, not caught here, because the audit walked the six screens
    // reachable from the tabs and onboarding is walked once per install.
    file: 'screens/onboarding/FloorPlanScreen.tsx',
    method: 'floorPlansApi.getUploadUrl',
    wasHardcoded: "Alert.alert('Upload Failed', message)",
  },
  {
    // No P4 method reaches this screen today — `reportsApi` has no local
    // facade, so a local-first build calls the Worker straight through — but
    // the site is listed for the same reason its sibling is: it is an upload
    // that can fail, its old handler was the identical `error.message` flatten,
    // and the day reports DO get a facade the obligation is a failing test
    // rather than a rediscovery. `method` names the copy this suite renders
    // against; the structural half is what actually guards this file.
    file: 'screens/onboarding/UploadReportScreen.tsx',
    method: 'utilitiesApi.uploadAndExtractBill',
    wasHardcoded: "Alert.alert('Upload Failed', message)",
  },
];

function sourceOf(site: CallSite): string {
  return readFileSync(join(SRC, site.file), 'utf8');
}

describe('every reachable P4 call site routes its error through the extractor', () => {
  it.each(CALL_SITES.map((s) => [s.file, s] as const))(
    '%s routes its error through the extractor',
    (_file, site) => {
      const src = sourceOf(site);
      // Either directly, or through `useMemberFacingAlert` — which calls the
      // extractor itself and additionally offers the provider route when a key
      // is the missing piece. A site that reaches for `Alert.alert` with its
      // own sentence matches neither.
      expect(src).toMatch(
        /from '@features\/house\/local\/(memberFacingError|useMemberFacingAlert)'/,
      );
      expect(src).toMatch(
        /toMemberFacingError|memberFacingMessage|useMemberFacingAlert/,
      );
    },
  );

  it.each(CALL_SITES.filter((s) => s.wasHardcoded).map((s) => [s.file, s] as const))(
    '%s no longer substitutes its own sentence',
    (_file, site) => {
      // Not "the sentence is gone" — it survives as the LAST-RESORT fallback for
      // a genuine failure, which is correct. What must be gone is the sentence
      // being handed straight to `Alert.alert` without the extractor ever
      // seeing the error.
      expect(sourceOf(site)).not.toContain(site.wasHardcoded);
    },
  );

  it('TaskDetailScreen renders the notice instead of only logging it', () => {
    const src = sourceOf(CALL_SITES.find((s) => s.file.endsWith('TaskDetailScreen.tsx'))!);
    expect(src).toContain('task-detail-quotes-notice');
    expect(src).toMatch(/quotesNotice\.title/);
    expect(src).toMatch(/quotesNotice\.message/);
  });

  it('GarbageDetectScreen renders the error TITLE, not a hardcoded heading', () => {
    const src = sourceOf(CALL_SITES.find((s) => s.file.endsWith('GarbageDetectScreen.tsx'))!);
    // 'Something went wrong' survives as the default title for a real failure,
    // but it must no longer be the heading a deliberately-off feature gets.
    expect(src).toContain('{errorTitle}');
    expect(src).toMatch(/setErrorTitle/);
  });
});

describe('what those sites will render leaks no identifier', () => {
  const methods = Object.keys(HOUSE_UNSUPPORTED_COPY);

  it('covers every P4 method, not just the wired ones', () => {
    expect(methods.length).toBeGreaterThan(0);
  });

  it.each(methods)('%s renders copy containing no forbidden string', (method) => {
    const rendered = toMemberFacingError(
      new HouseLocalUnsupportedError(method),
      'screen fallback',
    );
    const text = `${rendered.title}\n${rendered.message}`;
    for (const banned of FORBIDDEN) {
      expect(text).not.toContain(banned);
    }
    // And it is the deliberate copy, not the screen's own sentence.
    expect(rendered.expected).toBe(true);
    expect(rendered.message).not.toBe('screen fallback');
  });

  it('keeps the identifier available for logs on `.method`', () => {
    // The identifier is not deleted — it is moved somewhere a screen will not
    // reach for. Losing it entirely would make these failures undebuggable.
    const err = new HouseLocalUnsupportedError('tasks.getTaskQuotes');
    expect(err.method).toBe('tasks.getTaskQuotes');
    expect(err.message).not.toContain('tasks.getTaskQuotes');
  });
});
