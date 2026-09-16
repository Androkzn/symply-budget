/**
 * Receipt lines a model has emitted into a partial (still-streaming) tool JSON.
 *
 * Every item in the receipt schema carries exactly one `"raw_name"` key, and
 * neither `fees` nor `tax_summary` entries have one, so counting that key counts
 * items — without needing parseable JSON, which a half-written object never is.
 *
 * The number is a progress signal, not a result: the finished draft can hold
 * fewer lines, because fee and discount rows fold into their parent item and
 * unusable rows are dropped.
 *
 * The Worker-side scan counts the same key in
 * `backend/src/services/budget-analysis/receipt/receipt-scan-service.ts`; the
 * two schemas agree on `raw_name` and must keep agreeing.
 */
export function countStreamedReceiptItems(partialJson: string): number {
  return partialJson.match(/"raw_name"\s*:/g)?.length ?? 0;
}
