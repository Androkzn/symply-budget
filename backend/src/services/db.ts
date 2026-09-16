import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type { Database } from '../types';

/** Shared D1 drizzle factory — routes must not import this; services only. */
export function createDb(d1: D1Database, extraSchema?: Record<string, unknown>): Database {
  return drizzle(d1, {
    schema: extraSchema ? { ...schema, ...extraSchema } : schema,
  });
}
