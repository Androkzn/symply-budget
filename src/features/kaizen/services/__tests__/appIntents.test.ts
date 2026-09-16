import { useKaizenStore } from '../../stores/kaizenStore';
import { appIntents } from '../appIntents';
import { snoozeActionReminder } from '../reminders';
import { watchSync } from '../watchSync';


jest.mock('../reminders', () => ({ snoozeActionReminder: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../watchSync', () => ({ watchSync: { pushTodaySummary: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../../stores/kaizenStore', () => ({ useKaizenStore: { getState: jest.fn() } }));

const getState = useKaizenStore.getState as jest.Mock;
const mockSnooze = snoozeActionReminder as jest.Mock;
const mockPush = watchSync.pushTodaySummary as jest.Mock;

let state: {
  dailyCore: Array<{ id: string }>;
  completeDailyAction: jest.Mock;
  addGtdItem: jest.Mock;
  confirmWake: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  state = {
    dailyCore: [{ id: 'a1' }],
    completeDailyAction: jest.fn().mockResolvedValue(undefined),
    addGtdItem: jest.fn().mockResolvedValue(undefined),
    confirmWake: jest.fn().mockResolvedValue(undefined),
  };
  getState.mockImplementation(() => state);
});

describe('appIntents.handle', () => {
  it('quick-log completes via the notification source and pushes to the watch', async () => {
    await appIntents.handle({ type: 'quick-log', actionId: 'a1' });
    expect(state.completeDailyAction).toHaveBeenCalledWith('a1', 'notification');
    expect(mockPush).toHaveBeenCalled();
  });

  it('capture-gtd adds an inbox item and pushes', async () => {
    await appIntents.handle({ type: 'capture-gtd', text: 'buy milk' });
    expect(state.addGtdItem).toHaveBeenCalledWith('buy milk');
    expect(mockPush).toHaveBeenCalled();
  });

  it('confirm-wake confirms and pushes', async () => {
    await appIntents.handle({ type: 'confirm-wake' });
    expect(state.confirmWake).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalled();
  });

  it('snooze schedules a reminder for a known daily-core action', async () => {
    await appIntents.handle({ type: 'snooze', reminderId: 'a1', durationMinutes: 30 });
    expect(mockSnooze).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), 30);
  });

  it('snooze is a no-op for an unknown reminder id', async () => {
    await appIntents.handle({ type: 'snooze', reminderId: 'zzz', durationMinutes: 30 });
    expect(mockSnooze).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'start-practice' } as const,
    { type: 'open-coach' } as const,
    { type: 'start-deep-work' } as const,
    { type: 'start-morning-routine' } as const,
  ])('navigation-only intent %p does not mutate the store', async intent => {
    await appIntents.handle(intent);
    expect(state.completeDailyAction).not.toHaveBeenCalled();
    expect(state.addGtdItem).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
