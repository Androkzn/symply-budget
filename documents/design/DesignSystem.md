# Symply Ecosystem Design System

> **Purpose**: Single source of truth for all visual and interactive patterns across Symply House, Budget, Kaizen, Language, and Health.
>
> **Rule**: Change tokens or shared primitives in one place — screens must not fork button/input/card chrome.
>
> **Stack**: React Native 0.81 + Expo 54. Brand packs supply color; the UI kit consumes theme tokens.

---

## Organization (change once → fleet-wide)

```text
brands/<id>/tokens.json          ← brand primary / gradients (per app)
        ↓  npm run design:build
src/brand/tokens.generated.ts
src/theme/colors.ts              ← palette.button.* = brand primary
src/theme/appColors.ts           ← useAppColors() semantic colors
src/theme/designTokens.ts        ← Spacing, CornerRadius, ButtonMetrics, …
src/theme/buttonGradients.ts     ← getButtonGradientColors() CTA ramp
        ↓
src/components/ui/*              ← Button, GradientButton, FAB, TextInput, Card, Typography, …
src/components/common/*          ← headers, backgrounds, brand chrome
src/components/auth/*            ← SocialAuthButton, BiometricSetupModal
        ↓
screens + features/*             ← import kit components; do not rebuild CTAs
```

| Layer | Change here | Propagates to |
|---|---|---|
| Brand colors | `brands/<id>/tokens.json` + `design:build` | Links, focus, fills for that brand |
| CTA gradient | `brands/<id>/tokens.json` → `gradients.cta` (+ `design:build`) | Face ID–style primary buttons: `Button`, `GradientButton`, FAB |
| Spacing / radii / metrics | `src/theme/designTokens.ts` | Every kit component reading those tokens |
| Semantic colors | `src/theme/appColors.ts` | Theme-aware surfaces across the app |
| Component look/behavior | `src/components/ui/<Component>.tsx` | Every screen using that component |

**Screens must import CTAs, inputs, cards, and typography from `@components/ui` (and auth chrome from `@components/auth`).** Do not invent a new primary button with `LinearGradient` + hardcoded hex.

---

## Source of truth (RN)

| Concern | File |
|---|---|
| Brand color packs | [brands/](../../brands/) + `npm run design:build` |
| Non-color tokens (Spacing, Radius, Typography ramp, …) | [src/theme/designTokens.ts](../../src/theme/designTokens.ts) |
| Theme-aware colors | [src/theme/appColors.ts](../../src/theme/appColors.ts) (`useAppColors()`) |
| Primary CTA gradients | [src/theme/buttonGradients.ts](../../src/theme/buttonGradients.ts) |
| Typography helpers | [src/theme/typography.ts](../../src/theme/typography.ts) (`scaledFont`, `<TypographyV2>`) |
| Shared UI kit | [src/components/ui/](../../src/components/ui/) |
| Shared chrome | [src/components/common/](../../src/components/common/) |
| Auth UI | [src/components/auth/](../../src/components/auth/) |
| Theme provider | [src/contexts/ThemeContext.tsx](../../src/contexts/ThemeContext.tsx) |
| Legacy color palette | [src/theme/colors.ts](../../src/theme/colors.ts) |
| Ambient AI background | [src/components/common/AmbientBackground.tsx](../../src/components/common/AmbientBackground.tsx) |
| Splash-based background | [src/components/common/AppBackground.tsx](../../src/components/common/AppBackground.tsx) |

---

## Table of Contents

1. [Color System](#1-color-system)
2. [Typography](#2-typography)
3. [Spacing & Layout](#3-spacing--layout)
4. [Corner Radii](#4-corner-radii)
5. [Shadows](#5-shadows)
6. [Backgrounds (Ambient AI Surface)](#6-backgrounds-ambient-ai-surface)
7. [Buttons](#7-buttons)
8. [Chat & AI Surfaces](#8-chat--ai-surfaces)
9. [Animations](#9-animations)
10. [Header & Navigation](#10-header--navigation)
11. [Screen States](#11-screen-states)
12. [Haptics](#12-haptics)
13. [Accessibility](#13-accessibility)
14. [Anti-Patterns](#14-anti-patterns)
15. [Migration Roadmap](#15-migration-roadmap)

---

## 1. Color System

All colors are accessed via the `useAppColors()` hook — never hardcode hex values.

```tsx
import { useAppColors } from '@theme/appColors';

function MyView() {
  const colors = useAppColors();
  return <View style={{ backgroundColor: colors.cardBackground }} />;
}
```

The hook returns a complete semantic surface that resolves against the active theme (light / dark) provided by `ThemeContext`. Static accessor `getAppColors('dark')` exists for module-scope `StyleSheet.create` calls but should be a last resort.

### Light mode quality rules

To keep light feeling premium and not just mechanically inverted:
- **Sheet backgrounds**: `#FFFFFF` (not dark).
- **Shadows**: opacity 0.08 (vs 0.30 dark) — never harsh.
- **Cards**: white **with shadow** — not just a fill.

### Brand & semantic

| Token | Light | Dark | Usage |
|---|---|---|---|
| `primary` | `#4ECDC4` | `#4ECDC4` | Brand teal (CTAs, focus, user bubble tint) |
| `primaryDark` | `#3DBDB5` | `#2D9D96` | Pressed / darker variant |
| `accent` | `#007AFF` | `#5CADFF` | Highlight / link |
| `accentTeal` | `#4ECDC4` | `#4ECDC4` | Active badges, checkmarks |
| `success` | `#34C759` | `#34C759` | Success states |
| `warning` | `#FF9500` | `#FF9500` | Warnings |
| `error` / `destructive` | `#FF3B30` | `#FF3B30` | Errors / destructive actions |
| `info` | `#5856D6` | `#5856D6` | Info |

### Backgrounds

| Token | Light | Dark | Usage |
|---|---|---|---|
| `backgroundMain` | `#FFFFFF` | `#000000` | Primary app background |
| `backgroundSecondary` | `#F2F2F7` | `#1C1C1E` | Secondary / grouped |
| `detailBackground` | `#FAFAFA` | `#202124` | Detail screens |
| `sheetBackground` | `#FFFFFF` | `#1C1C1E` | Bottom sheets / modals |
| `messageInputBackground` | `#F0F0F0` | `#171717` | Text input field fill |

### Surfaces

| Token | Light | Dark | Usage |
|---|---|---|---|
| `card` | `#FFFFFF` | `#202632` | Card containers |
| `cardBackground` | `#FFFFFF` | `rgba(255,255,255,0.06)` | Card content surface |
| `cardSubtle` | `rgba(0,0,0,0.03)` | `rgba(255,255,255,0.05)` | Subtle inline rows |
| `pillBackground` | `#E8E8E8` | `#292B2F` | Pill / chip background |
| `inputFieldBackground` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` | Text fields |
| `secondaryButtonBackground` | `rgba(120,120,128,0.16)` | `rgba(120,120,128,0.32)` | Outline / ghost buttons |
| `groupedListBackground` | `palette.gray[100]` | `rgba(255,255,255,0.06)` | Settings / list groups |

### Text

| Token | Light | Dark | Usage |
|---|---|---|---|
| `textPrimary` | `#000000` | `#FFFFFF` | Headlines, body, button labels |
| `textSecondary` | `#666666` | `#9CA3AF` | Subtitles, captions, metadata |
| `textTertiary` | `#9CA3AF` | `#6B7280` | Disabled / hint text |

### Chat (AI Coach)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `chatUserBubble` | `#4ECDC4` | `rgba(78,205,196,0.30)` | User message bubble |
| `chatAssistantBubble` | `#F2F2F7` | `rgba(255,255,255,0.06)` | AI message bubble |
| `chatSuggestionBubble` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.08)` | Suggested-reply chips |
| `chatInputBackground` | `#F0F0F0` | `rgba(255,255,255,0.06)` | Input pill fill |
| `chatInputBorder` | `#C6C6C8` | `rgba(255,255,255,0.12)` | Input pill hairline |

### Ambient (AI surface) glows

Three blurred color blobs sit over `backgroundMain` to create SimpleHouse's signature AI canvas. Used by `<AmbientBackground />` (see §6).

| Token | Light | Dark | Position |
|---|---|---|---|
| `ambientCardio` | `#01D7DA` | `#01D7DA` | Top-left, cool teal |
| `ambientMobility` | `#B5FF01` | `#B5FF01` | Mid-right, lime |
| `ambientStrength` | `#FF8800` | `#FF8800` | Bottom-left, warm orange |

### Data-viz (chart) accents

Used by chart bars / lines inside chat-generated visuals.

| Token | Light | Dark | Usage |
|---|---|---|---|
| `chartWarm` | `#FF8C42` | `#FF8C42` | Primary bars (workouts, calories) |
| `chartCool` | `#4ECDC4` | `#5AC8FA` | Secondary bars / lines (minutes, steps) |
| `chartAlert` | `#E74C3C` | `#FF453A` | Emphasis / alerts |
| `chartNeutral` | `#D1D5DB` | `#3A3A3C` | Gridlines, axes |

### Status (task badges)

| Token | Light | Dark |
|---|---|---|
| `statusSoon` / `statusSoonBg` | `#FFB800` / `#FFF8E1` | `#FFD54F` / `#3D3520` |
| `statusOverdue` / `statusOverdueBg` | `#FF6B35` / `#FFEBE5` | `#FF8A65` / `#3D2520` |
| `statusPastDue` / `statusPastDueBg` | `#DC3545` / `#FFE5E8` | `#EF5350` / `#3D2020` |
| `statusComplete` / `statusCompleteBg` | `#34C759` / `#E8F8ED` | `#66BB6A` / `#203D25` |

---

## 2. Typography

All semantic type styles live in `Tokens.typography.*` (or `TypographyTokens.*`). Use either the helper or the component:

```tsx
import { TypographyV2, scaledFont } from '@theme';

<TypographyV2 variant="title" color={colors.textPrimary}>Hello</TypographyV2>

// Or extend an existing Text:
<Text style={[scaledFont('body'), { color: colors.textPrimary }]} />
```

`scaledFont` honors the system font scale (Dynamic Type / Android Font Scale) but clamps it per variant so fixed-width containers don't break.

### Semantic type ramp

| Token | Size / Weight | Letter spacing | Default `maxScale` | Usage |
|---|---|---|---|---|
| `display` | 34 / 700 | -0.5 | 1.5 | Hero numbers, stat values |
| `heading` | 28 / 600 | -0.3 | 1.5 | Screen titles |
| `title` | 24 / 600 | -0.13 | 1.4 | Card titles, section headings |
| `titleSmall` | 20 / 500 | 0 | 1.4 | Sub-section titles, greetings |
| `bodyLarge` | 18 / 600 | 0 | 1.4 | Emphasized body |
| `buttonLabel` | 17 / 600 | 0 | 1.3 | Primary button labels, CTAs |
| `body` | 16 / 400 | 0 | 1.3 | Default body text |
| `bodyMedium` | 16 / 500 | 0 | 1.3 | Emphasized callouts |
| `label` | 15 / 500 | 0 | 1.3 | Small card titles, tags, badges |
| `labelRegular` | 15 / 400 | 0 | 1.3 | Feature descriptions |
| `bodySmall` | 14 / 400 | 0 | 1.3 | Card descriptions |
| `bodySmallMedium` | 14 / 500 | 0 | 1.3 | Card action labels |
| `bodySmallSemibold` | 14 / 600 | 0 | 1.3 | Avatar initials |
| `caption` | 13 / 400 | 0 | 1.25 | Footnotes, timestamps |
| `captionSmall` | 12 / 400 | 0 | 1.2 | Small metadata |
| `captionBold` | 12 / 700 | 0 | 1.2 | Bold small labels |
| `overline` | 11 / 500 UPPERCASE | +1.0 | 1.2 | Section markers |
| `micro` | 10 / 500 | 0 | 1.2 | Tab bar labels, tiny badges |

### Section header hierarchy

| Tier | Token | Style | Color | Usage |
|---|---|---|---|---|
| Primary | `title` / `titleSmall` | 20–24pt sentence case | `textPrimary` | Top-level sections |
| Structural | `overline` | 11pt UPPERCASE | `textSecondary` | Sub-section markers |

Never mix tiers (no `overline` for top-level sections, no `title` for structural markers).

### Coexistence with the existing `<Typography>` component

The legacy [src/components/ui/Typography.tsx](../../src/components/ui/Typography.tsx) uses Apple HIG variant naming (`body`, `headline`, `caption1`, …). It still works — but new code should use `<TypographyV2 variant="…">` (or `scaledFont('…')`) so screens stay on one ramp. Migration is screen-by-screen.

---

## 3. Spacing & Layout

The app uses an **8pt-based** spacing scale. Tokens are in [src/theme/designTokens.ts](../../src/theme/designTokens.ts) under `Spacing` / `Layout`.

### Spacing tokens

| Token | Value | Use |
|---|---|---|
| `Spacing.xxs` | 2 | Hairline gaps |
| `Spacing.xs` | 4 | Minimal gaps, pill padding |
| `Spacing.sm` | 8 | Tight spacing, icon→title |
| `Spacing.md` | 12 | Card gaps, internal padding |
| `Spacing.base` | 16 | Card content padding |
| `Spacing.lg` | 20 | Page margins |
| `Spacing.xl` | 24 | Header spacing |
| `Spacing.xxl` | 32 | Major section spacing |

### Layout tokens

| Token | Value | Use |
|---|---|---|
| `Layout.pageMargin` | 20 | Standard horizontal padding |
| `Layout.sectionSpacing` | 32 | Between major content groups |
| `Layout.cardSpacing` | 12 | Between cards in a list |
| `Layout.bottomSafeArea` | 32 | When no floating tab bar |
| `Layout.bottomTabBarClearance` | 88 | When a floating tab bar is present |
| `Layout.floatingButtonBottom` | 26 | CTA → home indicator |
| `Layout.floatingButtonClearance` | 100 | Scroll padding behind floating CTA |
| `Layout.headerBottom` | 24 | Below nav header |

### Floating tab bar clearance — REQUIRED

The bottom tab bar in [`app/(tabs)/_layout.tsx`](../../app/%28tabs%29/_layout.tsx) is rendered as a `position: 'absolute', bottom: 0` overlay. **Any scrollable inside a tab-root screen MUST add `Layout.bottomTabBarClearance` (88pt) to the bottom of its content container** or the last item will sit underneath the tab bar.

```tsx
// ✅ Correct — FlatList / ScrollView at tab root
<FlatList
  contentContainerStyle={{ padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance }}
  …
/>

// ✅ Correct — input bar / floating CTA at tab root
<View style={{ paddingBottom: Layout.bottomTabBarClearance }}>
  <CTA />
</View>
```

**When to apply:**
- Any screen rendered under `app/(tabs)/...` whose content scrolls.
- Any screen with a floating CTA button/input row pinned to the bottom.

**When NOT needed:**
- Screens pushed on top of the tab navigator (modal, sheet) where the tab bar is hidden.
- Bottom-sheet content (the sheet has its own backdrop).

### Card internal rhythm

| Relationship | Token |
|---|---|
| Icon → Title | `sm` (8) or `md` (12) |
| Title → Subtitle | `xs` (4) or `sm` (8) |
| Content block → Action button | `md` (12) or `base` (16) |
| Card content padding | `base` (16) |

Never use `xxs` between an icon and a title — too cramped. Never do arithmetic on tokens; if no token matches, use a raw value with a `// Figma: Npx` comment.

---

## 4. Corner Radii

| Token | Value | Use |
|---|---|---|
| `CornerRadius.xs` | 4 | Progress bars |
| `CornerRadius.sm` | 8 | Small cards, pills |
| `CornerRadius.md` | 12 | Standard cards, inputs |
| `CornerRadius.lg` | 16 | Large cards, message bubbles |
| `CornerRadius.xl` | 20 | Large buttons |
| `CornerRadius.listItem` | 24 | List items, glass cards |
| `CornerRadius.xxl` | 25 | Buttons (capsule) |
| `CornerRadius.card` | 26 | Member cards, activity rows |
| `CornerRadius.sheet` | 32 | Sheet top corners |
| `CornerRadius.full` | 9999 | Full pill / circle |

Rule of thumb: radius ≈ 1/4 to 1/6 of the shortest dimension.

---

## 5. Shadows

Cards must have depth — never flat.

| Tier | Radius / Y | Light opacity | Dark opacity | Use |
|---|---|---|---|---|
| `Shadow.light` | 4 / 2 | 0.08 | 0.30 | Standard content cards |
| `Shadow.medium` | 4 / 2 | 0.10 | 0.20 | Interactive cards, controls |
| `Shadow.dark` | 8 / 4 | 0.15 | 0.50 | Floating elements, modals |

Recipe:

```ts
const colors = useAppColors();
{
  shadowColor: '#000',
  shadowOpacity: isDark ? Shadow.light.opacityDark : Shadow.light.opacityLight,
  shadowRadius: Shadow.light.radius,
  shadowOffset: { width: 0, height: Shadow.light.offsetY },
  elevation: 2, // Android
}
```

Or use `colors.shadowLight` (already pre-baked rgba) and apply directly as `shadowColor`.

---

## 6. Backgrounds (Ambient AI Surface)

Two background components ship with SimpleHouse:

| Component | Use |
|---|---|
| `<AppBackground />` | Standard screens — splash-asset crossfade between themes |
| `<AmbientBackground />` | AI / chat / voice surfaces — true-black canvas with three blurred pillar glows |

`<AmbientBackground />` renders SimpleHouse's signature AI canvas. Its three glows are tokenized:

```tsx
import { AmbientBackground, SafeAreaView } from '@components/common';

<AmbientBackground intensity={1}>
  <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
    {/* …screen content… */}
  </SafeAreaView>
</AmbientBackground>
```

| Property | Value |
|---|---|
| Base | `#000000` |
| Cool blob | `colors.ambientCardio` @ ~0.32 opacity, top-left |
| Lime blob | `colors.ambientMobility` @ ~0.28 opacity, mid-right |
| Warm blob | `colors.ambientStrength` @ ~0.30 opacity, bottom-left |
| iOS softening | `shadowRadius: 90` per blob (true Gaussian blur) |
| Vignette | Black @ 0.18 over the lot, for text contrast |

> **Rule**: Use `<AmbientBackground />` for every AI surface (chat, voice, briefing, approvals). This is the look users associate with "Aihousekeeper is here".

---

## 7. Buttons

All interactive elements must satisfy:

- Min `44 × 44pt` tap target → `ButtonMetrics.minTapTarget`
- Press feedback: scale 0.95 (standard) / 0.97 (cards) → `ButtonMetrics.pressScale*`
- Haptic on tap (see §12)

### Button metrics

| Token | Value |
|---|---|
| `ButtonMetrics.primaryHeight` | 56 |
| `ButtonMetrics.primaryCornerRadius` | 25 |
| `ButtonMetrics.iconButtonSize` | 36 |
| `ButtonMetrics.minTapTarget` | 44 |
| `ButtonMetrics.pressScaleStandard` | 0.95 |
| `ButtonMetrics.pressScaleCard` | 0.97 |
| `ButtonMetrics.pressOpacityCard` | 0.9 |

Existing components (use these before building new ones): see [src/components/ui/](../../src/components/ui/) — `Button`, `GradientButton`, `Chip`, `FloatingActionButton`, etc.

| Need | Use |
|---|---|
| Form / auth primary CTA | `<Button variant="primary" />` (brand gradient) |
| Emphasized in-flow CTA | `<GradientButton />` |
| Tab-root floating CTA | `<FloatingActionButton />` |
| Apple / Google auth outline | `<SocialAuthButton />` from `@components/auth` |
| Secondary / ghost / outline | `<Button variant="secondary\|outline\|ghost" />` |

Primary CTA colors come from `getButtonGradientColors('primary')` → brand `gradients.cta` (vivid left→right ramp, e.g. Kaizen sky blue → indigo). Edit `gradients.cta` in `brands/<id>/tokens.json`, run `APP_BRAND=<id> npm run design:build`, reload — every kit primary CTA updates.

---

## 8. Chat & AI Surfaces

Tokens specific to AI chat live under `Chat.*` in `designTokens.ts` and `chat*` colors in `useAppColors()`.

### Layout

| Token | Value | Use |
|---|---|---|
| `Chat.bubbleRadius` | 16 | Bubble corner radius |
| `Chat.bubbleTailRadius` | 4 | Tail corner (top of speaker side) |
| `Chat.bubblePaddingHorizontal` | 14 | Bubble horizontal padding |
| `Chat.bubblePaddingVertical` | 10 | Bubble vertical padding |
| `Chat.bubbleMaxWidthRatio` | 0.85 | Default bubble width as fraction of row |
| `Chat.bubbleWideMaxWidthRatio` | 0.96 | Bubble carrying inline UI cards |
| `Chat.bubbleRowSpacing` | 10 | Vertical gap between rows |
| `Chat.inputRowPadding` | 12 | Padding around input row |
| `Chat.inputRowGap` | 8 | Spacing between input controls |
| `Chat.actionButtonSize` | 44 | Square action buttons (attach, voice) |
| `Chat.actionButtonRadius` | 12 | Action button corner radius |
| `Chat.inputMinHeight` | 44 | Input min height |
| `Chat.inputMaxHeight` | 120 | Input max height (then scrolls) |
| `Chat.imagePreviewSize` | 240 | In-bubble image preview |
| `Chat.chipPreviewSize` | 64 | Attachment chip preview |
| `Chat.welcomeAvatarSize` | 230 | Welcome screen avatar/video |

### Bubble recipe

```tsx
const colors = useAppColors();

// User bubble (right-aligned)
{
  backgroundColor: colors.chatUserBubble,
  paddingHorizontal: Chat.bubblePaddingHorizontal,
  paddingVertical: Chat.bubblePaddingVertical,
  borderRadius: Chat.bubbleRadius,
  borderTopRightRadius: Chat.bubbleTailRadius,
  maxWidth: `${Chat.bubbleMaxWidthRatio * 100}%`,
}

// Assistant bubble (left-aligned)
{
  backgroundColor: colors.chatAssistantBubble,
  paddingHorizontal: Chat.bubblePaddingHorizontal,
  paddingVertical: Chat.bubblePaddingVertical,
  borderRadius: Chat.bubbleRadius,
  borderTopLeftRadius: Chat.bubbleTailRadius,
  maxWidth: `${Chat.bubbleMaxWidthRatio * 100}%`,
}
```

For bubbles carrying generative UI (cards, lists, charts) widen to `Chat.bubbleWideMaxWidthRatio`.

### Input row

```tsx
{
  flexDirection: 'row',
  alignItems: 'flex-end',
  padding: Chat.inputRowPadding,
  gap: Chat.inputRowGap,
  borderTopWidth: StyleSheet.hairlineWidth,
  borderTopColor: colors.chatInputBorder,
}
```

The send / voice / attach buttons all use `Chat.actionButtonSize` (44) and `Chat.actionButtonRadius` (12) on a `colors.primary` fill.

### Surface

Every AI chat screen wraps its content in `<AmbientBackground />` — see §6. The `sheetBackground` token is used when chat is presented inside a modal sheet.

---

## 9. Animations

| Token | Value | Use |
|---|---|---|
| `Animation.entranceDuration` | 300 | Entrances |
| `Animation.exitDuration` | 200 | Exits (faster than entrances) |
| `Animation.imageFadeIn` | 300 | Image cross-fade |
| `Animation.spring` | `{ damping: 18, stiffness: 220, mass: 1 }` | UI interactions |

Principles:
1. Spring over easing for UI interactions.
2. Exits are faster than entrances.
3. Respect Reduced Motion — fall back to opacity cross-fades.

---

## 10. Header & Navigation

Use `<ScreenHeader />` (in [src/components/common](../../src/components/common/)) for all toolbars. Standard layout: title centered/inline, leading icon for back/close, trailing actions.

---

## 11. Screen States

Every screen must handle five states:

1. **Content** — Normal data display
2. **Loading** — Skeleton (lists/grids) or spinner (full screen). See [src/components/ui/SkeletonLoader.tsx](../../src/components/ui/SkeletonLoader.tsx)
3. **Empty** — Icon (`EmptyState.iconSize` = 64, opacity 0.4) + title + description + CTA
4. **Error** — Inline error component with retry CTA
5. **Offline** — Offline banner

Existing component: [src/components/ui/EmptyState.tsx](../../src/components/ui/EmptyState.tsx).

---

## 12. Haptics

Use `expo-haptics`. Pair every interaction with the right intensity:

| Action | Style |
|---|---|
| Primary tap (button, card, send) | `Medium` |
| Secondary tap (cancel, back) | `Light` |
| Destructive (delete, logout, end voice) | `Heavy` |
| Success (completion, approval) | `Success` |
| Error (form failure, voice error) | `Error` |

---

## 13. Accessibility

- **Tap targets**: `Accessibility.minTapTarget` = 44pt minimum. Use `hitSlop` to extend hit areas of small icons.
- **Contrast**: Body 4.5 : 1, large text 3 : 1 (`Accessibility.bodyContrastRatio` / `largeTextContrastRatio`).
- **Labels**: All buttons / pressables must have `accessibilityLabel`.
- **Reduce Motion**: Use `useReducedMotion` hook (TBD) before triggering springs.
- **Dynamic Type**: All text uses `scaledFont(…)`; never raw `fontSize` in screen code.

---

## 14. Anti-Patterns — NEVER

- Hardcode hex colors → use `useAppColors()`.
- Build a one-off primary CTA with `LinearGradient` / `TouchableOpacity` → use `Button`, `GradientButton`, or `FloatingActionButton`.
- Read `palette.button.*` in screens → use kit components or `getButtonGradientColors()`.
- Raw `<Text style={{ fontSize: 16 }}>` → use `<Typography>` / `<TypographyV2>` or `scaledFont('…')`.
- Tap targets < 44pt.
- Ship a screen without Loading + Empty states.
- Leave cards flat (no shadow).
- Use `theme.spacing.md` AND `Spacing.md` in the same file — pick the canonical token (`Spacing.*` from `@theme`).
- Render an AI chat screen without `<AmbientBackground />` underneath.
- Build custom sheet chrome — use the existing `<BottomSheet />` component.
- Arithmetic on tokens (`Spacing.md + 2`); use a raw value + `// Figma: Npx` comment.
- Render a scrollable at tab root without `paddingBottom: Layout.bottomTabBarClearance` — the floating tab bar will overlap the last item. See §3 (Floating tab bar clearance).
- Fork Login / Face ID / social auth UI per brand — auth lives in `src/screens/auth` + `src/components/auth`.

---

## 15. Migration Roadmap

The token system is rolling out screen by screen.

### Phase 1 — AI Chat (current)

- ✅ Create `designTokens.ts`, `appColors.ts`, `typography.ts`
- ✅ Create `<AmbientBackground />` for AI surfaces
- ✅ Migrate **AihousekeeperChatScreen** (`src/screens/aihousekeeper/AihousekeeperChatScreen.tsx`) to tokens
- ⏳ Migrate `AssistantUIBlock` to use `chartWarm`/`chartCool`/`chartAlert` for any inline visuals
- ⏳ Add `<TypographyV2>` swap inside chat bubbles

### Phase 2 — App-wide (planned)

1. Move all screens off raw `theme.colors.*` reads onto `useAppColors()`.
2. Migrate all `<Typography variant="body">` (HIG ramp) → `<TypographyV2 variant="body">` (semantic ramp).
3. Replace all `theme.spacing.*` reads with `Spacing.*` from `@theme`.
4. Add `<AppBackground />` / `<AmbientBackground />` consistently — no bare `View` roots.
5. Audit shadows + corner radii for token compliance.

> When porting a screen, always verify: no hardcoded hex, no raw `fontSize`, no tap targets under 44, has Loading + Empty states, and the right background component at the root.
