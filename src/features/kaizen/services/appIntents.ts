import { useKaizenStore } from '../stores/kaizenStore';

import { snoozeActionReminder } from './reminders';
import { watchSync } from './watchSync';

/**
 * iOS App Intents / Shortcuts / Siri contract for Kaizen.
 * Native intents (see `native/KaizenAppIntents.swift`) call these handlers
 * via `kaizen://` deep links or the Expo module bridge.
 */
export type KaizenAppIntent =
  | { type: 'quick-log'; actionId: string }
  | { type: 'snooze'; reminderId: string; durationMinutes: number }
  | { type: 'capture-gtd'; text: string }
  | { type: 'confirm-wake' }
  | { type: 'start-practice'; questionId?: string }
  | { type: 'start-morning-routine' }
  | { type: 'open-coach' }
  | { type: 'start-deep-work'; topic?: string };

export interface KaizenAppIntentHandling {
  handle(intent: KaizenAppIntent): Promise<void>;
}

export const appIntents: KaizenAppIntentHandling = {
  async handle(intent) {
    const store = useKaizenStore.getState();
    switch (intent.type) {
      case 'quick-log':
        await store.completeDailyAction(intent.actionId, 'notification');
        await watchSync.pushTodaySummary();
        return;
      case 'capture-gtd':
        await store.addGtdItem(intent.text);
        await watchSync.pushTodaySummary();
        return;
      case 'confirm-wake':
        await store.confirmWake();
        await watchSync.pushTodaySummary();
        return;
      case 'snooze': {
        const action = store.dailyCore.find(item => item.id === intent.reminderId);
        if (action) {
          await snoozeActionReminder(action, intent.durationMinutes);
        }
        return;
      }
      case 'start-practice':
      case 'open-coach':
      case 'start-deep-work':
      case 'start-morning-routine':
        return;
    }
  },
};
