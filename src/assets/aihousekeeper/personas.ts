/**
 * Aihousekeeper persona registry — 4 character avatars the user can pick from.
 *
 * Each persona has:
 *   - id: stable string id persisted in aihousekeeperStore + KV
 *   - displayName: shown in the settings picker
 *   - blurb: short description for the picker card
 *   - mode: the plan's chat mode the character is most suited to (used
 *     as a default-pick hint, not a hard binding — the user can pick any
 *     persona and it applies across all modes)
 *   - fallbackEmoji: rendered in the avatar circle when `image` is absent
 *   - image: optional require(...) reference to a PNG in ./personas/
 *
 * Drop the PNG files listed in ./personas/README.md and uncomment the
 * matching `image:` line below to switch from emoji to artwork — Metro
 * will hot-reload the change.
 */

import type { ImageSourcePropType } from 'react-native';

import type { AihousekeeperChatMode } from '@api/aihousekeeper';

export type PersonaId = 'cat' | 'dog' | 'alien-male' | 'alien-female';

export interface PersonaMeta {
  id: PersonaId;
  displayName: string;
  blurb: string;
  mode: AihousekeeperChatMode;
  fallbackEmoji: string;
  image?: ImageSourcePropType;
  video?: number;
}

export const PERSONAS: readonly PersonaMeta[] = [
  {
    id: 'cat',
    displayName: 'Mira',
    blurb: 'Warm and curious. Great for family coordination.',
    mode: 'family_chat',
    fallbackEmoji: '🐱',
    image: require('./personas/cat.png'),
    video: require('./personas/Mira.mp4'),
  },
  {
    id: 'dog',
    displayName: 'Bo',
    blurb: 'Eager and practical. Great for tasks and fix-its.',
    mode: 'task_assistant',
    fallbackEmoji: '🐶',
    image: require('./personas/dog.png'),
    video: require('./personas/Bo.mp4'),
  },
  {
    id: 'alien-male',
    displayName: 'Kai',
    blurb: 'Precise and analytical. Great for inspection reports.',
    mode: 'report_assistant',
    fallbackEmoji: '👽',
    image: require('./personas/alien-male.png'),
    video: require('./personas/Kai.mp4'),
  },
  {
    id: 'alien-female',
    displayName: 'Lumen',
    blurb: 'Tactful and diplomatic. Great for contractor chats.',
    mode: 'contractor_context',
    fallbackEmoji: '🛸',
    image: require('./personas/alien-female.png'),
    video: require('./personas/Lumen.mp4'),
  },
] as const;

export const DEFAULT_PERSONA_ID: PersonaId = 'cat';

export function getPersona(id: PersonaId | undefined): PersonaMeta {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}
