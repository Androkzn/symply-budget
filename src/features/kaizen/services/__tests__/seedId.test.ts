import { actionLogId, kaizenSeedId } from '../seedId';

describe('seedId helpers', () => {
  it('creates stable seed ids', () => {
    expect(kaizenSeedId('skill.React')).toBe(kaizenSeedId('skill.React'));
    expect(kaizenSeedId('skill.React')).not.toBe(kaizenSeedId('skill.Swift'));
  });

  it('creates one action log id per action per day', () => {
    const actionId = 'abc-123';
    const day = new Date('2026-07-10T15:30:00.000Z');
    expect(actionLogId(actionId, day)).toBe(actionLogId(actionId, day));
    expect(actionLogId(actionId, day)).not.toBe(actionLogId('other', day));
  });

  it('defaults the day to now when omitted', () => {
    // Same calendar day => same deterministic id as an explicit `new Date()`.
    expect(actionLogId('abc-123')).toBe(actionLogId('abc-123', new Date()));
  });
});
