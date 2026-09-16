import {
  summarizeHttpResponseBody,
  summarizeLanguageResponseBody,
} from '../e2eResponseSummary';

describe('e2eResponseSummary', () => {
  it('summarizes array data as count', () => {
    expect(summarizeHttpResponseBody({ data: [{ id: '1' }, { id: '2' }] })).toBe('count=2');
  });

  it('summarizes entity hints without leaking ids', () => {
    expect(
      summarizeHttpResponseBody({ data: { id: 'secret-uuid', image_key: 'img/k1' } }),
    ).toBe('hasId hasImageKey');
  });

  it('summarizes error codes', () => {
    expect(summarizeHttpResponseBody({ code: 'validation_failed' }, { isError: true })).toBe(
      'errorCode=validation_failed',
    );
  });

  it('delegates language wrapper', () => {
    expect(summarizeLanguageResponseBody([1, 2, 3], false)).toBe('count=3');
  });
});
