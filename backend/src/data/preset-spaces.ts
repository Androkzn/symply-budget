/**
 * Preset space templates for household organization
 * Used to provide quick-start options for users
 */

export interface PresetSpaceTemplate {
  name: string;
  category: 'indoor' | 'outdoor' | 'garage' | 'basement' | 'attic';
  emoji: string;
  color: string;
}

export const PRESET_SPACE_TEMPLATES: PresetSpaceTemplate[] = [
  // Indoor Living Spaces (8 templates)
  { name: 'Living Room', category: 'indoor', emoji: '🛋️', color: '#E8F5F3' },
  { name: 'Kitchen', category: 'indoor', emoji: '🍳', color: '#FFF3E8' },
  { name: 'Dining Room', category: 'indoor', emoji: '🍽️', color: '#F5F5F5' },
  { name: 'Master Bedroom', category: 'indoor', emoji: '🛏️', color: '#E3F2FD' },
  { name: 'Bedroom', category: 'indoor', emoji: '🛏️', color: '#E3F2FD' },
  { name: 'Bathroom', category: 'indoor', emoji: '🚿', color: '#E8F5F3' },
  { name: 'Home Office', category: 'indoor', emoji: '💻', color: '#F5F5F5' },
  { name: 'Laundry Room', category: 'indoor', emoji: '🧺', color: '#FFFDE7' },

  // Outdoor Spaces (7 templates)
  { name: 'Backyard', category: 'outdoor', emoji: '🌳', color: '#E8F5E9' },
  { name: 'Front Yard', category: 'outdoor', emoji: '🌿', color: '#E8F5E9' },
  { name: 'Deck', category: 'outdoor', emoji: '🪵', color: '#FFF3E8' },
  { name: 'Patio', category: 'outdoor', emoji: '🪑', color: '#FFF3E8' },
  { name: 'Garden', category: 'outdoor', emoji: '🌻', color: '#E8F5E9' },
  { name: 'Pool Area', category: 'outdoor', emoji: '🏊', color: '#E3F2FD' },
  { name: 'Shed', category: 'outdoor', emoji: '🏚️', color: '#FFF3E8' },
  { name: 'Roof', category: 'outdoor', emoji: '🏠', color: '#E8E8E8' },

  // Utility Spaces (5 templates)
  { name: 'Garage', category: 'garage', emoji: '🚗', color: '#F5F5F5' },
  { name: 'Basement', category: 'basement', emoji: '📦', color: '#E8E8E8' },
  { name: 'Attic', category: 'attic', emoji: '📦', color: '#FFFDE7' },
  { name: 'Storage Room', category: 'indoor', emoji: '📦', color: '#F5F5F5' },
  { name: 'Utility Room', category: 'indoor', emoji: '🔧', color: '#F5F5F5' },
];

/**
 * Pre-configured space sets for different home types
 * Users can quickly setup their home with a single click
 */
export const SPACE_SET_TEMPLATES: Record<string, string[]> = {
  small_apartment: [
    'Living Room',
    'Kitchen',
    'Bedroom',
    'Bathroom',
  ],
  apartment: [
    'Living Room',
    'Kitchen',
    'Dining Room',
    'Master Bedroom',
    'Bedroom',
    'Bathroom',
    'Bathroom',
  ],
  single_family: [
    'Living Room',
    'Kitchen',
    'Dining Room',
    'Master Bedroom',
    'Bedroom',
    'Bedroom',
    'Bathroom',
    'Bathroom',
    'Garage',
    'Backyard',
    'Front Yard',
  ],
  large_house: [
    'Living Room',
    'Kitchen',
    'Dining Room',
    'Master Bedroom',
    'Bedroom',
    'Bedroom',
    'Bedroom',
    'Bathroom',
    'Bathroom',
    'Bathroom',
    'Home Office',
    'Laundry Room',
    'Garage',
    'Basement',
    'Backyard',
    'Front Yard',
    'Deck',
  ],
};
