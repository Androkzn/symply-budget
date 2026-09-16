/**
 * Prompt integrity: no retired brand name may appear in an AI prompt.
 *
 * The prompts were deliberately de-branded — one `src/` + one `backend/` serve
 * five storefronts (House, Budget, Kaizen, Language, Health), so a prompt that
 * names a specific app teaches the model to say the wrong product name to four
 * fifths of the fleet. "SimpleHouse" in particular is the RETIRED name of the
 * project and must never resurface; it was stripped from every prompt once and
 * has crept back through copy/paste before.
 *
 * One prompt-invariant test already guards the receipt reader's framing; this
 * applies the same class of guard across the whole prompt library at once, so a
 * new prompt file is covered the moment it is added.
 */
import { PROPERTY_JURISDICTIONS } from '@symply/contracts';
import { describe, expect, it } from 'vitest';


import { EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT } from '../extract-budget-document';
import { EXTRACT_FINDINGS_SYSTEM_PROMPT } from '../extract-findings';
import { EXTRACT_GARBAGE_SCHEDULE_SYSTEM_PROMPT } from '../extract-garbage-schedule';
import { HOME_FEATURES_SYSTEM_PROMPT } from '../extract-home-features';
import {
  EXTRACT_PROPERTY_ASSESSMENT_SYSTEM_PROMPT,
  buildPropertyAssessmentSystemPrompt,
} from '../extract-property-assessment';
import { EXTRACT_SHELF_TAG_SYSTEM_PROMPT } from '../extract-shelf-tag';
import {
  EXTRACT_PROPERTY_TAX_SYSTEM_PROMPT,
  buildPropertyTaxSystemPrompt,
} from '../extract-property-tax';
import { EXTRACT_REGISTERED_STATEMENT_SYSTEM_PROMPT } from '../extract-registered-statement';
import { EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT } from '../extract-savings-document';
import { EXTRACT_UTILITY_BILL_SYSTEM_PROMPT } from '../extract-utility-bill';
import { GENERATE_SUMMARY_SYSTEM_PROMPT } from '../generate-summary';
import { HOUSEHOLD_CHAT_ASSISTANT_SYSTEM_PROMPT } from '../household-chat-assistant';
import { SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT } from '../scan-grocery-receipt';
import { SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT } from '../suggest-budget-items';
import { GENERATE_ACTION_PLAN_SYSTEM_PROMPT } from '../generate-action-plan';

/** Every shared system prompt reachable without brand-specific construction. */
const PROMPTS: Array<[string, string]> = [
  ['household-chat-assistant', HOUSEHOLD_CHAT_ASSISTANT_SYSTEM_PROMPT],
  ['scan-grocery-receipt', SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT],
  ['suggest-budget-items', SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT],
  ['extract-budget-document', EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT],
  ['extract-savings-document', EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT],
  ['extract-utility-bill', EXTRACT_UTILITY_BILL_SYSTEM_PROMPT],
  ['extract-garbage-schedule', EXTRACT_GARBAGE_SCHEDULE_SYSTEM_PROMPT],
  ['extract-registered-statement', EXTRACT_REGISTERED_STATEMENT_SYSTEM_PROMPT],
  ['extract-property-tax', EXTRACT_PROPERTY_TAX_SYSTEM_PROMPT],
  ['extract-property-assessment', EXTRACT_PROPERTY_ASSESSMENT_SYSTEM_PROMPT],
  // Added when the shelf-tag reader shipped. This list is hand-maintained —
  // the file's own header claims a new prompt is "covered the moment it is
  // added", which is only true if someone remembers to add it.
  ['extract-shelf-tag', EXTRACT_SHELF_TAG_SYSTEM_PROMPT],
  ['extract-findings', EXTRACT_FINDINGS_SYSTEM_PROMPT],
  ['generate-summary', GENERATE_SUMMARY_SYSTEM_PROMPT],
  ['generate-action-plan', GENERATE_ACTION_PLAN_SYSTEM_PROMPT],
  ['extract-home-features', HOME_FEATURES_SYSTEM_PROMPT],
];

/** The retired project name, in the spellings that have actually appeared. */
const RETIRED_BRAND = /simple\s*house|simplehouse/i;

describe('prompt brand neutrality', () => {
  it.each(PROMPTS)('%s does not name the retired project', (_name, prompt) => {
    expect(prompt).not.toMatch(RETIRED_BRAND);
  });

  it('covers a meaningful share of the prompt library', () => {
    // Guards against the list silently shrinking to nothing in a refactor.
    expect(PROMPTS.length).toBeGreaterThanOrEqual(13);
    for (const [name, prompt] of PROMPTS) {
      expect(prompt, `${name} should be a non-empty prompt`).toBeTruthy();
      expect(prompt.length, `${name} should be a real prompt`).toBeGreaterThan(50);
    }
  });

  // The property prompts are BUILDERS, not constants — one per jurisdiction.
  // Listing only the `null` default would leave thirteen real prompts unguarded,
  // which is exactly how a brand name creeps back in.
  it.each(Object.values(PROPERTY_JURISDICTIONS).map((j) => [j.regionCode, j] as const))(
    'property prompts stay brand-neutral for %s',
    (_region, jurisdiction) => {
      expect(buildPropertyAssessmentSystemPrompt(jurisdiction)).not.toMatch(RETIRED_BRAND);
      expect(buildPropertyTaxSystemPrompt(jurisdiction)).not.toMatch(RETIRED_BRAND);
    }
  );

  it('never leaks one province’s rules into another', () => {
    // A Manitoba household must not be told about the BC Home Owner Grant, and
    // an Ontario one must not be told to look for a BC Assessment notice. This
    // is the failure mode the jurisdiction registry exists to prevent.
    const mb = buildPropertyAssessmentSystemPrompt(PROPERTY_JURISDICTIONS['CA-MB']);
    expect(mb).not.toMatch(/BC Assessment|Home Owner Grant/i);
    expect(mb).toMatch(/portioned/i);

    const on = buildPropertyAssessmentSystemPrompt(PROPERTY_JURISDICTIONS['CA-ON']);
    expect(on).not.toMatch(/BC Assessment|Home Owner Grant/i);
    expect(on).toMatch(/MPAC|Current Value Assessment/i);
  });

  it('names no province at all when the jurisdiction is unknown', () => {
    // The generic prompt is what an address-less household gets. Guessing a
    // province there would put another region's rules on a real notice.
    const generic = buildPropertyAssessmentSystemPrompt(null);
    for (const j of Object.values(PROPERTY_JURISDICTIONS)) {
      expect(generic).not.toContain(j.regionName);
    }
    expect(generic).not.toMatch(/MPAC|PVSC|SAMA|BC Assessment/i);
  });

  it('keeps the shared household assistant app-neutral', () => {
    // This prompt is instantiated by more than one storefront, so it must refer
    // to "the app", never a product name.
    expect(HOUSEHOLD_CHAT_ASSISTANT_SYSTEM_PROMPT).toMatch(/in the app/i);
    expect(HOUSEHOLD_CHAT_ASSISTANT_SYSTEM_PROMPT).not.toMatch(/\bSymply\b/);
  });
});
