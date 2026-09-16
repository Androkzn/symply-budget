/**
 * Pure formatting for the House V2 backup / restore / export screens (plan §10,
 * H9).
 *
 * Kept out of the screen files so the numbers a member reads — "1,204 rows",
 * "18 attachments · 42.3 MB" — can be asserted without rendering anything, the
 * same split `BudgetBackupScreen` uses for its own formatters.
 */

/** `tasks` / `home_projects` / `laborHub` → `Tasks` / `Home projects` / `Labor hub`. */
export function tableLabel(table: string): string {
  const spaced = table
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!spaced) return table;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export type HouseBackupSummaryRow = {
  table: string;
  label: string;
  count: number;
};

/**
 * Per-table counts, biggest first, empty tables dropped.
 *
 * House has 21 Wave-A ledger tables and most homes use a handful of them; a
 * list with fourteen "0" rows in it buries the four that matter. The total is
 * reported separately so nothing is hidden by the filter.
 */
export function summaryRows(tableCounts: Record<string, number>): HouseBackupSummaryRow[] {
  return Object.entries(tableCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([table, count]) => ({ table, label: tableLabel(table), count }));
}

export function formatCount(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0';
}

export function pluralRows(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'row' : 'rows'}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function totalBlobBytes(manifest: ReadonlyArray<{ bytes: number }>): number {
  return manifest.reduce((sum, entry) => sum + (Number.isFinite(entry.bytes) ? entry.bytes : 0), 0);
}

/**
 * The attachment sentence, in one place because both screens must say the same
 * thing and it is the single most surprising fact about a House archive (Q15):
 * the bytes are not in the file.
 */
export function blobManifestSentence(count: number, bytes: number): string {
  if (count === 0) {
    return 'No photos or documents in this home yet, so there is nothing to fetch back later.';
  }
  return `${formatCount(count)} ${
    count === 1 ? 'attachment is' : 'attachments are'
  } listed but NOT inside the file (${formatBytes(
    bytes,
  )} of photos and documents). Restoring brings the list back and fetches the files again from this household's cloud storage — which only works while the household still exists. If it is ever deleted, restored rows keep their details and show their attachments as unavailable.`;
}

/**
 * Yield one frame before a synchronous crypto step.
 *
 * Argon2id derivation runs on the JS thread and takes seconds-to-minutes on a
 * cold device. Without this the "Working…" state is set and never painted, so
 * the member taps a button that appears to do nothing and taps it again.
 */
export function yieldToPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
