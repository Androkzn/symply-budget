import type { HouseholdSpace } from '@api/household-spaces';

const FLOOR_PREFIXES = ['Basement', 'Ground', 'Main', 'Upper', 'Guest', 'Upstairs', 'Downstairs'];

const NAME_SUFFIXES: Record<string, string[]> = {
  Bathroom: ['Main Bathroom', 'Basement Bathroom', 'Upstairs Bathroom', 'Guest Bathroom'],
  Bedroom: ['Master Bedroom', 'Guest Bedroom', 'Upstairs Bedroom', 'Basement Bedroom'],
  Kitchen: ['Main Kitchen', 'Basement Kitchen', 'Outdoor Kitchen'],
};

export function getFloorLabel(floorLevel: number | null | undefined): string | null {
  if (floorLevel == null) return null;
  if (floorLevel < 0) return 'Basement';
  if (floorLevel === 0) return 'Ground';
  if (floorLevel === 1) return '1st';
  if (floorLevel === 2) return '2nd';
  if (floorLevel === 3) return '3rd';
  return `${floorLevel}th`;
}

export function getCategoryLabel(category: string | null | undefined): string {
  if (!category) return 'Other';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function findDuplicateNameGroups(spaces: HouseholdSpace[]): Map<string, HouseholdSpace[]> {
  const byName = new Map<string, HouseholdSpace[]>();
  for (const space of spaces) {
    const key = space.name.trim().toLowerCase();
    const group = byName.get(key) ?? [];
    group.push(space);
    byName.set(key, group);
  }

  const duplicates = new Map<string, HouseholdSpace[]>();
  for (const [name, group] of byName) {
    if (group.length > 1) {
      duplicates.set(name, group);
    }
  }
  return duplicates;
}

export function suggestDisambiguatedNames(
  baseName: string,
  count: number,
  existingNames: string[] = []
): string[] {
  const normalizedExisting = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const suggestions: string[] = [];
  const preset = NAME_SUFFIXES[baseName] ?? [];

  for (const name of preset) {
    if (!normalizedExisting.has(name.toLowerCase()) && !suggestions.includes(name)) {
      suggestions.push(name);
    }
    if (suggestions.length >= count) return suggestions.slice(0, count);
  }

  let index = 2;
  while (suggestions.length < count) {
    const candidate = `${baseName} ${index}`;
    if (!normalizedExisting.has(candidate.toLowerCase())) {
      suggestions.push(candidate);
    }
    index += 1;
    if (index > count + 10) break;
  }

  let prefixIndex = 0;
  while (suggestions.length < count && prefixIndex < FLOOR_PREFIXES.length) {
    const candidate = `${FLOOR_PREFIXES[prefixIndex]} ${baseName}`;
    if (!normalizedExisting.has(candidate.toLowerCase()) && !suggestions.includes(candidate)) {
      suggestions.push(candidate);
    }
    prefixIndex += 1;
  }

  return suggestions.slice(0, count);
}

export function suggestUniqueSpaceName(
  desiredName: string,
  existingSpaces: HouseholdSpace[]
): string {
  const existingNames = existingSpaces.map((s) => s.name);
  const normalized = desiredName.trim().toLowerCase();
  if (!existingNames.some((n) => n.trim().toLowerCase() === normalized)) {
    return desiredName.trim();
  }
  const [suggestion] = suggestDisambiguatedNames(desiredName.trim(), 1, existingNames);
  return suggestion ?? `${desiredName.trim()} 2`;
}

export type SpaceGroup = {
  key: string;
  label: string;
  spaces: HouseholdSpace[];
};

export function groupSpacesForDisplay(spaces: HouseholdSpace[]): SpaceGroup[] {
  const withFloor = spaces.filter((s) => s.floor_level != null);
  const withoutFloor = spaces.filter((s) => s.floor_level == null);

  const groups: SpaceGroup[] = [];

  const floorLevels = [...new Set(withFloor.map((s) => s.floor_level as number))].sort(
    (a, b) => a - b
  );

  for (const level of floorLevels) {
    const floorSpaces = withFloor
      .filter((s) => s.floor_level === level)
      .sort((a, b) => a.display_order - b.display_order);
    groups.push({
      key: `floor-${level}`,
      label: getFloorLabel(level) ?? `Floor ${level}`,
      spaces: floorSpaces,
    });
  }

  if (withoutFloor.length > 0) {
    const byCategory = withoutFloor.reduce<Record<string, HouseholdSpace[]>>((acc, space) => {
      const category = space.category || 'other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(space);
      return acc;
    }, {});

    const categoryOrder = ['indoor', 'outdoor', 'garage', 'basement', 'attic', 'other'];
    for (const category of categoryOrder) {
      const categorySpaces = byCategory[category];
      if (!categorySpaces?.length) continue;
      groups.push({
        key: `category-${category}`,
        label: getCategoryLabel(category),
        spaces: categorySpaces.sort((a, b) => a.display_order - b.display_order),
      });
    }
  }

  return groups;
}

export function groupSpacesForPicker(spaces: HouseholdSpace[]): SpaceGroup[] {
  const withFloor = spaces.filter((s) => s.floor_level != null);
  const withoutFloor = spaces.filter((s) => s.floor_level == null);

  const groups: SpaceGroup[] = [];

  const floorLevels = [...new Set(withFloor.map((s) => s.floor_level as number))].sort(
    (a, b) => a - b
  );

  for (const level of floorLevels) {
    const floorSpaces = withFloor.filter((s) => s.floor_level === level);
    const byCategory = floorSpaces.reduce<Record<string, HouseholdSpace[]>>((acc, space) => {
      const category = space.category || 'other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(space);
      return acc;
    }, {});

    const categoryOrder = ['indoor', 'outdoor', 'garage', 'basement', 'attic', 'other'];
    for (const category of categoryOrder) {
      const categorySpaces = byCategory[category];
      if (!categorySpaces?.length) continue;
      const floorLabel = getFloorLabel(level);
      groups.push({
        key: `floor-${level}-${category}`,
        label: `${floorLabel} · ${getCategoryLabel(category)}`,
        spaces: categorySpaces.sort((a, b) => a.display_order - b.display_order),
      });
    }
  }

  if (withoutFloor.length > 0) {
    const byCategory = withoutFloor.reduce<Record<string, HouseholdSpace[]>>((acc, space) => {
      const category = space.category || 'other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(space);
      return acc;
    }, {});

    const categoryOrder = ['indoor', 'outdoor', 'garage', 'basement', 'attic', 'other'];
    for (const category of categoryOrder) {
      const categorySpaces = byCategory[category];
      if (!categorySpaces?.length) continue;
      groups.push({
        key: `category-${category}`,
        label: getCategoryLabel(category),
        spaces: categorySpaces.sort((a, b) => a.display_order - b.display_order),
      });
    }
  }

  return groups;
}
