import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { nanoid } from 'nanoid';

import * as schema from '../db/schema';
import { subscriptions } from '../db/schema';
import type { NewSubscription, Subscription } from '../db/schema';
import type { Database, Env } from '../types';
import { nowIso } from '../utils/id';

import {
  getSubscriptionForEntitlement,
  isEffectivelyPaid,
  resolveAIEntitlement,
  getUserEmailForEntitlement,
} from './entitlement-service';

export class SubscriptionService {
  private readonly db: Database;
  private readonly rawDb: D1Database | null;

  /**
   * Accepts either a raw `D1Database` (the binding from `c.env.DB`) or an
   * already-wrapped Drizzle instance. The route handlers all pass the raw
   * binding, so wrap it here to expose the `.select()` / `.insert()` API
   * the rest of this class depends on.
   */
  constructor(db: D1Database | Database) {
    if (isDrizzle(db)) {
      this.db = db;
      this.rawDb = null;
    } else {
      this.db = drizzle(db, { schema }) as unknown as Database;
      this.rawDb = db;
    }
  }

  /**
   * Get user's subscription
   * Creates a free subscription if one doesn't exist
   */
  async getUserSubscription(userId: string): Promise<Subscription> {
    const [existing] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.user_id, userId))
      .limit(1);

    if (existing) {
      return existing;
    }

    return await this.createFreeSubscription(userId);
  }

  /**
   * Create a free tier subscription for a new user
   */
  async createFreeSubscription(userId: string): Promise<Subscription> {
    const now = nowIso();
    const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const newSubscription: NewSubscription = {
      id: nanoid(),
      user_id: userId,
      tier: 'free',
      status: 'active',
      current_period_start: now,
      current_period_end: periodEnd,
      cancel_at_period_end: false,
    };

    const [subscription] = await this.db
      .insert(subscriptions)
      .values(newSubscription)
      .returning();

    return subscription;
  }

  /**
   * Usage limits. When `env` is provided, `hasAdvancedAI` derives from
   * canonical entitlement (paid or BYOK), not legacy tier matrices.
   */
  async getUsageLimits(
    userId: string,
    env?: Env
  ): Promise<{
    tier: string;
    maxReportsPerMonth: number;
    hasAdvancedAI: boolean;
    hasAPIAccess: boolean;
  }> {
    const subscription = await this.getUserSubscription(userId);

    let userEmail: string | null = null;
    if (env?.DB) {
      try {
        userEmail = await getUserEmailForEntitlement(env.DB, userId);
      } catch {
        userEmail = null;
      }
    }

    let hasAdvancedAI = false;
    if (env) {
      const entitlement = await resolveAIEntitlement(userId, env, { userEmail });
      hasAdvancedAI = entitlement.allowed;
    } else if (this.rawDb) {
      const row = await getSubscriptionForEntitlement(this.rawDb, userId);
      hasAdvancedAI = isEffectivelyPaid(row, userEmail);
    }

    const paidRow = this.rawDb
      ? await getSubscriptionForEntitlement(this.rawDb, userId)
      : null;
    const isPaidLike =
      hasAdvancedAI ||
      isEffectivelyPaid(paidRow, userEmail) ||
      subscription.tier === 'basic' ||
      subscription.tier === 'premium' ||
      subscription.tier === 'pro' ||
      subscription.entitlement_id === 'pro';

    return {
      tier: subscription.tier,
      maxReportsPerMonth: isPaidLike ? -1 : 5,
      hasAdvancedAI,
      hasAPIAccess: subscription.tier === 'premium' || subscription.tier === 'pro',
    };
  }
}

function isDrizzle(db: D1Database | Database): db is Database {
  return typeof (db as { select?: unknown }).select === 'function';
}
