import { bytesToHex, randomBytes } from '@symply/local-first';

export function newLocalId(prefix: string): string {
  return `${prefix}_${bytesToHex(randomBytes(8))}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function expenseInMonth(expenseDate: string, year: number, month: number): boolean {
  return expenseDate.startsWith(monthKey(year, month));
}
