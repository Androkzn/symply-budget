import { ConflictError } from './errors';

type D1RunResult = { meta?: { changes?: number } };

/** Rows affected by a Drizzle D1 `.run()` (CAS gate). */
export function rowsChanged(result: unknown): number {
  return (result as D1RunResult | undefined)?.meta?.changes ?? 0;
}

/** Throw 409 when a compare-and-swap update matched zero rows. */
export function assertOptimisticLock(
  result: unknown,
  message = 'Resource was modified by another request'
): void {
  if (rowsChanged(result) === 0) {
    throw new ConflictError(message);
  }
}
