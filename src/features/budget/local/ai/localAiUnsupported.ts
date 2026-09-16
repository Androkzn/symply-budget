import { BudgetLocalUnsupportedError } from '../errors';

export type BudgetLocalAiContext =
  | 'receipt'
  | 'ai-detect'
  | 'insights'
  | 'mortgage-extract'
  | 'generic';

const COPY: Record<BudgetLocalAiContext, { title: string; message: string }> = {
  receipt: {
    title: 'Receipt scan needs text or your AI key',
    message:
      'Offline receipt photos need a connected BYOK provider key, or paste receipt text / pick a .txt or .csv file. You can always add expenses manually.',
  },
  'ai-detect': {
    title: 'AI import needs text or your AI key',
    message:
      'Paste amounts as text or connect a BYOK key to read photos. Manual entry always works offline.',
  },
  insights: {
    title: 'Insights need your AI key',
    message:
      'Monthly insights are written by your own AI provider — connect a key in Settings → AI Providers. Your budget totals and categories work without one.',
  },
  'mortgage-extract': {
    title: 'Statement scan needs your AI key',
    message:
      'Reading a mortgage statement offline needs a connected BYOK provider key, or enter the values manually below.',
  },
  generic: {
    title: 'Feature needs a connection',
    message:
      'This AI feature is not available offline yet. Core budgeting — expenses, categories, and savings — works without the network.',
  },
};

export function isBudgetLocalUnsupportedError(error: unknown): error is BudgetLocalUnsupportedError {
  if (error instanceof BudgetLocalUnsupportedError) return true;
  return (
    error instanceof Error &&
    error.name === 'BudgetLocalUnsupportedError'
  );
}

/** User-facing alert copy when a Budget API method is local-only unsupported. */
export function getBudgetLocalUnsupportedCopy(
  context: BudgetLocalAiContext = 'generic',
): { title: string; message: string } {
  return COPY[context];
}

/** Map a thrown API error to friendly copy, or null when it is not an offline-AI guard. */
export function budgetLocalUnsupportedCopyFromError(
  error: unknown,
  context: BudgetLocalAiContext = 'generic',
): { title: string; message: string } | null {
  if (!isBudgetLocalUnsupportedError(error)) return null;
  return getBudgetLocalUnsupportedCopy(context);
}
