import { drizzle } from 'drizzle-orm/d1';

import { createProviderAdapter } from '../ai/provider-factory';
import { isHealthApiEnabled, isHomeApiEnabled } from '../config/brand-capabilities';
import { isBudgetApiEnabled } from '../config/budget-api';
import { isLocalFirstApiEnabled } from '../config/local-first-api';
import * as aihousekeeperSchema from '../db/schema';
import { ApprovalQueueShim } from '../services/ai/approval-queue-shim';
import {
  sweepStuckGeneratingGardenPlans,
} from '../services/ai/garden-plan-job-handler';
import {
  sweepStuckGeneratingSchematics,
} from '../services/ai/home-project-schematic-job-handler';
import { sweepStuckSmartDrafts } from '../services/ai/home-project-smart-draft-job-handler';
import {
  sweepStuckEnrichingTasks,
} from '../services/ai/task-enrichment-handler';
import { reconcileYesterday } from '../services/ai-cost-reconciliation-service';
import { runAiModelCatalogHousekeeping } from '../services/ai-model-catalog-health-service';
import { runAiUsageRollup } from '../services/ai-usage-rollup-service';
import { usageRecorderFor } from '../services/ai-usage-service';
import {
  composeBriefingsDueThisHour,
  enqueueOutboundLoop,
} from '../services/aihousekeeper/outbound-loop';
import { DigestComposer } from '../services/aihousekeeper/digest-composer';
import { dlqScanner } from '../services/aihousekeeper/dlq-scanner';
import { AihousekeeperEventBus } from '../services/aihousekeeper/event-bus';
import { ExpoPushClient } from '../services/aihousekeeper/expo-push';
import { OutboundDispatcher } from '../services/aihousekeeper/outbound-dispatcher';
import { TrustLedgerService } from '../services/aihousekeeper/trust-ledger-service';
import { isNotificationsDeliveryPaused } from '../services/config-flags';
import { topUpHabitReminders } from '../services/health/habit-reminder';
import { sweepStuckProcessingReports } from '../services/enhanced-pdf-processor';
import {
  scheduleHealthRemindersForAllUsers,
  sweepSatisfiedHealthReminders,
} from '../services/health-reminders-service';
import { createSendGridClient } from '../services/integrations/sendgrid';
import { NotificationService } from '../services/notification-service';
import { processDueRecurringReminders } from '../services/recurring-reminders/engine';
import { ReminderService } from '../services/reminder-service';
import type { Env } from '../types';
import { AIHousekeeperWorker } from '../workers/ai-housekeeper-worker';
import { BudgetAlertWorker } from '../workers/budget-alert-worker';
import { MortgageRenewalWorker } from '../workers/mortgage-renewal-worker';
import { SavingsAlertWorker } from '../workers/savings-alert-worker';
import { SavingsIncomeRolloverWorker } from '../workers/savings-income-rollover-worker';
import { SavingsRecurringPaymentDueWorker } from '../workers/savings-recurring-payment-due-worker';

import { runTimestampBackfillChunk } from './timestamp-backfill-stub';


/**
 * Aihousekeeper weekly digest runner — plan §F1 / §B12. Builds the minimal runtime
 * (bus + ledger + dispatcher + integration clients) needed by
 * DigestComposer and delegates to its `runDueThisHour`.
 */
async function runAihousekeeperWeeklyDigest(env: Env, now: Date): Promise<void> {
  const db = drizzle(env.DB, { schema: aihousekeeperSchema });
  const events = new AihousekeeperEventBus();
  // Ledger subscribes to the bus in its constructor.
  new TrustLedgerService(db, events);
  // Built per household rather than once for the tick: `runDueThisHour` walks
  // every household, so a single shared adapter attributed the whole week's
  // digest spend to nobody (null household_id) and it never appeared in any
  // usage report.
  const ai = (householdId: string) =>
    createProviderAdapter({
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY ?? '',
      options: {
        onUsage: usageRecorderFor(env, {
          feature: 'aihousekeeper_digest',
          householdId,
        }),
      },
    });
  const expoPush = new ExpoPushClient();
  const sendgrid = createSendGridClient({
    SENDGRID_API_KEY: env.SENDGRID_API_KEY,
    SENDGRID_DIGEST_TEMPLATE_ID: env.SENDGRID_DIGEST_TEMPLATE_ID,
    SENDGRID_FROM_EMAIL: env.SENDGRID_FROM_EMAIL,
  });
  const dispatcher = new OutboundDispatcher({
    db,
    env,
    events,
    expoPush,
    sendgrid,
  });
  const composer = new DigestComposer({ db, env, ai, dispatcher });
  await composer.runDueThisHour(now);
}

/** Cron handler for scheduled notifications, reminders, and brand-gated workers. */
export async function handleScheduled(
  event: ScheduledController,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  console.log(`Cron triggered at ${new Date(event.scheduledTime).toISOString()}`);

  // House-domain crons (task reminders, overdue tasks, AI Housekeeper, garden/
  // maintenance pipelines, briefings) run ONLY on the House Worker. Child apps
  // (Budget/Kaizen/Health) are fully independent and must not generate House
  // notifications from their own D1. Delivery (processScheduledNotifications,
  // push receipts) and the budget crons stay enabled per-brand as before.
  const homeApiEnabled = isHomeApiEnabled(env);

  const deliveryPaused = await isNotificationsDeliveryPaused(env);

  // Symply Health reminder SWEEP — Health Worker only, and deliberately the
  // FIRST thing on the tick.
  //
  // It cancels queued meal / water / weigh-in / habit nudges the member has
  // already made pointless (lunch logged at 12:30, the habit already ticked),
  // which is only correct if it runs BEFORE the delivery pass below picks the
  // same rows up. Do not move it after `processScheduledNotifications` — that
  // would send the nudge first and cancel it afterwards, which is worse than not
  // having a sweep at all.
  if (isHealthApiEnabled(env) && !deliveryPaused) {
    try {
      const swept = await sweepSatisfiedHealthReminders(env.DB, new Date(event.scheduledTime));
      if (swept.cancelled > 0) {
        console.log(
          `[health-reminders] sweep cancelled ${swept.cancelled}/${swept.examined} already-satisfied reminders`
        );
      }
    } catch (error) {
      console.error('Error sweeping satisfied health reminders:', error);
    }
  }

  // Recurring reminders — "keep nagging until it's actually done" action items
  // (services/recurring-reminders/). Brand-agnostic, like the delivery pass
  // below: it only ever finds rows in the D1 of the Worker that created them
  // (today, mortgage statement reminders on Budget). Runs BEFORE
  // `processScheduledNotifications` so a nudge materialised "due now" this
  // tick is delivered in the same pass rather than waiting another 5 minutes.
  if (!deliveryPaused) {
    try {
      const nudged = await processDueRecurringReminders(env, env.DB);
      if (nudged > 0) console.log(`[recurring-reminders] nudged ${nudged} due reminders`);
    } catch (error) {
      console.error('Error processing recurring reminders:', error);
    }
  }

  // Process scheduled notifications (B0 kill switch)
  if (deliveryPaused) {
    console.log('Skipped scheduled notifications — notifications_delivery_paused');
  } else try {
    const notificationService = new NotificationService(env, env.DB);
    const sentCount = await notificationService.processScheduledNotifications();
    console.log(`Processed ${sentCount} scheduled notifications`);
  } catch (error) {
    console.error('Error processing scheduled notifications:', error);
  }

  // Poll Expo for real push delivery receipts (a send 'ok' ticket only means
  // Expo accepted the request, not that APNs/FCM actually delivered it).
  try {
    const notificationService = new NotificationService(env, env.DB);
    const receiptResult = await notificationService.checkPendingPushReceipts();
    if (receiptResult.checked > 0) {
      console.log(`Checked ${receiptResult.checked} push receipts, ${receiptResult.errors} delivery errors`);
    }
  } catch (error) {
    console.error('Error checking push receipts:', error);
  }

  // Symply Health habit reminders — Health Worker only. `scheduled_notifications`
  // has no recurrence column, so a repeating reminder is N materialised rows
  // (see services/health/habit-reminder.ts). Habit writes materialise 14 days;
  // this daily sweep tops that window up so a member who never edits a habit
  // still gets nudged — the hole `scheduleGarbageReminders` has and this closes.
  // Once a day at 02:00 UTC: the rows themselves carry local fire times, so the
  // sweep's own hour only decides when the window is extended, not when it pings.
  {
    const sweepNow = new Date(event.scheduledTime);
    if (
      isHealthApiEnabled(env) &&
      !deliveryPaused &&
      sweepNow.getUTCHours() === 2 &&
      sweepNow.getUTCMinutes() < 5
    ) {
      try {
        const scheduled = await topUpHabitReminders(env, env.DB, sweepNow);
        console.log(`Topped up ${scheduled} health habit reminders`);
      } catch (error) {
        console.error('Error topping up health habit reminders:', error);
      }

      // Same window, same reason: materialise the member's NEXT LOCAL DAY of
      // meal / water / weigh-in nudges. "Next local day" rather than "next 24
      // hours" is what makes ONE daily UTC pass correct for every timezone —
      // whatever the offset, a member's local tomorrow is 13-48h ahead of 02:00
      // UTC, so every row lands in the future and exactly once per local day.
      // Idempotent, so a cron retry inside the 5-minute window cannot double-book.
      try {
        const result = await scheduleHealthRemindersForAllUsers(env, env.DB, sweepNow);
        console.log(
          `[health-reminders] scheduled ${result.reminders} reminders for ${result.scheduled}/${result.candidates} members`,
          result.skipped
        );
      } catch (error) {
        console.error('Error scheduling health reminders:', error);
      }
    }
  }

  // Process maintenance task reminders — House app only (see isHomeApiEnabled).
  if (homeApiEnabled && deliveryPaused) {
    console.log('Skipped task reminders — notifications_delivery_paused');
  } else if (homeApiEnabled) try {
    const reminderService = new ReminderService(env, env.DB);
    const reminderResult = await reminderService.processReminders();
    console.log(`Processed ${reminderResult.processed} tasks, sent ${reminderResult.sent} reminders`);
    if (reminderResult.errors.length > 0) {
      console.error('Reminder errors:', reminderResult.errors);
    }
  } catch (error) {
    console.error('Error processing reminders:', error);
  }

  // Process overdue task notifications (once per day at 8 AM UTC - check minute)
  const now = new Date(event.scheduledTime);
  if (homeApiEnabled && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
    try {
      const reminderService = new ReminderService(env, env.DB);
      const overdueResult = await reminderService.processOverdueTasks();
      console.log(`Processed ${overdueResult.processed} overdue tasks, sent ${overdueResult.sent} notifications`);
    } catch (error) {
      console.error('Error processing overdue tasks:', error);
    }
  }

  // Local-first mailbox/checkpoint/blob sweeps (opaque ciphertext only).
  if (isLocalFirstApiEnabled(env)) {
    try {
      const { LocalFirstMailboxService } = await import('../services/local-first-mailbox-service');
      const removed = await new LocalFirstMailboxService(env).sweepExpired();
      if (removed > 0) {
        console.log(`[local-first-mailbox] swept ${removed} expired/acked blobs`);
      }
    } catch (error) {
      console.error('[local-first-mailbox] sweep failed', error);
    }
    try {
      const { LocalFirstCheckpointService } = await import(
        '../services/local-first-checkpoint-service'
      );
      const removed = await new LocalFirstCheckpointService(env).sweepExpired();
      if (removed > 0) {
        console.log(`[local-first-checkpoint] swept ${removed} expired checkpoint rows`);
      }
    } catch (error) {
      console.error('[local-first-checkpoint] sweep failed', error);
    }
    // H6: attachment bytes. Unlike the two above this is NOT a TTL sweep —
    // blobs are retained until their ledger row is tombstoned AND the
    // checkpoint watermark has passed (plan Q4), plus abandoned `pending`
    // uploads that no ledger row will ever reference.
    try {
      const { LocalFirstBlobService } = await import('../services/local-first-blob-service');
      const removed = await new LocalFirstBlobService(env).sweepPurgeable(500, now);
      if (removed > 0) {
        console.log(`[local-first-blob] swept ${removed} purgeable blob chunks`);
      }
    } catch (error) {
      console.error('[local-first-blob] sweep failed', error);
    }
    // Invites nobody acted on in time.
    //
    // `expires_at` was purely advisory on this tier: the claim path rejects a
    // stale invite, but the ROW stayed `active`/`claimed` forever — so a device
    // that claimed and was never approved showed "Waiting for approval…"
    // indefinitely, with nothing anywhere to say the wait was already over.
    // Retiring the row is what makes that state end, and the notification is
    // what makes the person find out.
    try {
      const { LocalFirstControlService } = await import(
        '../services/local-first-control-service'
      );
      const { notifyLocalFirstInviteEvent } = await import(
        '../services/local-first-invite-notifications'
      );
      const expired = await new LocalFirstControlService(env).sweepExpiredInvites(
        now.toISOString(),
      );
      for (const context of expired) {
        await notifyLocalFirstInviteEvent(env, 'expired', context);
      }
      if (expired.length > 0) {
        console.log(`[local-first-invites] expired ${expired.length} claimed invites`);
      }
    } catch (error) {
      console.error('[local-first-invites] expiry sweep failed', error);
    }
  }

  // Smart Budget cron — Budget Worker only (House: BUDGET_API_ENABLED=false).
  if (isBudgetApiEnabled(env) && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
    try {
      const budgetAlertWorker = new BudgetAlertWorker(env, env.DB);
      const result = await budgetAlertWorker.checkOverBudgetAlerts(now);
      console.log(`Budget alerts: checked ${result.checked} households, sent ${result.alertsSent} alerts`);
    } catch (error) {
      console.error('Error checking budget alerts:', error);
    }
  }

  // Savings: daily behind-pace goal alert check (8 AM UTC). Dispatched inside
  // the existing scheduled() handler — NO new cron trigger (account is at its
  // 5-cron limit). Dormant until cron is re-enabled; the worker is a no-op if
  // savings_enabled === 'false'.
  if (isBudgetApiEnabled(env) && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
    try {
      const w = new SavingsAlertWorker(env, env.DB);
      const r = await w.checkBehindPaceGoals(now);
      console.log('[savings-alert-worker] notified', r.notified);
    } catch (e) {
      console.error('[savings-alert-worker] failed', e);
    }
  }

  // Mortgage: renewal reminders (daily 08:00 UTC, Budget-gated). No new cron
  // trigger — runs inside the existing scheduled() handler. Dormant until cron is
  // re-enabled; no-op if mortgage_enabled === 'false'.
  if (isBudgetApiEnabled(env) && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
    try {
      const w = new MortgageRenewalWorker(env, env.DB);
      const r = await w.checkMaturingMortgages(now);
      console.log('[mortgage-renewal-worker] notified', r.notified);
    } catch (e) {
      console.error('[mortgage-renewal-worker] failed', e);
    }
  }

  // Savings: monthly income rollover — draft next month's regular income from
  // last month's confirmed entries, then nudge the household to confirm them
  // (recurring-reminders engine). Runs the first 3 days of the month (not just
  // day 1) as a safety net for a missed tick; idempotent via the unique index
  // on rolled_over_from_entry_id (migration 0149), so re-runs after the first
  // success are no-ops. No new cron trigger — Budget-gated, no-op if
  // savings_enabled === 'false'.
  if (isBudgetApiEnabled(env) && now.getUTCDate() <= 3 && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
    try {
      const w = new SavingsIncomeRolloverWorker(env, env.DB);
      const r = await w.rolloverRegularIncomeForAllHouseholds(now);
      console.log(`[savings-income-rollover-worker] created ${r.created} drafts for ${r.households} households`);
    } catch (e) {
      console.error('[savings-income-rollover-worker] failed', e);
    }
  }

  // Savings: monthly "payment due soon" reminders — every ACTIVE, non-
  // automated recurring payment with a day_of_month gets a reminder whose
  // first nudge fires 5 business days before this month's due date, then
  // re-nudges daily until marked done (recurring-reminders engine). Runs the
  // first 3 days of the month, same safety-net window as the income rollover
  // above; idempotent via upsertRecurringReminder's per-period no-op. No new
  // cron trigger — Budget-gated, no-op if savings_enabled === 'false'.
  if (isBudgetApiEnabled(env) && now.getUTCDate() <= 3 && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
    try {
      const w = new SavingsRecurringPaymentDueWorker(env, env.DB);
      const r = await w.scheduleDueRemindersForAllHouseholds(now);
      console.log(`[savings-recurring-payment-due-worker] scheduled ${r.scheduled} reminders for ${r.households} households`);
    } catch (e) {
      console.error('[savings-recurring-payment-due-worker] failed', e);
    }
  }

  // Smart Budget: weekly AI digest (Sundays at 8 PM UTC)
  if (
    isBudgetApiEnabled(env) &&
    now.getUTCDay() === 0 &&
    now.getUTCHours() === 20 &&
    now.getUTCMinutes() < 5
  ) {
    try {
      const budgetAlertWorker = new BudgetAlertWorker(env, env.DB);
      const digestsSent = await budgetAlertWorker.sendWeeklyDigests(now);
      console.log(`Budget: sent ${digestsSent} weekly digests`);
    } catch (error) {
      console.error('Error sending budget weekly digests:', error);
    }
  }

  // Smart Budget: weekly encouragement — celebrate real wins (Fridays at 5 PM UTC)
  if (
    isBudgetApiEnabled(env) &&
    now.getUTCDay() === 5 &&
    now.getUTCHours() === 17 &&
    now.getUTCMinutes() < 5
  ) {
    try {
      const budgetAlertWorker = new BudgetAlertWorker(env, env.DB);
      const encouragementsSent = await budgetAlertWorker.sendWeeklyEncouragements(now);
      console.log(`Budget: sent ${encouragementsSent} weekly encouragements`);
    } catch (error) {
      console.error('Error sending budget weekly encouragements:', error);
    }
  }

  // AI Housekeeper: Analyze households and generate suggestions (every 6 hours)
  // Runs at 00:00, 06:00, 12:00, 18:00 UTC — House app only.
  if (homeApiEnabled && now.getUTCHours() % 6 === 0 && now.getUTCMinutes() < 5) {
    try {
      const aiWorker = new AIHousekeeperWorker(env, env.DB);
      const results = await aiWorker.execute();
      console.log(`AI Housekeeper: Processed ${results.households_processed} households, generated ${results.suggestions_generated} suggestions, ${results.predictions_generated} predictions, scheduled ${results.notifications_scheduled} notifications`);
      if (results.errors.length > 0) {
        console.error('AI Housekeeper errors:', results.errors);
      }
    } catch (error) {
      console.error('Error in AI Housekeeper worker:', error);
    }
  }

  // AI Housekeeper: Send daily digests (at 8 AM UTC) — House app only.
  if (homeApiEnabled && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
    try {
      const aiWorker = new AIHousekeeperWorker(env, env.DB);
      const digestsSent = await aiWorker.sendDailyDigests();
      console.log(`AI Housekeeper: Sent ${digestsSent} daily digests`);
    } catch (error) {
      console.error('Error sending AI Housekeeper daily digests:', error);
    }
  }

  // AI Housekeeper: Send weekly summaries (Sundays at 8 PM UTC) — House app only.
  if (homeApiEnabled && now.getUTCDay() === 0 && now.getUTCHours() === 20 && now.getUTCMinutes() < 5) {
    try {
      const aiWorker = new AIHousekeeperWorker(env, env.DB);
      const summariesSent = await aiWorker.sendWeeklySummaries();
      console.log(`AI Housekeeper: Sent ${summariesSent} weekly summaries`);
    } catch (error) {
      console.error('Error sending AI Housekeeper weekly summaries:', error);
    }
  }

  // ================================================================
  // Aihousekeeper (Proactive Layer) — plan §F1 minute-of-hour dispatch.
  // House app only — child apps (Budget/Kaizen/Health) stay independent and
  // never run House briefings / garden / maintenance pipelines.
  // ================================================================
  if (homeApiEnabled) {
  const minute = now.getUTCMinutes();

  // Every 15 min: enqueue per-household outbound work.
  if (minute % 15 === 0) {
    try {
      await enqueueOutboundLoop(env);
    } catch (error) {
      console.error('Error enqueuing Aihousekeeper outbound loop:', error);
    }
  }

  // Top of hour: compose briefings for households whose local briefing
  // time matches the current hour. Push is handled separately by the
  // briefing dispatcher inside the outbound consumer.
  if (minute === 0) {
    try {
      await composeBriefingsDueThisHour(env, now);
    } catch (error) {
      console.error('Error composing Aihousekeeper briefings:', error);
    }
  }

  // Minute 30: scan the DLQ and alert if concerning.
  if (minute === 30) {
    try {
      await dlqScanner.scanAndAlert(env);
    } catch (error) {
      console.error('Error in Aihousekeeper DLQ scanner:', error);
    }
  }

  // Every 15 min (alongside the outbound-loop enqueue): sweep expired
  // HIGH_WRITE approval rows. Any `ai_tool_pending` row whose `expires_at`
  // has passed gets status='expired'. Default TTL is 72h per §B19 so the
  // sweep at 15-min cadence is plenty.
  if (minute % 15 === 0) {
    try {
      const approvals = new ApprovalQueueShim(env.DB);
      const count = await approvals.sweepExpired(now);
      if (count > 0) {
        console.log(`Aihousekeeper approval sweep: expired ${count} pending row(s)`);
      }
    } catch (error) {
      console.error('Error in Aihousekeeper approval expiry sweep:', error);
    }
  }

  // Every 5 min: reconcile garden_plans rows stuck in 'generating' past the
  // grace window. Catches catastrophic queue-handler crashes (DLQ + handler
  // throw on the final attempt) so users aren't left staring at a perma-
  // spinning card. Safe to run independently of cron cadence — the helper
  // is idempotent and bounded by a SQL filter.
  if (minute % 5 === 0) {
    try {
      const result = await sweepStuckGeneratingGardenPlans(env, now);
      if (result.reconciled > 0) {
        console.log(
          `Garden-plan sweep: reconciled ${result.reconciled}/${result.scanned} stuck row(s)`
        );
      }
    } catch (error) {
      console.error('Error in garden-plan stuck-row sweep:', error);
    }

    // Same cadence: reconcile maintenance_tasks stuck in 'enriching' past the
    // grace window (handler crash / DLQ) so quick-captured task cards stop
    // spinning. Idempotent + SQL-bounded, like the garden-plan sweep above.
    try {
      const result = await sweepStuckEnrichingTasks(env, now);
      if (result.reconciled > 0) {
        console.log(
          `Task-enrich sweep: reconciled ${result.reconciled}/${result.scanned} stuck row(s)`
        );
      }
    } catch (error) {
      console.error('Error in task-enrichment stuck-row sweep:', error);
    }

    try {
      const result = await sweepStuckGeneratingSchematics(env, now);
      if (result.reconciled > 0) {
        console.log(
          `Home-project schematic sweep: reconciled ${result.reconciled}/${result.scanned} stuck row(s)`
        );
      }
    } catch (error) {
      console.error('Error in home-project schematic stuck-row sweep:', error);
    }

    // Same cadence, same reason: a Smart Project draft left 'generating' by a
    // dead worker spins forever in the UI, and the enqueue path refuses a
    // second job while one is in flight — so without this the member cannot
    // retry at all.
    try {
      const result = await sweepStuckSmartDrafts(env, now);
      if (result.reconciled > 0) {
        console.log(
          `Home-project smart-draft sweep: reconciled ${result.reconciled}/${result.scanned} stuck row(s)`
        );
      }
    } catch (error) {
      console.error('Error in home-project smart-draft stuck-row sweep:', error);
    }

    // Same cadence: reconcile reports stuck in 'processing' past the grace
    // window (dropped Lambda callback) so users aren't left with a spinner.
    try {
      const result = await sweepStuckProcessingReports(env, now);
      if (result.reconciled > 0) {
        console.log(
          `Report sweep: reconciled ${result.reconciled}/${result.scanned} stuck row(s)`
        );
      }
    } catch (error) {
      console.error('Error in report stuck-row sweep:', error);
    }
  }

  // Top of hour: dispatch weekly digests. DigestComposer.runDueThisHour
  // filters to households whose LOCAL time is Sunday 18:00, so — like the
  // daily-briefing dispatch above — this MUST run every top-of-hour to cover
  // all timezones. Gating on UTC Sunday 18:00+ dropped every household whose
  // local Sun-18:00 falls on another UTC hour/day (all of Europe/Asia/Aus and
  // US Mountain/Pacific never fired; the digest idempotency key makes the
  // hourly scan safe against any double-send).
  if (minute === 0) {
    try {
      await runAihousekeeperWeeklyDigest(env, now);
    } catch (error) {
      console.error('Error in Aihousekeeper weekly digest dispatch:', error);
    }
  }
  } // end if (homeApiEnabled) — Aihousekeeper proactive layer (House only)

  // AI usage housekeeping — 03:10 UTC daily, on every brand's Worker (each has
  // its own D1 and therefore its own `ai_usage_events`).
  //
  // Deliberately after 00:00 by a margin: it rolls up *completed* days, and a
  // tick that fires at exactly midnight would race rows still being written for
  // the day that just ended.
  if (now.getUTCHours() === 3 && now.getUTCMinutes() >= 10 && now.getUTCMinutes() < 15) {
    try {
      await runAiUsageRollup(env, now);
    } catch (error) {
      console.error('Error in AI usage rollup:', error);
    }

    // Drift check against the providers' own bills. No-ops without an admin
    // key, which is the normal state for a BYOK-only deployment.
    try {
      await reconcileYesterday(env, now);
    } catch (error) {
      console.error('Error in AI cost reconciliation:', error);
    }

    // The other half of the same idea, on the MODEL catalog rather than the
    // rate table: ask each provider which models it still serves (so an entry
    // that has gone away is caught before a member's scan fails on it), and
    // repoint stored user picks that our own catalog no longer contains.
    try {
      await runAiModelCatalogHousekeeping(env, now);
    } catch (error) {
      console.error('Error in AI model catalog housekeeping:', error);
    }
  }

  // B10: timestamp backfill (CONFIG_KV `timestamp_backfill_enabled`, default off).
  // When enabled, run one chunk every cron tick (*/5) until approved tables complete.
  // Enable: wrangler kv key put --binding CONFIG_KV --env <env> --remote timestamp_backfill_enabled true
  try {
    const result = await runTimestampBackfillChunk(env);
    if (!result.skipped) {
      console.log('[timestamp-backfill]', result);
    }
  } catch (error) {
    console.error('Error in timestamp backfill chunk:', error);
  }
}
