/**
 * Smart Notification Gateway (Smart Notifications — Phase 1).
 *
 * A thin front door that notification producers call instead of talking to
 * `NotificationService` directly. In P1 it runs in **pass-through** mode:
 * behaviour is identical to today (same recipients, same template copy, same
 * timing, same canonical delivery), and the only added effect is a
 * `smart_notification_decision` telemetry row per recipient. That parity
 * telemetry is what lets us prove each migrated producer is behaviour-identical
 * for ≥7 days before any smart behaviour (dedup, batching, fatigue control, AI
 * copy) is switched on in later phases.
 *
 * Invariants honoured here (see SmartNotifications_TRD §8.4 / D-02):
 *   - Delivery is always performed by the canonical NotificationService → Expo.
 *   - Decision logging is best-effort: a logging failure must NEVER block or
 *     fail a send. Producers' own work is already committed by the time they
 *     call the gateway.
 *
 * See: documents/Requirenments/SmartNotifications/SmartNotifications_TRD_v1.0.md
 */

import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { smartNotificationDecision } from '../db/schema-notifications';
import type { Env } from '../types';

import { NotificationService } from './notification-service';

/** Lane classification — see TRD §6.1 / BR-02. */
export type Lane = 'A' | 'B';

/**
 * Producer types that are time-critical or action-required. These are Lane A
 * (immediate) and, in later phases, are exempt from holding / batching /
 * fatigue suppression. Anything not listed defaults to Lane B (optimizable).
 *
 * Kept deliberately conservative: when unsure, a type stays Lane B only if it
 * is genuinely timing-flexible. Final per-type rules are confirmed in TRD §19 Q-05.
 */
const IMMEDIATE_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  'task_overdue',
  'garbage_collection',
  'garbage_reminder',
  'garbage_missed',
  'critical_findings',
  'critical_drafts',
  'report_ready',
  'household_update',
  'household_updates',
  'task_assigned',
  'garden_plan_ready',
  'garden_plan_failed',
]);

/**
 * Classify a producer type into a delivery lane. Pure + exported for testing.
 * `laneHint` from the producer is honoured only when the type is not already a
 * known immediate type (a producer can ask for A, but can never downgrade a
 * known-critical type to B).
 */
export function classifyLane(producerType: string, laneHint?: Lane): Lane {
  if (IMMEDIATE_PRODUCER_TYPES.has(producerType)) return 'A';
  if (laneHint === 'A') return 'A';
  return 'B';
}

/** Structural request a producer hands to the gateway. */
export interface SmartNotificationRequest {
  /** Notification type (existing `data.type` vocabulary), e.g. 'task_reminder'. */
  producerType: string;
  /** Household scope (optional for user-scoped notifications). */
  householdId?: string;
  /** Resolved candidate recipients. In P1 these are used as-is (pass-through). */
  recipients: string[];
  /** Fallback/template copy — used verbatim in P1 and on AI failure later. */
  title: string;
  body: string;
  /** Deep-link payload, unchanged from today. */
  data?: Record<string, string>;
  referenceType?: string;
  referenceId?: string;
  imageUrl?: string;
  /** If set, the notification is scheduled for this time; otherwise sent now. */
  scheduledFor?: Date;
  /** Producer hint; gateway policy may override (never downgrades a critical type). */
  laneHint?: Lane;
}

export interface SmartNotificationResult {
  decisionIds: string[];
  dispatched: number;
  lane: Lane;
  copySource: 'template';
}

/**
 * Minimal surface the gateway needs from the canonical delivery layer.
 * `NotificationService` satisfies this structurally; tests inject a fake.
 */
export interface NotificationDelivery {
  sendNotification(options: {
    userId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    referenceType?: string;
    referenceId?: string;
    imageUrl?: string;
  }): Promise<void>;
  scheduleNotification(options: {
    userId: string;
    householdId?: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    referenceType?: string;
    referenceId?: string;
    imageUrl?: string;
    scheduledFor: Date;
  }): Promise<unknown>;
}

export class SmartNotificationGateway {
  private db: DrizzleD1Database;
  private delivery: NotificationDelivery;

  /**
   * @param env      Worker env (passed to the default NotificationService).
   * @param d1       Raw D1 binding for decision logging.
   * @param delivery Optional delivery override (defaults to NotificationService);
   *                 injected in tests.
   */
  constructor(env: Env, d1: D1Database, delivery?: NotificationDelivery) {
    this.db = drizzle(d1);
    this.delivery = delivery ?? new NotificationService(env, d1);
  }

  /**
   * Accept a producer request, log a per-recipient decision (best-effort), and
   * delegate to the canonical delivery layer. P1 pass-through: recipients and
   * copy are untouched; the only behavioural change vs. calling
   * NotificationService directly is the telemetry row.
   */
  async enqueue(request: SmartNotificationRequest): Promise<SmartNotificationResult> {
    const lane = classifyLane(request.producerType, request.laneHint);
    // P1 recipient resolution is identity (pass-through). Later phases narrow
    // this to the actionable member(s) — see TRD §6.2 / BR-03.
    const recipients = request.recipients;
    const recipientRule = 'passthrough';
    const copySource = 'template' as const;

    const decisionIds: string[] = [];
    let dispatched = 0;

    for (const userId of recipients) {
      const decisionId = crypto.randomUUID();
      decisionIds.push(decisionId);

      // Best-effort telemetry — must never block the send.
      await this.logDecision({
        id: decisionId,
        household_id: request.householdId ?? null,
        recipient_user_id: userId,
        producer_type: request.producerType,
        lane,
        recipient_rule: recipientRule,
        copy_source: copySource,
        batch_role: 'single',
        reference_type: request.referenceType ?? null,
        reference_id: request.referenceId ?? null,
        outcome_ref: null,
        suppress_reason: null,
      });

      // Canonical delivery. NotificationService applies prefs, quiet hours,
      // send-time optimization, threading, and the Expo dispatch unchanged.
      if (request.scheduledFor) {
        await this.delivery.scheduleNotification({
          userId,
          householdId: request.householdId,
          type: request.producerType,
          title: request.title,
          body: request.body,
          data: request.data,
          referenceType: request.referenceType,
          referenceId: request.referenceId,
          imageUrl: request.imageUrl,
          scheduledFor: request.scheduledFor,
        });
      } else {
        await this.delivery.sendNotification({
          userId,
          type: request.producerType,
          title: request.title,
          body: request.body,
          data: request.data,
          referenceType: request.referenceType,
          referenceId: request.referenceId,
          imageUrl: request.imageUrl,
        });
      }
      dispatched += 1;
    }

    return { decisionIds, dispatched, lane, copySource };
  }

  /** Insert one decision row; swallow + log errors so delivery is never blocked. */
  private async logDecision(
    row: typeof smartNotificationDecision.$inferInsert
  ): Promise<void> {
    try {
      await this.db.insert(smartNotificationDecision).values(row);
    } catch (error) {
      console.error('[SmartNotificationGateway] decision logging failed (non-fatal):', error);
    }
  }
}
