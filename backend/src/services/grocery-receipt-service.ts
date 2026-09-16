/**
 * Compatibility re-export — receipt scanning lives in the budget-analysis domain.
 * Prefer importing from `./budget-analysis`.
 */
export {
  ReceiptScanService,
  GroceryReceiptService,
  type ReceiptScanMimeType,
  type ReceiptScanItem,
  type ReceiptScanResult,
  type GroceryReceiptMimeType,
  type GroceryReceiptItem,
  type GroceryReceiptScanResult,
} from './budget-analysis';
