import { wakeDetection } from '../wakeDetection';

describe('wakeDetection', () => {
  const userId = 'wake-user';
  const date = new Date('2026-07-10T12:00:00.000Z');

  afterEach(() => wakeDetection.clear(userId, date));

  it('confirms wake state independently by user and date', () => {
    expect(wakeDetection.isConfirmed(userId, date)).toBe(false);

    wakeDetection.confirm(userId, date);

    expect(wakeDetection.isConfirmed(userId, date)).toBe(true);
    expect(wakeDetection.isConfirmed('another-user', date)).toBe(false);
    expect(wakeDetection.isConfirmed(userId, new Date('2026-07-11T12:00:00.000Z'))).toBe(false);
  });

  it('defaults to today when no date is passed', () => {
    const todayUser = 'wake-today-user';
    expect(wakeDetection.isConfirmed(todayUser)).toBe(false);

    wakeDetection.confirm(todayUser);
    expect(wakeDetection.isConfirmed(todayUser)).toBe(true);

    wakeDetection.clear(todayUser);
    expect(wakeDetection.isConfirmed(todayUser)).toBe(false);
  });
});
