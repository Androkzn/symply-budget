# React Query migration pattern (Track A / A7)

Template for moving server fetch out of Zustand into React Query without a big-bang rewrite.

## Reference implementations

**Notification history** — `src/hooks/useNotificationHistory.ts`

**Household members** — `src/hooks/useHouseholdMembers.ts` (members list on `HouseholdMembersScreen`; store keeps invitations/join-requests + mutations)

**Kaizen read selectors** — `src/features/kaizen/stores/kaizenSelectors.ts` (pure filter/sort helpers for books + interview attempts; store keeps mutations + local SQLite hydrate)

**Kaizen weekly reviews** — `src/features/kaizen/hooks/useKaizenWeeklyReviews.ts` (`ReviewsScreen` list read; store keeps `saveWeeklyReview`)

**Kaizen books library** — `src/features/kaizen/hooks/useKaizenBooks.ts` (`BooksScreen` list read; store keeps `addBook` / `deleteBook`)

| Layer | Responsibility |
|-------|------------------|
| `@api/notifications` | HTTP + optional Zod validation |
| `usePersistedQuery` | Server cache + MMKV cold-start hydration |
| `notificationStore` | Permission state, badge sync, mutation side-effects |
| Screen | Reads hook `data`; calls store actions for mark-read/delete |

## Steps to migrate a list screen

1. Add a `useXxxQuery` hook with a stable `queryKey` array.
2. Prefer `usePersistedQuery` when the list should render instantly on cold start.
3. Keep Zustand for UI-only state (filters, selection, sheet visibility).
4. Replace store `loadXxx` with `queryClient.invalidateQueries` after mutations.
5. Document the hook in this file; do not migrate entire stores in one pass.

## Query key convention

```ts
export const fooQueryKey = ['domain', 'resource', id] as const;
```

## When to use plain `useQuery`

Ephemeral data (chat messages while room is open) or data that must always refetch on focus.

## When to use `usePersistedQuery`

Household-scoped lists, notification history, dashboard summaries — anything that currently lives in a Zustand store with manual `AsyncStorage` caching.
