import { hashPrompt, isDuplicatePrompt } from '../questionDedup';

describe('questionDedup', () => {
  it('detects duplicate prompts by normalized hash', () => {
    const hash = hashPrompt('Explain  React hooks');
    expect(isDuplicatePrompt('Explain react hooks', [{ prompt: 'other', source_hash: hash }])).toBe(true);
    expect(isDuplicatePrompt('Unique question', [{ prompt: 'other', source_hash: hash }])).toBe(false);
  });
});
