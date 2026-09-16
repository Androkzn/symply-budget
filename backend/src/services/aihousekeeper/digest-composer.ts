/**
 * Aihousekeeper weekly digest composer — plan §B12.
 *
 * Composes a weekly email digest from:
 *   - Last 7 days of briefings (`assistant_briefings`).
 *   - Top trust-ledger highlights.
 *   - Open followups.
 *
 * Dispatches via OutboundDispatcher.sendEmail with severity=2, kind='digest'.
 * Stream F's scheduled() handler calls `runDueThisHour(env, now)` at the
 * top of each cron tick; this service checks if any household's local time
 * is Sunday 18:00 and dispatches accordingly.
 */

import { and, desc, eq, gte, isNull } from 'drizzle-orm';

import { generateWithFallback } from '../../ai/fallback';
import type { AIProvider } from '../../ai/provider';
import { householdMembers, users } from '../../db/schema';
import {
  assistantBriefings,
  assistantFollowups,
  assistantIdentity,
  assistantTrustLedger,
} from '../../db/schema-aihousekeeper';
import type { Database, Env } from '../../types';
import { localFirstHouseholdIds } from '../local-first-household-gate';

import type { OutboundDispatcher } from './outbound-dispatcher';
import { hourInTimezone } from './timezone';

const DIGEST_PROMPT_VERSION = 'aihousekeeper-weekly-digest-v1';

const DIGEST_SYSTEM_PROMPT = `You are Aihousekeeper composing a warm, concise weekly digest for a household. You receive the past week's daily briefings, notable trust-ledger entries, and open followups. Produce a short HTML body suitable for email — no <html>/<body> wrapper, just a brief intro paragraph and two or three bullet groups. Use <p>, <ul>, and <li> tags only. Do not invent facts; if a category has nothing, omit it.`;

export interface DigestDependencies {
  db: Database;
  env: Env;
  /**
   * Either one provider, or a factory bound per household so usage rows
   * carry the household the digest was composed for.
   */
  ai: AIProvider | ((householdId: string) => AIProvider);
  dispatcher: OutboundDispatcher;
}

export class DigestComposer {
  private db: Database;
  private env: Env;
  private ai: AIProvider | ((householdId: string) => AIProvider);
  private dispatcher: OutboundDispatcher;

  constructor(params: DigestDependencies) {
    this.db = params.db;
    this.env = params.env;
    this.ai = params.ai;
    this.dispatcher = params.dispatcher;
  }

  /**
   * The provider to use for one household's digest.
   *
   * `ai` may be a factory so the caller can bind usage recording to the
   * household being composed for. `runDueThisHour` iterates every household on
   * one cron tick, so a single shared provider wrote every digest's tokens with
   * a null `household_id` — logged, but absent from every per-household report.
   * Tests still pass a plain provider.
   */
  private aiFor(householdId: string): AIProvider {
    return typeof this.ai === 'function' ? this.ai(householdId) : this.ai;
  }

  /**
   * Compose + send a single household's digest.
   * Returns the digest HTML so callers can attach it to logs or preview.
   */
  async composeFor(householdId: string, weekStartDate: string): Promise<string | null> {
    const context = await this.gatherContext(householdId, weekStartDate);
    if (!context) return null;

    let html: string;
    try {
      const response = await generateWithFallback(
        this.aiFor(householdId),
        this.env.AIHOUSEKEEPER_BRIEFING_MODEL,
        this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
        {
          systemPrompt: DIGEST_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: this.renderContext(context, weekStartDate),
            },
          ],
          maxTokens: 1024,
          cacheControl: { onSystem: { type: 'ephemeral', ttl: '1h' } },
        }
      );
      const text = response.content
        .filter((c) => c.type === 'text')
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('\n')
        .trim();
      html = text || '<p>Quiet week. Nothing to report.</p>';
    } catch {
      html = '<p>Quiet week. Nothing to report.</p>';
    }

    // Recipient = household owner's email.
    const ownerEmail = await this.resolveOwnerEmail(householdId);
    if (!ownerEmail) return html;

    await this.dispatcher.sendEmail({
      householdId,
      toEmail: ownerEmail,
      subject: `Your week at a glance — ${weekStartDate}`,
      html,
      template: 'weekly_digest',
      severity: 2,
      kind: 'digest',
      idempotencyKey: `digest:${householdId}:${weekStartDate}`,
      composedByModel: this.env.AIHOUSEKEEPER_BRIEFING_MODEL,
      promptVersion: DIGEST_PROMPT_VERSION,
    });
    return html;
  }

  /**
   * Scans identity rows and dispatches to households whose local time is
   * Sunday 18:00 right now. Called from Stream F's scheduled() handler.
   */
  async runDueThisHour(now: Date): Promise<{ dispatched: number; skippedLocalFirst: number }> {
    const identities = await this.db.select().from(assistantIdentity).all();
    // H7 P4 (plan §9, Q8): email/push digests are OFF for local-first households.
    // Their week lives in an encrypted on-device ledger, so anything composed
    // here is built from an empty D1 — and unlike most cron work that degrades to
    // a harmless no-op, this one would compose and SEND that emptiness.
    //
    // They are visible at all only because `mirrorLegacyMembership` writes the
    // legacy household rows that chat and the other `/households/:id/...`
    // features authorise against.
    const localFirst = await localFirstHouseholdIds(this.env);
    let dispatched = 0;
    let skippedLocalFirst = 0;
    for (const identity of identities) {
      try {
        if (localFirst.has(identity.household_id)) {
          skippedLocalFirst += 1;
          continue;
        }
        const tz = identity.timezone || 'UTC';
        const hour = hourInTimezone(now, tz);
        if (hour !== 18) continue;
        const local = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          weekday: 'short',
        }).format(now);
        if (local !== 'Sun') continue;
        const weekStart = this.weekStartDate(now, tz);
        await this.composeFor(identity.household_id, weekStart);
        dispatched += 1;
      } catch (err) {
        console.error('[DigestComposer] per-household error', {
          householdIdPrefix: identity.household_id.slice(0, 8),
          error: (err as Error).message,
        });
      }
    }
    if (skippedLocalFirst > 0) {
      console.log(
        `[DigestComposer] skipped ${skippedLocalFirst} local-first household(s) — digests are in-app only (H7 P4)`
      );
    }
    return { dispatched, skippedLocalFirst };
  }

  // ---------- internals ----------

  private async gatherContext(householdId: string, weekStartDate: string) {
    const since = weekStartDate;
    const [briefings, ledger, followups] = await Promise.all([
      this.db
        .select()
        .from(assistantBriefings)
        .where(
          and(
            eq(assistantBriefings.household_id, householdId),
            gte(assistantBriefings.date, since)
          )
        )
        .orderBy(desc(assistantBriefings.date))
        .limit(7)
        .all(),
      this.db
        .select()
        .from(assistantTrustLedger)
        .where(
          and(
            eq(assistantTrustLedger.household_id, householdId),
            gte(assistantTrustLedger.occurred_at, since),
            isNull(assistantTrustLedger.user_dismissed_at)
          )
        )
        .orderBy(desc(assistantTrustLedger.occurred_at))
        .limit(10)
        .all(),
      this.db
        .select()
        .from(assistantFollowups)
        .where(
          and(
            eq(assistantFollowups.household_id, householdId),
            eq(assistantFollowups.status, 'pending')
          )
        )
        .limit(10)
        .all(),
    ]);
    return { briefings, ledger, followups };
  }

  private renderContext(
    ctx: {
      briefings: Array<{ date: string; paragraph: string; empty_reason: string | null }>;
      ledger: Array<{ summary: string }>;
      followups: Array<{ prompt: string; scheduled_for: string }>;
    },
    weekStartDate: string
  ): string {
    const lines: string[] = [];
    lines.push(`Week starting ${weekStartDate}.`);
    lines.push('');
    lines.push('Daily briefings:');
    for (const b of ctx.briefings) {
      if (b.empty_reason) {
        lines.push(`  - ${b.date}: (quiet: ${b.empty_reason})`);
      } else {
        lines.push(`  - ${b.date}: ${b.paragraph}`);
      }
    }
    lines.push('');
    lines.push('Trust ledger highlights:');
    for (const l of ctx.ledger) {
      lines.push(`  - ${l.summary}`);
    }
    lines.push('');
    lines.push('Open followups:');
    for (const f of ctx.followups) {
      lines.push(`  - ${f.prompt} (due ${f.scheduled_for})`);
    }
    return lines.join('\n');
  }

  private async resolveOwnerEmail(householdId: string): Promise<string | null> {
    const row = await this.db
      .select({ email: users.email })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.user_id, users.id))
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          eq(householdMembers.role, 'owner')
        )
      )
      .limit(1)
      .get();
    return row?.email ?? null;
  }

  private weekStartDate(now: Date, tz: string): string {
    // Use Intl to get the weekday in the household's tz, then back up to
    // Monday (the app-wide Monday-Sunday week convention). Return YYYY-MM-DD.
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(now);
    const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '1970', 10);
    const mo = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1', 10);
    const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1', 10);
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
    const wdIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd);
    const dayOfMonth = d - (wdIndex >= 0 ? wdIndex : 0);
    const dt = new Date(Date.UTC(y, mo - 1, dayOfMonth));
    return dt.toISOString().slice(0, 10);
  }
}
