import type {
  ExtractedRegisteredAccount,
  ExtractedRegisteredStatement,
  RegisteredAccountType,
  RegisteredContributor,
} from '@api/savings';

const ACCOUNT_TYPES: RegisteredAccountType[] = ['tfsa', 'rrsp', 'fhsa', 'dpsp', 'rpp'];

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const parsed = parseFloat(v.replace(/[^0-9.-]/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function date(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function accountType(v: unknown): RegisteredAccountType | null {
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  if (s === 'pension') return 'rpp';
  return ACCOUNT_TYPES.includes(s as RegisteredAccountType)
    ? (s as RegisteredAccountType)
    : null;
}

function contributor(v: unknown): RegisteredContributor {
  const s = str(v)?.toLowerCase();
  if (s === 'employer') return 'employer';
  return 'self';
}

export function normalizeRegisteredDraftLocal(
  raw: unknown,
  sourceText = '',
): ExtractedRegisteredStatement {
  const r = (raw ?? {}) as Record<string, unknown>;
  const accountsRaw = Array.isArray(r.accounts) ? r.accounts : [];
  const accounts: ExtractedRegisteredAccount[] = [];

  for (const entry of accountsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const contribsRaw = Array.isArray(e.contributions) ? e.contributions : [];
    accounts.push({
      account_type: accountType(e.account_type ?? e.accountType),
      institution: str(e.institution),
      is_employer_plan: e.is_employer_plan === true || e.isEmployerPlan === true,
      employer_name: str(e.employer_name ?? e.employerName),
      balance: num(e.balance),
      reported_room: num(e.reported_room ?? e.reportedRoom),
      contributions: contribsRaw
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          date: date(c.date),
          amount: num(c.amount),
          contributor: contributor(c.contributor),
        })),
    });
  }

  return {
    accounts,
    confidence: typeof r.confidence === 'number' ? r.confidence : accounts.length ? 0.6 : 0.2,
    rawText: sourceText.slice(0, 4000),
  };
}

/** Stage-A heuristic for plain registered statement text. */
export function parseRegisteredStatementText(text: string): ExtractedRegisteredStatement {
  const accounts: ExtractedRegisteredAccount[] = [];
  const typeRe = /\b(tfsa|rrsp|fhsa|dpsp|rpp|pension)\b/i;
  const moneyRe = /\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/;

  for (const line of text.split(/\r?\n/)) {
    const typeMatch = line.match(typeRe);
    if (!typeMatch) continue;
    const money = line.match(moneyRe);
    const balance = money ? num(money[1]) : null;
    accounts.push({
      account_type: accountType(typeMatch[1]),
      institution: null,
      is_employer_plan: /employer|group|pension|dpsp|rpp/i.test(line),
      employer_name: null,
      balance,
      reported_room: null,
      contributions: [],
    });
  }

  return {
    accounts,
    confidence: accounts.length ? 0.45 : 0.1,
    rawText: text.slice(0, 4000),
  };
}
