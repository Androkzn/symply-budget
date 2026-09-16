/**
 * Seal a tiny Symply Budget V2 encrypted backup for Maestro restore UI E2E.
 *
 * Writes (repo-relative):
 *   e2e/fixtures/budget/restore-smoke.backup.json
 *   e2e/fixtures/budget/restore-smoke.phrase.txt
 *
 * Usage (from packages/local-first):
 *   npx vite-node scripts/write-restore-smoke-fixture.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBackupArchive, recoveryPhraseFromEntropyHex } from '../src/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_DIR = join(ROOT, 'e2e/fixtures/budget');

/** Fixed 16-byte entropy → stable 12-word phrase for Maestro inputText. */
const ENTROPY = '0123456789abcdef0123456789abcdef';
const HOUSEHOLD_ID = 'hh_e2e_restore_smoke';
const DEVICE_ID = 'dev_e2e_restore_smoke';
const NOW = '2026-08-10T12:00:00.000Z';

const snapshot = {
  version: 1 as const,
  household: {
    id: HOUSEHOLD_ID,
    name: 'E2E Restore HH',
    address_line1: null,
    address_line2: null,
    city: null,
    state_province: null,
    postal_code: null,
    country: 'CA',
    unit_system: null,
    photo_key: null,
    photo_url: null,
    purchase_price: null,
    purchase_date: null,
    my_role: 'owner' as const,
    created_at: NOW,
    updated_at: NOW,
  },
  memberId: 'user_e2e_restore',
  deviceId: DEVICE_ID,
  categories: [
    {
      id: 'cat_e2e_1',
      household_id: HOUSEHOLD_ID,
      name: 'E2E Category',
      color: '#4CAF50',
      icon: null,
      sort_order: 0,
      created_at: NOW,
      updated_at: NOW,
    },
  ],
  expenses: [
    {
      id: 'exp_e2e_1',
      household_id: HOUSEHOLD_ID,
      title: 'E2E Backup Spend',
      amount: 1250,
      expense_date: '2026-08-01',
      category_id: 'cat_e2e_1',
      notes: null,
      created_at: NOW,
      updated_at: NOW,
    },
  ],
  items: [],
  goals: [],
  subBudgets: [],
  transfers: [],
  mortgages: [],
  mortgageTerms: [],
  mortgageStatements: [],
  mortgageEvents: [],
  mortgageOffers: [],
  savingsIncome: [],
  savingsSpending: [],
  savingsRecurringPayments: [],
  savingsGoals: [],
  savingsCategories: [],
  savingsIncomeTemplates: [],
  savingsMonthlyTargets: [],
  budgetLoans: [],
  budgetRenewals: [],
  registeredAccounts: [],
  registeredTransactions: [],
  wishes: [],
  wishEntries: [],
  wishAttachments: [],
  ops: [],
  lww: {},
  conflicts: [],
};

const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
const created = createBackupArchive(
  {
    snapshotJson: JSON.stringify(snapshot),
    householdId: HOUSEHOLD_ID,
    deviceId: DEVICE_ID,
    keyEpoch: 1,
    createdAt: NOW,
  },
  { phrase },
);

mkdirSync(OUT_DIR, { recursive: true });
const archivePath = join(OUT_DIR, 'restore-smoke.backup.json');
const phrasePath = join(OUT_DIR, 'restore-smoke.phrase.txt');
writeFileSync(archivePath, created.archiveJson);
writeFileSync(phrasePath, `${phrase}\n`);

console.log('Wrote', archivePath);
console.log('Wrote', phrasePath);
console.log('Phrase:', phrase);
