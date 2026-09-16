import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { bytesToBase64 } from '@symply/local-first';

import { getLocalLedger, getLocalLedgerFor, isLocalBudgetSessionOpen } from '../engine';
import { BudgetLocalNotReadyError } from '../errors';

import {
  budgetExportHouseholdSlug,
  BUDGET_EXPORT_FAILED_MESSAGE,
  type BudgetExportResult,
} from './budgetLedgerExport';
import { buildBudgetWorkbookSheets } from './budgetWorkbook';
import type { BudgetExportSelection } from './exportSelection';
import { buildXlsx } from './xlsxWriter';

/**
 * Budget V2 local-first .xlsx export — a real multi-tab spreadsheet.
 *
 * Reads the on-device ledger only, no network, same as the CSV path. This is the
 * human-facing export; `exportBudgetLedgerCsv` remains the machine-readable one.
 */

export function budgetWorkbookFileName(
  day: string = new Date().toISOString().slice(0, 10),
  householdName?: string | null,
): string {
  return `symply-budget-${day}${budgetExportHouseholdSlug(householdName)}.xlsx`;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_UTI = 'org.openxmlformats.spreadsheetml.sheet';

/**
 * Build the workbook from a local ledger and hand it to the OS share sheet.
 *
 * `sections` is the Export screen's toggle list; omitting it exports everything.
 *
 * `householdId` names the household to export and defaults to the active one —
 * same contract as the CSV path, and for the same reason: a member exporting a
 * household they are not currently in must get that household's workbook without
 * the app switching underneath them. See `exportBudgetLedgerCsv` for why the
 * resolution sits outside the try/catch.
 */
export async function exportBudgetWorkbookXlsx(
  options: { sections?: BudgetExportSelection; householdId?: string } = {},
): Promise<BudgetExportResult> {
  if (!isLocalBudgetSessionOpen()) {
    throw new BudgetLocalNotReadyError();
  }

  const ledger = options.householdId
    ? await getLocalLedgerFor(options.householdId)
    : getLocalLedger();

  let base64: string;
  let rows: number;
  let tabs: number;
  try {
    const sheets = buildBudgetWorkbookSheets(ledger, {
      exportedAt: new Date().toISOString(),
      sections: options.sections,
    });
    tabs = sheets.length;
    // Summary is a fixed-size cover sheet, so it would inflate the count the
    // user sees; report only real data rows.
    rows = sheets
      .filter((s) => s.name !== 'Summary')
      .reduce((sum, s) => sum + s.rows.length, 0);
    base64 = bytesToBase64(buildXlsx(sheets));
  } catch {
    return { status: 'failed', message: BUDGET_EXPORT_FAILED_MESSAGE, rows: 0 };
  }

  const path = `${FileSystem.cacheDirectory ?? ''}${budgetWorkbookFileName(
    undefined,
    ledger.household.name,
  )}`;
  try {
    await FileSystem.writeAsStringAsync(path, base64, { encoding: 'base64' });
  } catch {
    return { status: 'failed', message: BUDGET_EXPORT_FAILED_MESSAGE, rows };
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return {
        status: 'unsupported',
        message: 'This device has no way to share files, so the export could not be handed over.',
        rows,
      };
    }
    await Sharing.shareAsync(path, {
      mimeType: XLSX_MIME,
      UTI: XLSX_UTI,
      dialogTitle: 'Export budget spreadsheet',
    });
    return {
      status: 'shared',
      message:
        rows === 0
          ? 'Your spreadsheet is ready. There are no ledger rows yet, so the tabs are mostly headers.'
          : `Your spreadsheet is ready — ${rows} row${rows === 1 ? '' : 's'} across ${tabs} tab${
              tabs === 1 ? '' : 's'
            }.`,
      rows,
    };
  } catch {
    return { status: 'failed', message: BUDGET_EXPORT_FAILED_MESSAGE, rows };
  } finally {
    // Cache copy is the share sheet's source; drop it once the sheet closes.
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
}
