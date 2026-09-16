import { describe, expect, it } from 'vitest';

import { scrubForLogs } from '../log-scrubber';

describe('scrubForLogs', () => {
  it('redacts api_key fields', () => {
    const out = scrubForLogs({ api_key: 'sk-secret', nested: { apiKey: 'x' } }) as Record<
      string,
      unknown
    >;
    expect(out.api_key).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
  });

  it('redacts sk-ant keys in strings', () => {
    const out = scrubForLogs('error sk-ant-api03-abcdefghijklmnop') as string;
    expect(out).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(out).not.toContain('sk-ant-api03');
  });

  it('redacts Bearer tokens', () => {
    const out = scrubForLogs('Authorization: Bearer abc.def.ghi') as string;
    expect(out).toContain('[REDACTED]');
  });

  it('redacts Google keys in strings (legacy AIza and new AQ. formats)', () => {
    const legacy = scrubForLogs('key=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234567') as string;
    expect(legacy).toContain('[REDACTED_GOOGLE_KEY]');
    expect(legacy).not.toContain('AIzaSy');

    const modern = scrubForLogs('key=AQ.Ab8RN6ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') as string;
    expect(modern).toContain('[REDACTED_GOOGLE_KEY]');
    expect(modern).not.toContain('Ab8RN6');
  });
});
