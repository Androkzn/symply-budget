import { Platform } from 'react-native';

import { useAuthStore } from '@stores/authStore';

import { useKaizenStore } from '../stores/kaizenStore';

import { snoozeActionReminder } from './reminders';
import { computeDailyCoreStreak } from './streak';

/**
 * iOS Watch contract (WatchConnectivity).
 * Phone-side protocol is fully implemented; the Watch extension target plugs into
 * `setTransport` once added to the Xcode workspace.
 */
export type WatchEvent =
  | { type: 'quick-log'; actionId: string; occurredAt: string }
  | { type: 'snooze'; reminderId: string; durationMinutes: number }
  | { type: 'skip'; actionId: string }
  | { type: 'capture-gtd'; text: string; occurredAt: string }
  | { type: 'confirm-wake' };

export type WatchTransport = {
  isPaired: () => Promise<boolean>;
  updateApplicationContext: (summary: Record<string, unknown>) => Promise<void>;
  onMessage?: (handler: (event: WatchEvent) => void) => () => void;
};

let transport: WatchTransport | null = null;

export function setWatchTransport(next: WatchTransport | null): void {
  transport = next;
}

export interface KaizenWatchSyncing {
  isAvailable(): Promise<boolean>;
  sendTodaySummary(summary: Record<string, unknown>): Promise<void>;
  buildTodaySummary(): Record<string, unknown>;
  pushTodaySummary(): Promise<void>;
  handleEvent(event: WatchEvent): Promise<void>;
}

export const watchSync: KaizenWatchSyncing = {
  async isAvailable() {
    if (Platform.OS !== 'ios') return false;
    if (transport) return transport.isPaired();
    return false;
  },

  buildTodaySummary() {
    const state = useKaizenStore.getState();
    const now = new Date();
    const completed = new Set(
      state.todayLogs.filter(log => !log.skipped).map(log => log.action_id),
    );
    const today = now.toISOString().slice(0, 10);

    // Today's weekly-focus rotation (parity with TodayScreen's header). Weekday is
    // stored 1=Mon...7=Sun, so native getDay() (0=Sun) must be remapped.
    const todayWeekday = ((now.getDay() + 6) % 7) + 1;
    const rotation = state.rotations.find(item => item.weekday === todayWeekday);

    // Next scheduled deep-work block for today that hasn't ended yet.
    const nowClock = now.toTimeString().slice(0, 5); // HH:MM (local)
    const nextDeepWork = state.deepWork
      .filter(
        (block): block is (typeof state.deepWork)[number] & { start_time: string } =>
          block.date === today && Boolean(block.start_time),
      )
      // A block with no end_time stays open until its start; the first filter has
      // already guaranteed start_time is present, so no empty-string fallback is needed.
      .filter(block => (block.end_time ?? block.start_time) >= nowClock)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];

    return {
      date: today,
      updatedAt: now.toISOString(),
      completedCount: state.dailyCore.filter(action => completed.has(action.id)).length,
      totalCount: state.dailyCore.length,
      wakeConfirmed: state.wakeConfirmedToday,
      gtdInboxCount: state.gtd.filter(item => item.status === 'inbox').length,
      dueQuestions: state.questions.filter(
        question => question.due_at && new Date(question.due_at) <= now,
      ).length,
      activePipeline: state.pipeline.length,
      focusTitle: rotation?.focus_title ?? null,
      deepWork: nextDeepWork
        ? { start: nextDeepWork.start_time, topic: nextDeepWork.topic ?? null }
        : null,
      actions: state.dailyCore.map(action => ({
        id: action.id,
        title: action.title,
        completed: completed.has(action.id),
        watchQuickLog: Boolean(action.watch_quick_log_enabled),
        timeOfDay: action.time_of_day ?? 'anytime',
        system: action.system ?? null,
      })),
    };
  },

  async sendTodaySummary(summary) {
    if (!transport) return;
    await transport.updateApplicationContext(summary);
  },

  async pushTodaySummary() {
    const summary = watchSync.buildTodaySummary();
    // Streak needs history across days, so it's computed from the DB (not store
    // state) and merged in the async push path only.
    const uid = useAuthStore.getState().user?.id ?? null;
    const streak = uid ? await computeDailyCoreStreak(uid) : 0;
    await watchSync.sendTodaySummary({ ...summary, streak });
  },

  async handleEvent(event) {
    const store = useKaizenStore.getState();
    switch (event.type) {
      case 'quick-log':
        await store.completeDailyAction(event.actionId, 'watch');
        break;
      case 'capture-gtd':
        await store.addGtdItem(event.text);
        break;
      case 'confirm-wake':
        await store.confirmWake();
        break;
      case 'snooze': {
        const action = store.dailyCore.find(item => item.id === event.reminderId);
        if (action) {
          await snoozeActionReminder(action, event.durationMinutes);
        }
        break;
      }
      case 'skip':
        await store.skipDailyAction(event.actionId);
        break;
    }
    await watchSync.pushTodaySummary();
  },
};
