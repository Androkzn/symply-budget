import { describe, expect, it } from 'vitest';

import {
  categoryToFloorLevel,
  disambiguatePresetName,
  resolveBulkDuplicateName,
} from '../space-names';

describe('space-names', () => {
  it('disambiguates duplicate bathroom with basement prefix', () => {
    const existing = new Set(['bathroom']);
    const name = disambiguatePresetName('Bathroom', {
      name: 'Bathroom',
      space_type: 'preset',
      category: 'basement',
      floor_level: -1,
    }, existing);
    expect(name).toBe('Basement Bathroom');
  });

  it('disambiguates duplicate bathroom with main prefix on first floor', () => {
    const existing = new Set(['bathroom']);
    const name = disambiguatePresetName('Bathroom', {
      name: 'Bathroom',
      space_type: 'preset',
      category: 'indoor',
      floor_level: 1,
    }, existing);
    expect(name).toBe('Main Bathroom');
  });

  it('resolves bulk bathroom occurrences', () => {
    expect(resolveBulkDuplicateName('Bathroom', 1, 'indoor')).toBe('Main Bathroom');
    expect(resolveBulkDuplicateName('Bathroom', 2, 'indoor')).toBe('Guest Bathroom');
    expect(resolveBulkDuplicateName('Bathroom', 3, 'indoor')).toBe('Bathroom (3)');
  });

  it('maps basement category to floor level -1', () => {
    expect(categoryToFloorLevel('basement')).toBe(-1);
    expect(categoryToFloorLevel('indoor')).toBeUndefined();
  });
});
