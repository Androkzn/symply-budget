/**
 * Ionicons glyph → brand-kit icon-name aliases.
 *
 * `<Icon>` strips `-outline` / `-sharp` before lookup. Targets must exist in the
 * active brand's PNG kit (`brands/<id>/src/assets/icons/png/selected/`).
 */
export const IONICON_TO_BRAND: Record<string, string> = {
  // Actions
  add: 'add',
  'add-circle': 'add',
  plus: 'add',
  trash: 'delete',
  'trash-bin': 'delete',
  create: 'edit',
  pencil: 'edit',
  search: 'search',
  filter: 'filter',
  funnel: 'filter',
  options: 'filter',
  'swap-vertical': 'sort',
  'swap-horizontal': 'sort',
  share: 'share',
  'share-social': 'share',
  settings: 'settings',
  cog: 'settings',
  sync: 'sync',
  refresh: 'sync',
  reload: 'sync',
  'sync-circle': 'sync',
  download: 'import',
  'cloud-download': 'import',
  'cloud-upload': 'export',
  'arrow-down-circle': 'import',

  // Navigation / chrome (chevrons/close/copy — no brush sheet yet → Ionicons fallback)
  home: 'home',
  'ellipsis-horizontal': 'more',
  'ellipsis-vertical': 'more',
  chatbubble: 'chat',
  chatbubbles: 'chat',
  'chatbubble-ellipses': 'chat',
  person: 'profile',
  'person-circle': 'profile',
  people: 'members',
  notifications: 'notifications',
  'notifications-circle': 'notifications',
  information: 'information',
  'information-circle': 'information',

  // Symply Budget — money & domain (brush sheet kit)
  wallet: 'budget',
  'pie-chart': 'categories',
  pricetags: 'categories',
  briefcase: 'income',
  sparkles: 'ai-coach',
  'trending-up': 'savings',
  'trending-down': 'trends',
  'stats-chart': 'trends',
  receipt: 'receipt',
  'card-outline': 'spendings',
  card: 'spendings',
  'credit-card': 'credit',
  grid: 'home',
  repeat: 'recurring',
  flag: 'goal',
  bulb: 'insights',
  pricetag: 'tag',
  'shield-checkmark': 'registered-account',
  business: 'registered-account',
  'arrow-forward-circle': 'transfer',
  'arrow-undo': 'soft-transfer',
  calendar: 'calendar',
  cash: 'cash',
  cloud: 'import',
  document: 'review-draft',
  'document-text': 'review-draft',
  'document-attach': 'review-draft',
  // NOT camera/gallery/images/image → 'document-scan'. The kit has exactly one
  // glyph for this whole family, so every picker rendered the SAME icon: the
  // receipt screen's "Camera" and "Gallery" tiles were pixel-identical. These
  // 18 call sites all mean "take a photo" or "pick from the library", never
  // "scan a document", so they fall back to their true Ionicons instead.
  // `document-scan` is still reachable as <Icon name="document-scan" />.
  warning: 'overdue-status',
  alarm: 'due',
  gift: 'other',
  laptop: 'other',
  freelance: 'other',
  insurance: 'registered-account',
  marketplace: 'tag',
  bonus: 'goal',
  star: 'goal',
  'return-down-back': 'import',
  provider: 'registered-account',
  electricity: 'utilities',
  gas: 'utilities',
  water: 'utilities',
  sewer: 'utilities',
  flash: 'utilities',
  flame: 'utilities',
  rainy: 'utilities',

  // Status (circular kit language)
  checkmark: 'complete',
  'checkmark-circle': 'complete',
  'checkmark-done': 'complete',
  'checkmark-done-circle': 'complete',
  'check-circle': 'complete',
  time: 'pending',
  hourglass: 'pending',
  'clock-outline': 'pending',
  'alert-circle': 'overdue',
  // NOT 'close-circle' → 'skipped'. That alias was written for task STATUS, but
  // aliases are global: `close-circle` is the app's "clear this field / remove
  // this attachment / dismiss" affordance in 18+ screens, several tinted
  // `colors.error`. Aliasing it painted the House "skipped task" clock-and-
  // warning glyph over every one of them. The brand glyph is still reachable by
  // its own name (`<Icon name="skipped" />`, as Kaizen's SkippedIcon does).

  // Biometrics (paintbrush kit glyphs)
  scan: 'face-id',
  fingerprint: 'fingerprint',
  'finger-print': 'fingerprint',

  // Account / links / clipboard (paintbrush kit glyphs)
  'log-out': 'sign-out',
  'exit': 'sign-out',
  'lock-closed': 'privacy',
  'lock-open': 'privacy',
  link: 'link',
  copy: 'copy',
  duplicate: 'copy',
  'person-add': 'person-add',

  // Generic UI concepts that already have a matching brand-kit slug — reuse it
  // rather than draw a near-duplicate icon.
  account: 'profile',
  'help-circle': 'help',
  'refresh-circle': 'sync',
  heart: 'favorite',
  'bar-chart-outline': 'statistics',
  'bell-ring-outline': 'reminders',
  'chart-line': 'trends',
  clipboard: 'inspection',
  'clipboard-check': 'inspection',
  'clipboard-check-multiple-outline': 'inspection',
  'clipboard-list-outline': 'inspection',
  'file-tray-outline': 'inbox',
  'git-compare': 'progress-compare',
  'message-text': 'chat',
  microphone: 'speaking',
  pulse: 'heart-rate',
  'stopwatch-outline': 'timer',

  // New shared glyphs (see ecosystem-icon-names.json / icon-concepts.json)
  'account-tie': 'account-tie',
  call: 'call',
  construct: 'construct',
  hammer: 'construct',
  'hammer-outline': 'construct',
  'cube-outline': 'cube',
  'currency-usd': 'dollar-sign',
  'folder-outline': 'folder',
  'folder-open-outline': 'folder',
  globe: 'globe',
  'planet-outline': 'globe',
  leaf: 'leaf',
  'leaf-outline': 'leaf',
  location: 'location-pin',
  'location-outline': 'location-pin',
  map: 'location-pin',
  'map-outline': 'location-pin',
  pin: 'location-pin',
  mail: 'envelope',
  'mail-open': 'envelope',
  'mail-outline': 'envelope',
  'paper-plane': 'paper-plane',
  send: 'paper-plane',
  'phone-portrait': 'mobile-phone',
  play: 'play',
  'play-circle': 'play',
  robot: 'ai-robot',
  'robot-outline': 'ai-robot',
  server: 'server',
  telescope: 'telescope',
  key: 'key',
  'key-outline': 'key',
  'keypad-outline': 'keypad',
  'calendar-check': 'calendar-check',
};

/** Resolve an Ionicons-style name to a brand-kit name (or undefined). */
export function aliasToBrandIcon(name: string): string | undefined {
  const base = name.replace(/-(outline|sharp)$/, '');
  return IONICON_TO_BRAND[base];
}
