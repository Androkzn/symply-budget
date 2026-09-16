/**
 * Budget analysis domain — single home for receipt scanning and spend analyses.
 *
 * Entry points (HTTP Scan Receipt, Budget chat tools, future UI) must call these
 * services. Do not reimplement extraction or aggregation in adapters.
 */

export { fmtCents, centsToDollars, dollarsToCents, monthLabel, resolveYearMonth, monthKeys } from './money';

export type {
  ReceiptScanMimeType,
  ReceiptScanItem,
  ReceiptScanResult,
  GroceryReceiptMimeType,
  GroceryReceiptItem,
  GroceryReceiptScanResult,
} from './receipt/types';

export { ReceiptScanService, GroceryReceiptService } from './receipt/receipt-scan-service';
export { toReceiptDraft, toReceiptMime, type ReceiptDraft } from './receipt/draft';

export {
  SpendTopicAnalysis,
  lexiconForTopic,
  titleMatchesTopic,
  type SpendTopicAnalysisResult,
  type SpendTopicProduct,
  type SpendTopicUiBlock,
} from './spend/spend-topic-analysis';

export {
  RecurringSpendAnalysis,
  type RecurringSpendAnalysisResult,
  type RegisteredRecurringItem,
  type DetectedRecurringItem,
} from './spend/recurring-spend-analysis';
