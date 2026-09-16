import { describe, expect, it, vi, afterEach } from 'vitest';

import { parseOpenGraph, safeFetchUrl } from '../safe-fetch-url';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('safeFetchUrl', () => {
  it('rejects non-https', async () => {
    const res = await safeFetchUrl('http://example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('https_only');
  });

  it('rejects private hosts', async () => {
    const res = await safeFetchUrl('https://127.0.0.1/');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('private_host');
  });

  it('rejects metadata host', async () => {
    const res = await safeFetchUrl('https://169.254.169.254/latest/meta-data/');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('private_host');
  });

  it('fetches public https body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('<html><title>Tile</title></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      })
    );
    const res = await safeFetchUrl('https://example.com/product');
    expect(res.ok).toBe(true);
    expect(res.bodyText).toContain('Tile');
  });
});

describe('parseOpenGraph', () => {
  it('extracts title and image', () => {
    const html = `
      <meta property="og:title" content="Nice Vanity" />
      <meta property="og:image" content="https://cdn.example.com/a.jpg" />
      <title>Fallback</title>
    `;
    const og = parseOpenGraph(html);
    expect(og.title).toBe('Nice Vanity');
    expect(og.image).toBe('https://cdn.example.com/a.jpg');
  });
});
