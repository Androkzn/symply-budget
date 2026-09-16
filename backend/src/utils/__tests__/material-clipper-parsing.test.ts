/**
 * The page-reading half of the materials clipper: JSON-LD selection, readable
 * text extraction, and the guards on the product-photo fetch.
 *
 * These decide what the model gets to see. Under a character cap, everything
 * that survives `extractReadableText` crowds out something else — so "did the
 * spec table make it through, and did 40KB of inlined analytics not" is a
 * correctness question, not a tidiness one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { extractReadableText, parseJsonLd, safeFetchImage } from '../safe-fetch-url';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseJsonLd', () => {
  it('keeps a Product block', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"Product","name":"Aspen Oak","sku":"123"}</script>
    </head></html>`;
    const blocks = parseJsonLd(html);
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0]!)).toMatchObject({ name: 'Aspen Oak' });
  });

  it('drops the breadcrumb and organisation blocks retail pages are full of', () => {
    const html = `
      <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
      <script type="application/ld+json">{"@type":"Organization","name":"Big Shop"}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Tile"}</script>`;
    const blocks = parseJsonLd(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('Tile');
  });

  it('finds a Product nested in an @graph wrapper', () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"Product","name":"Slate"}]}
    </script>`;
    expect(parseJsonLd(html)).toHaveLength(1);
  });

  it('finds a Product in a top-level array', () => {
    const html = `<script type="application/ld+json">
      [{"@type":"WebPage"},{"@type":"Product","name":"Slate"}]
    </script>`;
    expect(parseJsonLd(html)).toHaveLength(1);
  });

  it('handles an @type array', () => {
    const html = `<script type="application/ld+json">
      {"@type":["Product","Offer"],"name":"Slate"}
    </script>`;
    expect(parseJsonLd(html)).toHaveLength(1);
  });

  it('skips a block that is not valid JSON', () => {
    // Templated or truncated JSON labelled "most reliable" is worse than none.
    const html = `<script type="application/ld+json">{"@type":"Product","name":{{name}}}</script>`;
    expect(parseJsonLd(html)).toEqual([]);
  });

  it('caps the number of blocks', () => {
    const one = '<script type="application/ld+json">{"@type":"Product","name":"x"}</script>';
    expect(parseJsonLd(one.repeat(20), { maxBlocks: 3 })).toHaveLength(3);
  });

  it('skips an oversized block', () => {
    const big = `<script type="application/ld+json">{"@type":"Product","name":"${'x'.repeat(500)}"}</script>`;
    expect(parseJsonLd(big, { maxChars: 100 })).toEqual([]);
  });

  it('returns nothing for a page with no structured data', () => {
    expect(parseJsonLd('<html><body>Hello</body></html>')).toEqual([]);
  });
});

describe('extractReadableText', () => {
  it('drops scripts and styles with their contents', () => {
    const html = `<html><head>
      <style>.a{color:red}</style>
      <script>var analytics = "TRACKING_PAYLOAD";</script>
      </head><body><p>Porcelain tile</p></body></html>`;
    const text = extractReadableText(html);
    expect(text).toContain('Porcelain tile');
    expect(text).not.toContain('TRACKING_PAYLOAD');
    expect(text).not.toContain('color:red');
  });

  it('keeps spec-table rows on their own lines', () => {
    // Collapsed into one line, "Wear layer" and "12 mil" lose their pairing and
    // the model has to guess which value belongs to which label.
    const html = `<table>
      <tr><td>Wear layer</td><td>12 mil</td></tr>
      <tr><td>PEI rating</td><td>4</td></tr>
    </table>`;
    const lines = extractReadableText(html).split('\n');
    expect(lines).toContain('Wear layer 12 mil');
    expect(lines).toContain('PEI rating 4');
  });

  it('decodes the entities a price is written with', () => {
    expect(extractReadableText('<p>Price&nbsp;&#36;45.99</p>')).toBe('Price $45.99');
  });

  it('decodes hex entities', () => {
    expect(extractReadableText('<p>&#x24;10</p>')).toBe('$10');
  });

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(extractReadableText('<p>&notarealentity;</p>')).toContain('&notarealentity;');
  });

  it('collapses runs of whitespace', () => {
    expect(extractReadableText('<p>a     b</p>')).toBe('a b');
  });

  it('truncates to the cap', () => {
    const html = `<p>${'x'.repeat(5000)}</p>`;
    expect(extractReadableText(html, 100)).toHaveLength(100);
  });

  it('survives unclosed tags', () => {
    expect(extractReadableText('<div><p>Tile')).toBe('Tile');
  });

  it('returns empty for markup with no text', () => {
    expect(extractReadableText('<div><span></span></div>')).toBe('');
  });
});

describe('safeFetchImage guards', () => {
  it('refuses plain http', async () => {
    const res = await safeFetchImage('http://cdn.example.com/a.jpg');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('https_only');
  });

  it('refuses a private host', async () => {
    const res = await safeFetchImage('https://192.168.1.1/a.jpg');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('private_host');
  });

  it('refuses localhost', async () => {
    const res = await safeFetchImage('https://localhost/a.jpg');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('private_host');
  });

  it('refuses the cloud metadata endpoint', async () => {
    const res = await safeFetchImage('https://metadata.google.internal/a.jpg');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('private_host');
  });

  it('refuses a non-443 port', async () => {
    const res = await safeFetchImage('https://cdn.example.com:8443/a.jpg');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('port_blocked');
  });

  it('refuses a garbage url', async () => {
    const res = await safeFetchImage('not a url');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_url');
  });

  it('refuses a response that is not an image', async () => {
    // An `image_url` that answers text/html is not a photo, and storing it would
    // put arbitrary third-party HTML in the bucket under an image key.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<html>gotcha</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );
    const res = await safeFetchImage('https://cdn.example.com/a.jpg');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unsupported_type');
  });

  it('refuses a body larger than the cap even when Content-Length lied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(new Uint8Array(2048), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '12' },
        })
      )
    );
    const res = await safeFetchImage('https://cdn.example.com/a.jpg', { maxBytes: 1024 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('too_large');
  });

  it('rejects a declared oversize without reading the body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array(8), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': '99999999' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await safeFetchImage('https://cdn.example.com/a.png', { maxBytes: 1024 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('too_large');
  });

  it('accepts a real image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      )
    );
    const res = await safeFetchImage('https://cdn.example.com/a.jpg');
    expect(res.ok).toBe(true);
    expect(res.contentType).toBe('image/jpeg');
    expect(res.bytes!.byteLength).toBe(4);
  });

  it('follows a redirect to another public host', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: 'https://cdn2.example.com/a.jpg' } })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9]), {
          status: 200,
          headers: { 'Content-Type': 'image/webp' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    const res = await safeFetchImage('https://cdn.example.com/a.jpg');
    expect(res.ok).toBe(true);
    expect(res.finalUrl).toBe('https://cdn2.example.com/a.jpg');
  });

  it('re-checks the guards on every redirect hop', async () => {
    // The classic SSRF shape: a public URL that 302s to the metadata service.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://169.254.169.254/latest/meta-data/' },
        })
      )
    );
    const res = await safeFetchImage('https://cdn.example.com/a.jpg');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('private_host');
  });

  it('gives up after too many redirects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://cdn.example.com/loop.jpg' },
        })
      )
    );
    const res = await safeFetchImage('https://cdn.example.com/a.jpg', { maxRedirects: 2 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('too_many_redirects');
  });
});
