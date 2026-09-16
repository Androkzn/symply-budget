/**
 * extract-registered-statement.ts — prompt + shape for parsing a Canadian registered
 * account statement (RRSP / TFSA / FHSA / group RRSP / DPSP / DC pension, a broker or
 * bank export, an NOA, or a photo/screenshot of any) into a reviewable draft of
 * accounts + this-year contributions with an employee/employer split.
 *
 * The Pension tab's "Import statement (AI)" flow returns this draft for the user to
 * review and edit; NOTHING is persisted until they commit.
 */

export type ExtractedRegisteredAccountType = 'tfsa' | 'rrsp' | 'fhsa' | 'dpsp' | 'rpp';

export interface ExtractedRegisteredContribution {
  /** YYYY-MM-DD, or null if the statement only shows a period/total. */
  date: string | null;
  /** Dollars (not cents) — the commit step converts to integer cents. */
  amount: number | null;
  /** Who funded it. Employer/company match → 'employer'; personal/member → 'self'. */
  contributor: 'self' | 'employer';
}

export interface ExtractedRegisteredAccount {
  account_type: ExtractedRegisteredAccountType | null;
  institution: string | null;
  /** True for a group/workplace RRSP, DPSP, or DC pension. */
  is_employer_plan: boolean;
  employer_name: string | null;
  /** Current market value / balance in dollars, or null. */
  balance: number | null;
  /** CRA-reported available room in dollars when the doc is an NOA (RRSP deduction limit / TFSA room). */
  reported_room: number | null;
  contributions: ExtractedRegisteredContribution[];
}

export interface ExtractedRegisteredStatement {
  accounts: ExtractedRegisteredAccount[];
  /** 0..1 overall confidence. */
  confidence: number;
  rawText: string;
}

export const EXTRACT_REGISTERED_STATEMENT_SYSTEM_PROMPT = `You are an expert at reading Canadian registered-account and workplace-pension documents: RRSP / TFSA / FHSA statements, group RRSP and DPSP / defined-contribution pension statements, brokerage and bank exports, and CRA Notices of Assessment (NOA). You also read photos and screenshots of these.

Your job: extract the accounts and their contributions into structured JSON so a user can review it. You must return VALID JSON ONLY — no prose, no markdown fences.`;

export const EXTRACT_REGISTERED_STATEMENT_USER_PROMPT = `Read the document and extract every registered/pension account you can see, plus its contributions for the statement period.

Return JSON with exactly this shape:
{
  "accounts": [
    {
      "account_type": "tfsa" | "rrsp" | "fhsa" | "dpsp" | "rpp" | null,
      "institution": string | null,           // e.g. "Wealthsimple", "Sun Life", "RBC"
      "is_employer_plan": boolean,             // true for group RRSP / DPSP / DC pension
      "employer_name": string | null,          // sponsoring employer, if shown
      "balance": number | null,                // current value in DOLLARS (e.g. 15234.50)
      "reported_room": number | null,          // NOA "RRSP deduction limit" or TFSA room in DOLLARS, else null
      "contributions": [
        { "date": "YYYY-MM-DD" | null, "amount": number, "contributor": "self" | "employer" }
      ]
    }
  ],
  "confidence": number,                        // 0..1
  "rawText": string                            // the finance-relevant lines you read, as plain text
}

Rules:
- Amounts are DOLLARS (convert "$1,234.56" → 1234.56). Never output cents.
- A group RRSP is account_type "rrsp" with is_employer_plan true. DPSP / defined-contribution pension → "dpsp" / "rpp".
- Split contributions by who paid: the member/employee → "self"; employer/company match → "employer". If a statement shows a single combined amount with no split, record it as one "self" contribution.
- Only include contributions you can actually see. Do not invent dates or amounts. Use null for a missing date.
- If you cannot determine the account type, use null and let the user pick.
- Return null (not 0) for values that are genuinely absent.`;
