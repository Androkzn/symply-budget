import type { PresetSpaceTemplate } from '../data/preset-spaces';

import type { CreateHouseholdSpaceInput } from './validation';

export function normalizeSpaceName(name: string): string {
  return name.trim().toLowerCase();
}

export function hasDuplicateName(names: Set<string>, name: string): boolean {
  return names.has(normalizeSpaceName(name));
}

export function disambiguatePresetName(
  name: string,
  input: CreateHouseholdSpaceInput,
  existingNames: Set<string>
): string {
  const prefixCandidates: string[] = [];

  if (input.category === 'basement' || input.floor_level === -1) {
    prefixCandidates.push(`Basement ${name}`);
  } else if (input.floor_level !== undefined && input.floor_level >= 2) {
    prefixCandidates.push(`Upstairs ${name}`);
  } else if (input.floor_level === 1) {
    prefixCandidates.push(`Main ${name}`);
  }

  for (const candidate of prefixCandidates) {
    if (!hasDuplicateName(existingNames, candidate)) {
      return candidate;
    }
  }

  let counter = 2;
  while (counter <= 99) {
    const candidate = `${name} (${counter})`;
    if (!hasDuplicateName(existingNames, candidate)) {
      return candidate;
    }
    counter += 1;
  }

  return `${name} (${counter})`;
}

export function resolveBulkDuplicateName(
  baseName: string,
  occurrence: number,
  category: PresetSpaceTemplate['category']
): string {
  if (baseName === 'Bathroom') {
    if (occurrence === 1) return 'Main Bathroom';
    if (occurrence === 2) return 'Guest Bathroom';
    return `Bathroom (${occurrence})`;
  }
  if (baseName === 'Bedroom') {
    if (occurrence === 1) return 'Bedroom';
    if (occurrence === 2) return 'Guest Bedroom';
    return `Bedroom (${occurrence})`;
  }
  if (category === 'basement') {
    return occurrence === 1 ? baseName : `Basement ${baseName}`;
  }
  if (category === 'attic') {
    return occurrence === 1 ? baseName : `Attic ${baseName}`;
  }
  return occurrence === 1 ? baseName : `${baseName} (${occurrence})`;
}

export function categoryToFloorLevel(
  category: PresetSpaceTemplate['category']
): number | undefined {
  if (category === 'basement') return -1;
  if (category === 'attic') return 2;
  return undefined;
}
