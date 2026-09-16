# SimpleHouse — UI Rules for Chat / AI-Generated UI

> Source design system: [DesignSystem.md](./DesignSystem.md)
> Token definitions: [src/theme/designTokens.ts](../../src/theme/designTokens.ts)
> Theme-aware colors: [src/theme/appColors.ts](../../src/theme/appColors.ts) (`useAppColors`)
> Typography helpers: [src/theme/typography.ts](../../src/theme/typography.ts)
> Background canvas: [src/components/common/AmbientBackground.tsx](../../src/components/common/AmbientBackground.tsx)

This file is the single source of truth for any UI generated **on the RN client** in chat (Cursor, Claude Code, etc.). Paste or attach this to the chat context whenever you want UI that matches the SimpleHouse design system.

The companion contract for **what the backend may send in `uiBlocks`** is in §17 — read that before editing tool results in `backend/src/services/ai/tools/ui-blocks.ts`.

---

## 1. Typography — semantic tokens only

Use `Tokens.typography.*` via `scaledFont(...)` or `<TypographyV2 variant="...">`. Never use raw `fontSize` for user-facing text.

| Token | Size / Weight | Usage |
|---|---|---|
| `display` | 34 / 700 | Hero numbers, stats |
| `heading` | 28 / 600 | Screen titles |
| `title` | 24 / 600 | Card titles, section headings |
| `titleSmall` | 20 / 500 | Sub-section titles |
| `bodyLarge` | 18 / 600 | Emphasized body |
| `body` | 16 / 400 | Default body text |
| `bodyMedium` | 16 / 500 | Emphasized callouts |
| `buttonLabel` | 17 / 600 | Button labels, CTAs |
| `label` | 15 / 500 | Small card titles, tags |
| `bodySmall` | 14 / 400 | Card descriptions |
| `bodySmallMedium` | 14 / 500 | Card action labels |
| `caption` | 13 / 400 | Footnotes, timestamps |
| `captionSmall` | 12 / 400 | Small metadata |
| `overline` | 11 / 500 +tracking UPPERCASE | Section markers |
| `micro` | 10 / 500 | Tab bar labels |

```tsx
import { TypographyV2, scaledFont } from '@theme';

<TypographyV2 variant="title">Tasks</TypographyV2>
<Text style={[scaledFont('body'), { color: colors.textPrimary }]}>…</Text>
```

`scaledFont` honors the system font scale and clamps it per variant (titles up to 1.5×, body 1.3×, captions 1.2×).

---

## 2. Spacing — 8pt scale

```ts
Spacing.xxs   // 2
Spacing.xs    // 4
Spacing.sm    // 8
Spacing.md    // 12
Spacing.base  // 16
Spacing.lg    // 20
Spacing.xl    // 24
Spacing.xxl   // 32
```

| Token | Use |
|---|---|
| `xxs` | Hairline separators only |
| `xs` | Inline icon-to-text on the same line, pill padding |
| `sm` | Icon→title inside cards, label→sublabel |
| `md` | Card internal gaps between content blocks |
| `base` | Card content padding |
| `lg` | Page margins, generous separation |
| `xl` | Header spacing, large visual breaks |
| `xxl` | Major section spacing |

- Never use `xxs` between icon and title — too cramped.
- Never do arithmetic on tokens (`xxs + 1`, `base - 2`). If no token matches, raw value with `// Figma: Npx`.

---

## 3. Layout

```ts
Layout.pageMargin             // 20 — horizontal page padding
Layout.sectionSpacing         // 32 — between content groups
Layout.cardSpacing            // 12 — between cards
Layout.bottomSafeArea         // 32 — when no floating tab bar
Layout.bottomTabBarClearance  // 88 — when floating tab bar present
Layout.floatingButtonBottom   // 26 — CTA distance to home indicator
Layout.floatingButtonClearance// 100 — scroll padding behind floating CTA
Layout.headerBottom           // 24 — below nav header
```

### REQUIRED: floating tab bar clearance

Any scrollable rendered at a tab-root (under `app/(tabs)/...`) **must** add `Layout.bottomTabBarClearance` to its content's bottom padding, or the last item disappears under the floating tab bar.

```tsx
// ✅ FlatList / ScrollView
<FlatList contentContainerStyle={{ paddingBottom: Layout.bottomTabBarClearance }} />

// ✅ Pinned input row / floating CTA
<View style={{ paddingBottom: Layout.bottomTabBarClearance }}>
  <SendButton />
</View>
```

Same rule for any view with a pinned floating CTA — use `Layout.floatingButtonClearance` (100pt) for the scroll content.

---

## 4. Corner Radii

| Token | Value | Usage |
|---|---|---|
| `xs` | 4 | Progress bars |
| `sm` | 8 | Small cards, pills |
| `md` | 12 | Standard cards, inputs |
| `lg` | 16 | Large cards, message bubbles |
| `xl` | 20 | Large buttons |
| `listItem` | 24 | Glass cards |
| `xxl` | 25 | Buttons (capsule) |
| `card` | 26 | Member cards |
| `sheet` | 32 | Sheet top corners |
| `full` | 9999 | Pill / circle |

---

## 5. Colors — `useAppColors()`, never hex

```tsx
import { useAppColors } from '@theme/appColors';

function View() {
  const colors = useAppColors();
  return <View style={{ backgroundColor: colors.cardBackground }} />;
}
```

Key tokens: `primary`, `primaryDark`, `accent`, `accentTeal`, `textPrimary`, `textSecondary`, `textTertiary`, `backgroundMain`, `backgroundSecondary`, `card`, `cardBackground`, `sheetBackground`, `chatUserBubble`, `chatAssistantBubble`, `chatInputBackground`, `chatInputBorder`, `success`, `warning`, `error`, `destructive`, `info`, `ambientCardio`, `ambientMobility`, `ambientStrength`, `chartWarm`, `chartCool`, `chartAlert`, `chartNeutral`, `statusSoon{Bg}`, `statusOverdue{Bg}`, `statusPastDue{Bg}`, `statusComplete{Bg}`.

Light mode must feel premium: white sheets, reduced shadow opacity (0.08), white cards with shadow.

---

## 6. Buttons

Existing components live under [src/components/ui/](../../src/components/ui/) — `Button`, `GradientButton`, `Chip`, `FloatingActionButton`. Always check there before building a new one.

All interactive elements must have:
- Min `44×44pt` tap target (`ButtonMetrics.minTapTarget`)
- Scale feedback on press (`pressScaleStandard 0.95`, `pressScaleCard 0.97`)
- Haptic feedback (see §13)

### Button metrics

| Token | Value |
|---|---|
| `primaryHeight` | 56 |
| `primaryCornerRadius` | 25 |
| `iconButtonSize` | 36 |
| `minTapTarget` | 44 |

---

## 7. Cards & Shadows

Cards must have depth — never flat:

```tsx
{
  backgroundColor: colors.cardBackground,
  borderRadius: CornerRadius.lg,
  shadowColor: '#000',
  shadowOpacity: isDark ? Shadow.light.opacityDark : Shadow.light.opacityLight,
  shadowRadius: Shadow.light.radius,
  shadowOffset: { width: 0, height: Shadow.light.offsetY },
  elevation: 2,
}
```

---

## 8. Backgrounds

Two background components, pick the right one:

| Component | When to use |
|---|---|
| `<AppBackground />` | Standard screens (splash crossfade) |
| `<AmbientBackground />` | AI / chat / voice / approvals / briefing screens |

`<AmbientBackground />` renders SimpleHouse's signature AI canvas: true-black base with three blurred pillar glows (cool top-left, lime mid-right, warm bottom-left).

```tsx
<AmbientBackground intensity={1}>
  <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
    {/* …screen… */}
  </SafeAreaView>
</AmbientBackground>
```

---

## 9. Chat surface — bubbles, input, attachments

All values from `Chat.*` in `designTokens.ts` and `chat*` colors in `useAppColors()`.

### Bubble

```tsx
const colors = useAppColors();

// User bubble
{
  backgroundColor: colors.chatUserBubble,
  paddingHorizontal: Chat.bubblePaddingHorizontal, // 14
  paddingVertical: Chat.bubblePaddingVertical,     // 10
  borderRadius: Chat.bubbleRadius,                 // 16
  borderTopRightRadius: Chat.bubbleTailRadius,     // 4
  maxWidth: '85%',
}

// Assistant bubble (left)
{
  backgroundColor: colors.chatAssistantBubble,
  paddingHorizontal: Chat.bubblePaddingHorizontal,
  paddingVertical: Chat.bubblePaddingVertical,
  borderRadius: Chat.bubbleRadius,
  borderTopLeftRadius: Chat.bubbleTailRadius,
  maxWidth: '85%',
}
```

When the bubble carries inline UI (`AssistantUIBlock`), widen to `Chat.bubbleWideMaxWidthRatio` (96 %).

### Input row

```tsx
{
  flexDirection: 'row',
  alignItems: 'flex-end',
  padding: Chat.inputRowPadding, // 12
  gap: Chat.inputRowGap,         // 8
  borderTopWidth: StyleSheet.hairlineWidth,
  borderTopColor: colors.chatInputBorder,
}
```

Input field height: `Chat.inputMinHeight` 44 → `Chat.inputMaxHeight` 120 (then scrolls). Action buttons: square `Chat.actionButtonSize` 44, radius `Chat.actionButtonRadius` 12, fill `colors.primary`.

### Image preview

In-bubble: `Chat.imagePreviewSize` 240 sq, radius `CornerRadius.md` 12.
Attachment chip thumb: `Chat.chipPreviewSize` 64.

---

## 10. Animation

```ts
Animation.entranceDuration  // 300ms
Animation.exitDuration      // 200ms (faster)
Animation.imageFadeIn       // 300ms
Animation.spring            // { damping: 18, stiffness: 220, mass: 1 }
```

- Spring over easing for UI interactions.
- Exits faster than entrances.
- Respect Reduced Motion — fall back to opacity cross-fades.

---

## 11. Navigation pattern

Use `<ScreenHeader />` from `@components/common`:

```tsx
<ScreenHeader
  title={personaName}
  showBackButton={!isTabRoot}
  onBackPress={() => navigation.goBack()}
  rightElement={…}
/>
```

---

## 12. Screen states — every screen must handle

1. **Content** — Normal data display
2. **Loading** — `<SkeletonLoader />` for lists/grids; spinner for full screen
3. **Empty** — `<EmptyState />` with icon (64pt @ 0.4 opacity), title, description, CTA
4. **Error** — Inline error UI with retry CTA
5. **Offline** — Offline banner

---

## 13. Haptics — `expo-haptics`

| Action | Style |
|---|---|
| Primary tap (button, send) | `Medium` |
| Secondary tap (cancel, back) | `Light` |
| Destructive (delete, end voice) | `Heavy` |
| Success (completion, approval) | `Success` |
| Error (form failure, voice error) | `Error` |

---

## 14. Existing shared components — check first

Before creating new components, check:

- **Common**: `AppBackground`, `AmbientBackground`, `SafeAreaView`, `ScreenHeader`, `BackButton`, `HeaderLogo`, `ImageGallery`, `PropertyBadge`, `PropertySwitcher`, `AIDisclaimerModal`, `ErrorBoundary`
- **UI**: `Button`, `GradientButton`, `Card`, `Chip`, `Avatar`, `BottomSheet`, `BlurTabBar`, `EmptyState`, `FilterTabs`, `FloatingActionButton`, `SearchBar`, `SkeletonLoader`, `StarRating`, `StatusBadge`, `TextInput`, `Toast`, `ToastContainer`, `Typography`
- **Aihousekeeper**: `AssistantUIBlock`, `PersonaAvatar`

---

## 15. Code conventions

- Prefer named exports over default; one component per file.
- Files match the primary type name (e.g. `AihousekeeperChatScreen.tsx`).
- Views end with `Screen` / `View`, contexts with `Context`, hooks with `use`, services with `Service`.
- No `console.log` in committed code — use `__DEV__` guards.

---

## 16. Anti-patterns — NEVER do

- Hardcode hex colors → `useAppColors()`.
- Raw `fontSize` / `fontWeight` → `scaledFont(variant)` / `<TypographyV2>`.
- Tap targets < 44pt.
- Ship a screen without Loading + Empty states.
- Leave cards flat (no shadow).
- Render an AI surface without `<AmbientBackground />`.
- Skip haptics on interactive elements.
- Skip `accessibilityLabel` on icon buttons.
- Build custom sheet chrome — use `<BottomSheet />`.
- Arithmetic on tokens (`Spacing.md + 2`).
- Mix `theme.spacing.*` (legacy) and `Spacing.*` (canonical) in the same file. Use `Spacing.*` from `@theme`.
- Use the legacy `<Typography variant="body">` (HIG ramp) when adding NEW code — use `<TypographyV2 variant="body">` (semantic ramp). Both render correctly; only one is the future.
- Render a tab-root scrollable without `paddingBottom: Layout.bottomTabBarClearance` — the floating tab bar will overlap. See §3.

---

## 17. LLM payload contract — what the backend may send

> **The backend emits semantic content only. Styling is 100 % the client's job.**

This is the same separation the Step iOS / LLMchat3 lambda uses, and it is non-negotiable here for the same reasons:

| Concern | Where it lives | Why |
|---|---|---|
| Brand tokens (color, font, spacing, radius) | RN client (`designTokens.ts`, `appColors.ts`, `chartPalette.ts`) | Light/dark, Dynamic Type, OS theming all happen on-device |
| Semantic content (text, IDs, intent) | Backend (`ui-blocks.ts` / household-chat `metadata.ui`) | The LLM is a content/intent generator, not a designer |
| Layout / view choice | RN client (`AssistantUIBlock.tsx` / `ChatMessageUi.tsx`) | Reusable, testable, ship without a backend deploy |

### Household chat `ChatUiBlock` (Budget / shared chat)

Mirror of `backend/src/services/chat/chat-room-service-core.ts` ↔ `src/features/chat/types.ts`. Rendered by `src/features/chat/ChatMessageUi.tsx` from `message.metadata.ui`.

Allowed kinds: `chart` (bar/pie/donut/line), `stats`, `table`, `insight`, `diagram`.

**Forbidden on chart data:** `color`, hex strings, or any style keys. Slice/bar colors come from `chatSliceColor(useAppColors(), index)` / `categoryRampColor`. Stats/insight `tone` is the only styling-adjacent enum (`neutral` | `positive` | `warning` | `negative`).

### Allowed `AssistantUIBlock` shapes

Mirror of [src/types/aihousekeeperUiBlocks.ts](../../src/types/aihousekeeperUiBlocks.ts). Add a new `type` to **both** the backend and this client type when extending — never client-only.

```ts
type AssistantUIBlock =
  | { type: 'task_list';        title?: string; tasks: TaskSummary[]; total?: number; actions?: UIActionButton[] }
  | { type: 'task_card';        task: TaskSummary; caption?: string; actions?: UIActionButton[] }
  | { type: 'action_item_list'; title?: string; items: ActionItemSummaryBlock[]; total?: number; actions?: UIActionButton[] }
  | { type: 'action_item_card'; item: ActionItemSummaryBlock; caption?: string; actions?: UIActionButton[] }
  | { type: 'action_row';       actions: UIActionButton[] };
```

```ts
type UIActionButton = {
  label: string;
  action:
    | { type: 'navigate';     screen: string; params?: Record<string, unknown> }
    | { type: 'deep_link';    url: string }
    | { type: 'send_message'; text: string };
  variant?: 'primary' | 'secondary' | 'destructive';  // semantic — NOT a color
};
```

### Allowed semantic enums on payloads

These are the **only** styling-adjacent fields the backend may send. The client maps each to a token:

| Enum field | Allowed values | Client mapping |
|---|---|---|
| `variant` (action button) | `'primary'` / `'secondary'` / `'destructive'` | `colors.primary` / `colors.secondaryButtonBackground` / `colors.destructive` |
| `priority` (action item) | `'low'` / `'medium'` / `'high'` / `'critical'` | Future: status badge color tier |
| `priority_severity` (task) | string from `AISeverity` enum | Future: status badge color tier |
| `status` (action item) | `'open'` / `'in_progress'` / `'done'` / `'archived'` | Future: status icon + tone |

### Forbidden in the payload

The backend **must never** emit any of:

- `color`, `backgroundColor`, `tint`, `accent`, `theme`, `mode: 'dark'`
- `fontSize`, `fontWeight`, `font`, `textStyle`
- `paddingX`, `marginX`, `radius`, `width`, `height`
- Hex strings (`#…`), rgba strings, `Color.*` references
- Anything that looks like a CSS / SwiftUI / RN style key

If a tool wants to nudge tone, the **only** legal approach is a new semantic enum that the client maps. Example design (not implemented yet):

```ts
// Backend
{ type: 'task_card', task, tone: 'warning' }   // ← semantic, not a color

// Client
const ACCENT_FOR_TONE: Record<Tone, keyof AppColors> = {
  info:        'info',
  success:     'success',
  warning:     'warning',
  destructive: 'destructive',
};
const accent = colors[ACCENT_FOR_TONE[block.tone]];
```

> Reviewer rule: any PR that adds a hex string, raw `fontSize`, or RN style key to a backend tool result is auto-rejected. Open an issue to extend the semantic enum instead.

### Adding a new block type

1. Add the discriminant + payload to `backend/src/services/ai/tools/ui-blocks.ts`.
2. Mirror it in `src/types/aihousekeeperUiBlocks.ts` (and extend `isAssistantUIBlock`).
3. Add a `case` in `src/components/aihousekeeper/AssistantUIBlock.tsx` that renders it with **only** tokens — no hex.
4. Document the enum here in §17.

---

## 18. Quick example — compliant card

```tsx
import { useAppColors } from '@theme/appColors';
import { CornerRadius, Shadow, Spacing, TypographyV2 } from '@theme';
import { useTheme } from '@contexts/ThemeContext';
import { Pressable, View } from 'react-native';

export function ExampleCard({
  title, subtitle, onPress,
}: { title: string; subtitle: string; onPress: () => void }) {
  const colors = useAppColors();
  const { isDark } = useTheme();

  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          padding: Spacing.base,
          borderRadius: CornerRadius.lg,
          backgroundColor: colors.cardBackground,
          shadowColor: '#000',
          shadowOpacity: isDark ? Shadow.light.opacityDark : Shadow.light.opacityLight,
          shadowRadius: Shadow.light.radius,
          shadowOffset: { width: 0, height: Shadow.light.offsetY },
          elevation: 2,
        }}
      >
        <TypographyV2 variant="title" color={colors.textPrimary}>{title}</TypographyV2>
        <TypographyV2
          variant="bodySmall"
          color={colors.textSecondary}
          style={{ marginTop: Spacing.xs }}
        >
          {subtitle}
        </TypographyV2>
      </View>
    </Pressable>
  );
}
```
