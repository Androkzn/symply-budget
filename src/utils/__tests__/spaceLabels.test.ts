import type { HouseholdSpace } from '@api/household-spaces';
import {
  findDuplicateNameGroups,
  getFloorLabel,
  groupSpacesForPicker,
  suggestDisambiguatedNames,
  suggestUniqueSpaceName,
} from '@utils/spaceLabels';

function makeSpace(overrides: Partial<HouseholdSpace> & { id: string; name: string }): HouseholdSpace {
  return {
    version: 1,
    household_id: 'hh1',
    space_type: 'preset',
    category: 'indoor',
    floor_level: null,
    icon_emoji: null,
    icon_color: null,
    custom_image_key: null,
    custom_image_url: null,
    description: null,
    area_sqft: null,
    display_order: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('spaceLabels', () => {
  it('formats floor labels', () => {
    expect(getFloorLabel(-1)).toBe('Basement');
    expect(getFloorLabel(0)).toBe('Ground');
    expect(getFloorLabel(1)).toBe('1st');
    expect(getFloorLabel(2)).toBe('2nd');
    expect(getFloorLabel(null)).toBeNull();
  });

  it('finds duplicate name groups', () => {
    const spaces = [
      makeSpace({ id: '1', name: 'Bathroom' }),
      makeSpace({ id: '2', name: 'Bathroom' }),
      makeSpace({ id: '3', name: 'Kitchen' }),
    ];
    const dupes = findDuplicateNameGroups(spaces);
    expect(dupes.get('bathroom')).toHaveLength(2);
    expect(dupes.has('kitchen')).toBe(false);
  });

  it('suggests disambiguated bathroom names', () => {
    const names = suggestDisambiguatedNames('Bathroom', 2, ['Bathroom']);
    expect(names[0]).toBe('Main Bathroom');
    expect(names[1]).toBe('Basement Bathroom');
  });

  it('suggests unique space name when duplicate exists', () => {
    const existing = [makeSpace({ id: '1', name: 'Bathroom' })];
    expect(suggestUniqueSpaceName('Bathroom', existing)).toBe('Main Bathroom');
  });

  it('groups spaces by floor then category in picker', () => {
    const spaces = [
      makeSpace({ id: '1', name: 'Kitchen', floor_level: 0, category: 'indoor' }),
      makeSpace({ id: '2', name: 'Garage', category: 'garage' }),
    ];
    const groups = groupSpacesForPicker(spaces);
    expect(groups.some((g) => g.label === 'Ground · Indoor')).toBe(true);
    expect(groups.some((g) => g.label === 'Garage')).toBe(true);
  });
});
