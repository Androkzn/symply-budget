import { parseSystems } from '../common';

describe('parseSystems', () => {
  it('returns an empty array for a null/empty value', () => {
    expect(parseSystems(null)).toEqual([]);
    expect(parseSystems('')).toEqual([]);
  });

  it('parses a JSON array and keeps only string members', () => {
    expect(parseSystems(JSON.stringify(['health', 'career', 7, null, 'learning']))).toEqual([
      'health',
      'career',
      'learning',
    ]);
  });

  it('returns an empty array when the JSON is a non-array value', () => {
    expect(parseSystems('{"a":1}')).toEqual([]);
    expect(parseSystems('42')).toEqual([]);
  });

  it('returns an empty array when the JSON is malformed (catch path)', () => {
    expect(parseSystems('{not valid json')).toEqual([]);
  });
});
