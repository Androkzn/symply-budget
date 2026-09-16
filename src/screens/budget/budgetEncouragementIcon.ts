/** Map BE encouragement emoji → Budget brush-kit slug (when we have one). */
const EMOJI_TO_KIT: Record<string, string> = {
  '🎯': 'goal',
  '📊': 'trends',
  '🎉': 'complete',
  '🏆': 'complete',
  '🗓️': 'calendar',
  '🧭': 'insights',
  '🌱': 'savings',
};

export function encouragementKitIcon(emoji: string): string | undefined {
  return EMOJI_TO_KIT[emoji];
}
