/**
 * Framing for incremental reads. Both parsers are fed a GROWING prefix of a
 * response, so the property that matters is that a chunk boundary landing
 * mid-line loses nothing: the caller resumes from the returned cursor and the
 * value still arrives once its terminator does.
 */
import { drainNdjson, drainSse } from '../xhrStream';

describe('drainNdjson', () => {
  it('emits only whole lines and resumes where it stopped', () => {
    const seen: unknown[] = [];
    // Arrives split mid-object, exactly as a chunk boundary would.
    const first = '{"type":"start"}\n{"type":"items","cou';
    let cursor = drainNdjson(first, 0, (v) => seen.push(v));
    expect(seen).toEqual([{ type: 'start' }]);

    const second = `${first}nt":7}\n`;
    cursor = drainNdjson(second, cursor, (v) => seen.push(v));
    expect(seen).toEqual([{ type: 'start' }, { type: 'items', count: 7 }]);
    expect(cursor).toBe(second.length);
  });

  it('skips a malformed frame rather than failing the read', () => {
    const seen: unknown[] = [];
    drainNdjson('not json\n{"type":"items","count":1}\n', 0, (v) => seen.push(v));
    expect(seen).toEqual([{ type: 'items', count: 1 }]);
  });

  it('holds back a trailing line that has no newline yet', () => {
    const seen: unknown[] = [];
    const cursor = drainNdjson('{"type":"items","count":3}', 0, (v) => seen.push(v));
    expect(seen).toEqual([]);
    expect(cursor).toBe(0);
  });
});

describe('drainSse', () => {
  it('surfaces data payloads and ignores event/keepalive lines', () => {
    const seen: string[] = [];
    const text = 'event: content_block_delta\ndata: {"a":1}\n\n: keepalive\ndata: [DONE]\n';
    drainSse(text, 0, (d) => seen.push(d));
    expect(seen).toEqual(['{"a":1}']);
  });

  it('resumes across a split payload', () => {
    const seen: string[] = [];
    const first = 'data: {"partial_json":"{\\"ra';
    const cursor = drainSse(first, 0, (d) => seen.push(d));
    expect(seen).toEqual([]);

    const second = `${first}w_name\\":1}"}\n`;
    drainSse(second, cursor, (d) => seen.push(d));
    expect(seen).toEqual(['{"partial_json":"{\\"raw_name\\":1}"}']);
  });
});
