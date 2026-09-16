/**
 * SubscriptionService — verifies the constructor accepts both the raw
 * `D1Database` binding (`c.env.DB`) and an already-wrapped Drizzle
 * instance, and that all queries actually run against the wrapped DB.
 *
 * Regression coverage for the production bug where `new
 * SubscriptionService(c.env.DB)` threw `TypeError: this.db.select is not a
 * function` because the service stored the raw binding without wrapping it.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { SubscriptionService } from '../subscription-service';

const testEnv = env as unknown as Env;

const SUBSCRIPTIONS_DDL = `CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  provider TEXT,
  entitlement_id TEXT,
  store_environment TEXT,
  revenuecat_app_user_id TEXT,
  revenuecat_product_id TEXT,
  billing_state TEXT DEFAULT 'normal',
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const USERS_DDL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  password_hash TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

async function setup(): Promise<void> {
  await testEnv.DB.exec(USERS_DDL.replace(/\n/g, ' '));
  await testEnv.DB.exec(SUBSCRIPTIONS_DDL.replace(/\n/g, ' '));
  await testEnv.DB.prepare('DELETE FROM subscriptions').run();
  await testEnv.DB.prepare('DELETE FROM users').run();
  await testEnv.DB.prepare(
    'INSERT INTO users (id, email) VALUES (?, ?)'
  )
    .bind('u_sub_test', 'sub-test@example.com')
    .run();
}

describe('SubscriptionService — D1 binding wrapping', () => {
  beforeEach(setup);

  it('accepts raw c.env.DB binding and runs .select() without throwing', async () => {
    // Reproduces the production crash: `new SubscriptionService(c.env.DB)`
    // used to throw `TypeError: this.db.select is not a function` because
    // the raw binding was stored as-is. With the constructor now wrapping
    // it in Drizzle, this call must succeed and auto-create a free row.
    const svc = new SubscriptionService(testEnv.DB);
    const sub = await svc.getUserSubscription('u_sub_test');
    expect(sub.tier).toBe('free');
    expect(sub.status).toBe('active');
    expect(sub.user_id).toBe('u_sub_test');
  });

  it('accepts a pre-wrapped Drizzle instance without double-wrapping', async () => {
    const wrapped = drizzle(testEnv.DB, { schema });
    const svc = new SubscriptionService(wrapped);
    const sub = await svc.getUserSubscription('u_sub_test');
    expect(sub.tier).toBe('free');
  });

  it('returns the existing row on the second call (no duplicate insert)', async () => {
    const svc = new SubscriptionService(testEnv.DB);
    const first = await svc.getUserSubscription('u_sub_test');
    const second = await svc.getUserSubscription('u_sub_test');
    expect(second.id).toBe(first.id);
  });
});
