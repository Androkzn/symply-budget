import { v5 as uuidv5 } from 'uuid';

/** Stable namespace — matches Simple Health `UUID(deterministicFrom: "kaizen.seed.*")`. */
const SEED_NAMESPACE = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

export function kaizenSeedId(key: string): string {
  return uuidv5(`kaizen.seed.${key}`, SEED_NAMESPACE);
}

/** Deterministic action-log id: one row per (action, calendar day). */
export function actionLogId(actionId: string, day: Date = new Date()): string {
  const key = day.toISOString().slice(0, 10);
  const start = new Date(`${key}T00:00:00`);
  const dayEpoch = Math.floor(start.getTime() / 1000);
  return uuidv5(`kaizen.actionlog|${actionId}|${dayEpoch}`, SEED_NAMESPACE);
}
