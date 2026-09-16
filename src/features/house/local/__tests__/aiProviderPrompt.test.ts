/**
 * A refusal a member can act on.
 *
 * Every P4 feature had explicit copy and exactly one button. For the ones that
 * are off because Symply will not run a model over the member's home data, that
 * was a dead end wearing a good sentence: the member CAN turn those on, by
 * connecting a provider of their own, and nothing on screen said so.
 *
 * The offer is now made per entry, through `needsAiProvider`. What has to hold
 * is the pair of guarantees either side of that flag:
 *
 *  - where it is set, the copy points at connecting a provider — a button
 *    labelled "Add AI provider" over a sentence that never mentions one reads
 *    as a non-sequitur;
 *  - where it is not, no offer is made at all — a member who taps through, pays
 *    a provider and comes back to the same wall was misled by us.
 */
import { HouseLocalUnsupportedError } from '../errors';
import { toMemberFacingError } from '../memberFacingError';
import {
  HOUSE_UNSUPPORTED_COPY,
  HOUSE_UNSUPPORTED_FALLBACK,
} from '../unsupportedCopy';

const entries = Object.entries(HOUSE_UNSUPPORTED_COPY);
const offered = entries.filter(([, copy]) => copy.needsAiProvider);
const withheld = entries.filter(([, copy]) => !copy.needsAiProvider);

describe('the offer is made where it is true', () => {
  it('is made at all (guards the guard)', () => {
    expect(offered.length).toBeGreaterThan(0);
  });

  it.each(offered)('%s names the provider in its own copy', (_method, copy) => {
    expect(`${copy.title} ${copy.message}`.toLowerCase()).toMatch(
      /ai provider|your own provider|connect your own/,
    );
  });

  it.each(offered)('%s reaches the screen with the flag intact', method => {
    expect(
      toMemberFacingError(new HouseLocalUnsupportedError(method), 'x')
        .needsAiProvider,
    ).toBe(true);
  });
});

describe('the offer is withheld where a key changes nothing', () => {
  /**
   * The encrypted file channel, the contractor marketplace and the retired
   * satellite tracing. None of these is a model, so none of them is unlocked by
   * a key.
   *
   * The three `homeProjectsApi` linked-task methods used to stand here too —
   * the join table with no row key on any backend, which a provider key could
   * never have built. Migration 0170 removed the blocker rather than the offer:
   * they are local writes now, so they have no copy to withhold a provider
   * from. `localHomeProjectsApi.test.ts` covers them.
   */
  it.each([
    'contractorsApi.getUploadUrl',
    'contractorsApi.uploadDocument',
    'quotesApi.getDocumentUrl',
    'floorPlansApi.uploadFile',
    'gardenPlansApi.createBoundaryDraft',
    'gardenPlansApi.confirmBoundaryDraft',
    'gardenPlansApi.cancelGeneration',
    'homeProjectsApi.downloadExportPdf',
    'tasks.requestTaskQuotes',
    'tasks.getTaskQuotes',
    'tasks.createBudgetItemFromTask',
    'visitChecklistsApi.createFromTemplate',
  ])('%s makes no offer', method => {
    expect(HOUSE_UNSUPPORTED_COPY[method]).toBeDefined();
    expect(HOUSE_UNSUPPORTED_COPY[method]!.needsAiProvider).toBeUndefined();
    expect(
      toMemberFacingError(new HouseLocalUnsupportedError(method), 'x')
        .needsAiProvider,
    ).toBe(false);
  });

  it.each(withheld)(
    '%s does not dangle a provider in its copy either',
    (_method, copy) => {
      // Copy that talks about connecting a provider beside a single OK button is
      // the same dead end from the other direction.
      expect(`${copy.title} ${copy.message}`.toLowerCase()).not.toMatch(
        /connect your own provider|add an ai provider/,
      );
    },
  );

  /** A real failure — a 500, a dropped connection — never offers it. */
  it('a genuine error makes no offer', () => {
    expect(
      toMemberFacingError(new Error('boom'), 'Failed').needsAiProvider,
    ).toBe(false);
    expect(
      toMemberFacingError(
        { response: { data: { error: 'upstream' } } },
        'Failed',
      ).needsAiProvider,
    ).toBe(false);
  });

  it('and neither does the catch-all copy', () => {
    expect(HOUSE_UNSUPPORTED_FALLBACK.needsAiProvider).toBeUndefined();
  });
});
