import { describe, expect, it } from 'vitest';

import { buildEnrichTaskUserPrompt } from '../prompts/enrich-task';

describe('enrich-task spaces prompt', () => {
  it('includes household spaces in the user prompt', () => {
    const prompt = buildEnrichTaskUserPrompt('fix the basement toilet', {
      todayIso: '2026-07-10',
      todayHuman: 'Thursday, July 10, 2026',
      timezone: 'America/Los_Angeles',
      members: [{ name: 'Alice', isCreator: true }],
      spaces: [
        { id: 's1', name: 'Basement Bathroom' },
        { id: 's2', name: 'Kitchen' },
      ],
    });

    expect(prompt).toContain('HOUSEHOLD SPACES');
    expect(prompt).toContain('Basement Bathroom');
    expect(prompt).toContain('fix the basement toilet');
  });

  it('instructs null space when no spaces exist', () => {
    const prompt = buildEnrichTaskUserPrompt('change HVAC filter', {
      todayIso: '2026-07-10',
      todayHuman: 'Thursday, July 10, 2026',
      timezone: 'UTC',
      members: [],
      spaces: [],
    });

    expect(prompt).toContain('space_name: null');
  });
});
