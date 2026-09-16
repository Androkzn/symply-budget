import { LifeSystem } from '../../constants';
import {
  beginSetupQueue,
  clearSetupFlow,
  finishSetupAfterCareer,
  isSetupFlowActive,
  markSystemConfigured,
  needsCareerSetupStep,
  nextUnconfiguredSystem,
  readConfiguredSystems,
  readSetupQueue,
} from '../setupFlow';
import { storageHelpers } from '../storage';


const QUEUE_KEY = 'kaizen.setup.queue';
const CONFIGURED_KEY = 'kaizen.setup.configured';

jest.mock('../storage', () => ({
  storageHelpers: {
    getString: jest.fn(),
    setString: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('setupFlow', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    Object.keys(store).forEach(key => delete store[key]);
    (storageHelpers.getString as jest.Mock).mockImplementation((key: string) => store[key] ?? null);
    (storageHelpers.setString as jest.Mock).mockImplementation((key: string, value: string) => {
      store[key] = value;
    });
    (storageHelpers.remove as jest.Mock).mockImplementation((key: string) => {
      delete store[key];
    });
  });

  it('walks systems then career setup', () => {
    beginSetupQueue([LifeSystem.Health, LifeSystem.Career]);
    expect(isSetupFlowActive()).toBe(true);
    expect(nextUnconfiguredSystem()).toBe(LifeSystem.Health);

    expect(markSystemConfigured(LifeSystem.Health)).toEqual({
      kind: 'next-system',
      system: LifeSystem.Career,
    });

    expect(markSystemConfigured(LifeSystem.Career)).toEqual({ kind: 'career-setup' });
    expect(needsCareerSetupStep()).toBe(true);
  });

  it('completes and clears the flow when the last system has no career step', () => {
    beginSetupQueue([LifeSystem.Health]);
    expect(markSystemConfigured(LifeSystem.Health)).toEqual({ kind: 'complete' });
    // clearSetupFlow() ran → both keys removed.
    expect(store[QUEUE_KEY]).toBeUndefined();
    expect(store[CONFIGURED_KEY]).toBeUndefined();
    expect(isSetupFlowActive()).toBe(false);
  });

  it('reports an inactive flow for an empty queue', () => {
    expect(isSetupFlowActive()).toBe(false);
  });

  it('stays active for the career-setup step once every system is configured', () => {
    beginSetupQueue([LifeSystem.Health, LifeSystem.Career]);
    storageHelpers.setString(
      CONFIGURED_KEY,
      JSON.stringify([LifeSystem.Health, LifeSystem.Career]),
    );
    // No unconfigured system left, so isSetupFlowActive falls through to the
    // career-setup check (return needsCareerSetupStep()).
    expect(nextUnconfiguredSystem()).toBeNull();
    expect(isSetupFlowActive()).toBe(true);
  });

  it('does not require a career step when career is not queued', () => {
    beginSetupQueue([LifeSystem.Health]);
    storageHelpers.setString(CONFIGURED_KEY, JSON.stringify([LifeSystem.Health]));
    expect(needsCareerSetupStep()).toBe(false);
  });

  it('clears the flow via clearSetupFlow and finishSetupAfterCareer', () => {
    beginSetupQueue([LifeSystem.Health, LifeSystem.Career]);
    clearSetupFlow();
    expect(store[QUEUE_KEY]).toBeUndefined();
    expect(store[CONFIGURED_KEY]).toBeUndefined();

    beginSetupQueue([LifeSystem.Career]);
    finishSetupAfterCareer();
    expect(store[QUEUE_KEY]).toBeUndefined();
    expect(store[CONFIGURED_KEY]).toBeUndefined();
  });

  it('reads empty arrays when nothing has been persisted yet', () => {
    // Exercises the `?? '[]'` fallback of both readers with unset keys.
    expect(readSetupQueue()).toEqual([]);
    expect(readConfiguredSystems()).toEqual([]);
  });

  describe('corrupt / non-array persisted state', () => {
    it('treats corrupt queue/configured JSON as empty arrays', () => {
      store[QUEUE_KEY] = '{not json';
      store[CONFIGURED_KEY] = '{not json';
      expect(readSetupQueue()).toEqual([]);
      expect(readConfiguredSystems()).toEqual([]);
    });

    it('treats non-array queue/configured JSON as empty arrays', () => {
      store[QUEUE_KEY] = JSON.stringify({ nope: true });
      store[CONFIGURED_KEY] = JSON.stringify({ nope: true });
      expect(readSetupQueue()).toEqual([]);
      expect(readConfiguredSystems()).toEqual([]);
    });
  });
});
