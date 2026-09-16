/**
 * Seal an already-exported plaintext ledger JSON into a V2 encrypted archive.
 *
 * Split out of `backend/scripts/export-budget-d1-to-v2-backup.mjs`, whose final
 * step (`await import('.../archive.ts')`) cannot run under the bare `node` its
 * own usage block prescribes — it dies on ERR_UNKNOWN_FILE_EXTENSION after the
 * D1 reads have already succeeded and the `.ledger.json` is on disk. Rather
 * than re-query production to recover, point this at that leftover file.
 *
 * Usage (from packages/local-first):
 *   npx vite-node scripts/seal-ledger.ts -- <path/to/x.ledger.json> <outDir>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createBackupArchive } from '../src/index';

const [ledgerPath, outDir] = process.argv.slice(2);
if (!ledgerPath || !outDir) {
  throw new Error('Usage: vite-node scripts/seal-ledger.ts -- <ledger.json> <outDir>');
}

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const base = basename(ledgerPath).replace(/\.ledger\.json$/, '');

const created = createBackupArchive({
  snapshotJson: JSON.stringify(ledger),
  householdId: ledger.household.id,
  deviceId: ledger.deviceId,
  keyEpoch: 1,
  createdAt: new Date().toISOString(),
});

const archivePath = join(outDir, `${base}.backup.json`);
const phrasePath = join(outDir, `${base}.phrase.txt`);
writeFileSync(archivePath, created.archiveJson);
writeFileSync(
  phrasePath,
  [
    'Symply Budget V2 migration backup',
    `Household: ${ledger.household.name} (${ledger.household.id})`,
    `Created: ${new Date().toISOString()}`,
    '',
    'RECOVERY PHRASE (12 words) — store securely; required to restore:',
    created.phrase,
    '',
  ].join('\n'),
);

const expenses: Array<Record<string, number>> = ledger.expenses ?? [];
const sum = (k: string) => expenses.reduce((s, e) => s + (Number(e[k]) || 0), 0);
console.log('Sealed  :', archivePath);
console.log('Phrase  :', phrasePath);
console.log('Expenses:', expenses.length);
console.log('taxCents:', sum('tax_amount'), ' depositCents:', sum('deposit_amount'));
console.log('');
console.log('RECOVERY PHRASE:', created.phrase);
