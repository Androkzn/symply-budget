import { storageHelpers } from './storage';

// `date` is always supplied by the callers below (each defaults it), so no default here.
function wakeKey(userId: string, date: Date): string {
  return `kaizen.wake.${userId}.${date.toISOString().slice(0, 10)}`;
}

/** Device-local wake confirmation — never synced (matches Simple Health contract). */
export const wakeDetection = {
  isConfirmed(userId: string, date = new Date()): boolean {
    return storageHelpers.getString(wakeKey(userId, date)) === '1';
  },

  confirm(userId: string, date = new Date()): void {
    storageHelpers.setString(wakeKey(userId, date), '1');
  },

  clear(userId: string, date = new Date()): void {
    storageHelpers.remove(wakeKey(userId, date));
  },
};
