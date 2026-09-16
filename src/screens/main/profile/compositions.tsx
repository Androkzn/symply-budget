import React from 'react';

import { HouseSyncSharingSection } from '@components/house/HouseSyncSharingSection';
import { BudgetSyncSharingSection } from '@features/budget/components/BudgetSyncSharingSection';

import { ProfileAboutSection } from './ProfileAboutSection';
import { ProfileQuickSignInCard } from './ProfileQuickSignInCard';

/**
 * PER-APP PROFILE COMPOSITIONS.
 *
 * Every app owns its own composition here. The shared shell
 * (`ProfileShell`) draws only what is genuinely identical for all of them —
 * avatar, display name, subscription, last-synced, Save, and the danger zone —
 * and everything an app wants beyond that is declared in ITS OWN entry below.
 *
 * WHY THIS SHAPE, rather than five copies of ProfileScreen:
 *
 *   - Independence is the point. Changing House's profile means editing
 *     `house` here and nothing else. Two apps can be edited in the same commit
 *     window without touching the same lines, which is the failure this
 *     replaced: on 2026-09-04 Budget and House had independently done the SAME
 *     "move Sync & Sharing onto Profile" refactor, and the merge produced 23
 *     conflict hunks across Profile and Settings (PR #88). Every one of them was
 *     in shell-level brand conditionals like
 *     `{(isFullBudget() || isHouseBrand()) && ...}`.
 *
 *   - Duplicating the shell would trade those conflicts for silent drift. The
 *     avatar picker, the delete-account flow and Sign out are the same product
 *     decision in all five apps; a fix to one must not have to be remembered
 *     four more times. Those stay in the shell.
 *
 *   - The varying parts are PIECES (`ProfileQuickSignInCard`,
 *     `ProfileAboutSection`, the two sync sections), so a composition is a list,
 *     not a re-implementation. A new app starts by copying three lines.
 *
 * Each piece still self-gates where it has its own precondition — the sync
 * sections return null off-brand, and the quick sign-in card returns null until
 * the platform reports an enrolled biometric — so a composition states INTENT
 * and the piece decides whether it can honour it today.
 */
export interface ProfileComposition {
  /** Sync / sharing rows, directly under the subscription block. */
  syncSections?: React.ReactNode;
  /** Extra rows between sync and the last-synced line. */
  extras?: React.ReactNode;
  /** Trailing section, below the danger zone. */
  about?: React.ReactNode;
}

/** Full Budget: its own sync rows, quick sign-in, and account documents. */
const budget: ProfileComposition = {
  syncSections: <BudgetSyncSharingSection />,
  extras: <ProfileQuickSignInCard />,
  about: <ProfileAboutSection />,
};

/** House: the same shape as Budget, with House's own sync rows. */
const house: ProfileComposition = {
  syncSections: <HouseSyncSharingSection />,
  extras: <ProfileQuickSignInCard />,
  about: <ProfileAboutSection />,
};

/**
 * Every other app — Kaizen, Language, Health, and minimal Budget.
 *
 * Deliberately bare: these brands keep their ACCOUNT rows and their own ABOUT
 * section on the More tab, which is still a real tab for them rather than an
 * overflow hub. Adding a piece here is how one of them opts in.
 */
const base: ProfileComposition = {};

export const PROFILE_COMPOSITIONS = { budget, house, base };
