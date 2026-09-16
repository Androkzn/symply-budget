import {
  parseReminderPolicy,
  policyToStorage,
  POLICY_NONE,
  TIME_OF_DAY_DEFAULT,
  WAKE_RESPONSIVE_REQUIRED,
  type ActionReminderPolicy,
} from '../reminderPolicy';

describe('parseReminderPolicy', () => {
  it('parses the wakeResponsiveRequired shorthand', () => {
    expect(parseReminderPolicy('wakeResponsive', 'wakeResponsiveRequired')).toEqual(WAKE_RESPONSIVE_REQUIRED);
  });

  it('returns null for silent actions', () => {
    expect(parseReminderPolicy('none', null)).toBeNull();
    expect(parseReminderPolicy('none', 'none')).toBeNull();
    expect(parseReminderPolicy(undefined, undefined)).toBeNull();
  });

  it('parses JSON policy blobs and preserves defaults for omitted fields', () => {
    const policy = parseReminderPolicy('timeOfDay', JSON.stringify({
      anchor: 'timeOfDay',
      initialDelayMinutes: 15,
      maxNudges: 2,
    }));
    expect(policy).toMatchObject({ anchor: 'timeOfDay', initialDelayMinutes: 15, maxNudges: 2 });
    // snoozeOptionsMinutes falls back to the default set when absent.
    expect(policy?.snoozeOptionsMinutes).toEqual([10, 30, 60]);
  });

  it('honors explicit snooze options in a JSON blob', () => {
    const policy = parseReminderPolicy('timeOfDay', JSON.stringify({ maxNudges: 1, snoozeOptionsMinutes: [5, 15] }));
    expect(policy?.snoozeOptionsMinutes).toEqual([5, 15]);
  });

  it('falls through to anchor mapping when the JSON is malformed', () => {
    expect(parseReminderPolicy('wakeResponsive', '{not json')).toEqual(WAKE_RESPONSIVE_REQUIRED);
    expect(parseReminderPolicy('timeOfDay', '{not json')).toEqual(TIME_OF_DAY_DEFAULT);
  });

  it('maps wake-responsive anchors (both spellings) with no policy blob', () => {
    expect(parseReminderPolicy('wakeresponsive', null)).toEqual(WAKE_RESPONSIVE_REQUIRED);
    expect(parseReminderPolicy('wake_responsive', undefined)).toEqual(WAKE_RESPONSIVE_REQUIRED);
  });

  it('maps time-of-day anchors (both spellings) with no policy blob', () => {
    expect(parseReminderPolicy('timeofday', null)).toEqual(TIME_OF_DAY_DEFAULT);
    expect(parseReminderPolicy('time_of_day', undefined)).toEqual(TIME_OF_DAY_DEFAULT);
  });

  it('returns null for an unknown anchor with no policy', () => {
    expect(parseReminderPolicy('mystery', null)).toBeNull();
  });

  it('ignores a JSON blob that parses to a non-object and falls through to the anchor', () => {
    // `JSON.parse('42')` is a number, not an object → falls through to anchor mapping.
    expect(parseReminderPolicy('timeOfDay', '42')).toEqual(TIME_OF_DAY_DEFAULT);
  });
});

describe('policyToStorage', () => {
  it('returns null for a null policy or a silent (maxNudges 0) policy', () => {
    expect(policyToStorage(null)).toBeNull();
    expect(policyToStorage(POLICY_NONE)).toBeNull();
  });

  it('collapses the canonical wake-responsive policy to its shorthand', () => {
    expect(policyToStorage(WAKE_RESPONSIVE_REQUIRED)).toBe('wakeResponsiveRequired');
  });

  it('serializes any other policy to JSON', () => {
    const custom: ActionReminderPolicy = {
      anchor: 'timeOfDay',
      initialDelayMinutes: 15,
      maxNudges: 2,
      snoozeOptionsMinutes: [5, 15],
    };
    const stored = policyToStorage(custom);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual(custom);
  });

  it('does not collapse a wake-responsive policy with non-canonical fields', () => {
    const nearMiss: ActionReminderPolicy = { ...WAKE_RESPONSIVE_REQUIRED, initialDelayMinutes: 10 };
    expect(policyToStorage(nearMiss)).toBe(JSON.stringify(nearMiss));
  });

  it('round-trips a JSON policy through parse → storage', () => {
    const custom: ActionReminderPolicy = {
      anchor: 'timeOfDay',
      initialDelayMinutes: 15,
      maxNudges: 2,
      snoozeOptionsMinutes: [10, 30, 60],
    };
    const stored = policyToStorage(custom) as string;
    expect(parseReminderPolicy('timeOfDay', stored)).toMatchObject(custom);
  });
});
