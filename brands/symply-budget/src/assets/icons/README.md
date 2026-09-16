# Symply Budget icon kit

A complete downloadable icon system for **Symply Budget**.

- 55 distinct icons
- selected gradient state
- dark-mode unselected state
- light-mode unselected state
- editable SVG and transparent PNG
- React Native dynamic component and wrappers
- semantic status assets
- painted Symply Budget logo mark

## Palette

`#5FD49A → #2BB673 → #239A61 → #1B7A4C`

Tone: calm, precise, trustworthy.

## Groups

- **Bottom tabs:** `budget`, `home`, `ai-coach`, `more`
- **Money surfaces:** `planned`, `spendings`, `income`, `expense`, `remaining`, `transfer`, `soft-transfer`, `import`, `export`, `review-draft`
- **Bills & obligations:** `bills`, `due`, `overdue`, `recurring`, `paid`, `document-scan`
- **Savings & long-term:** `savings`, `goal`, `registered-account`, `maintenance-fund`, `forecast`
- **Analysis:** `insights`, `trends`, `categories`, `budget-health`
- **Utility:** `search`, `filter`, `sort`, `edit`, `add`, `delete`, `share`, `settings`, `profile`, `notifications`, `sync`
- **Status:** `complete`, `in-progress`, `pending`, `overdue-status`, `skipped`
- **Category chips:** `housing`, `utilities`, `food`, `transport`, `health`, `shopping`, `subscriptions`, `debt`, `income-category`, `other`

## React Native

```bash
npx expo install react-native-svg
```

```tsx
import { SymplyBudgetIcon, MiraIcon } from './react-native';

<SymplyBudgetIcon name="planned" selected={isFocused} theme="dark" size={24} />
<MiraIcon selected size={24} />
```
