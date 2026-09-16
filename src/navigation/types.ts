import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { BudgetQuickAddSuggestion, ExpenseBulkPlan } from '@api/budget';
import type { GardenPlanType } from '@api/garden-plans';
import type { LifeSystem } from '@features/kaizen/constants';
// Utilities is a self-contained House feature module and owns its own route
// map; this hub only composes it into the tab navigator.
import type { UtilitiesStackParamList } from '@features/utilities/navigation/types';

// Root Stack — unauth + onboarding only (`app/_layout.tsx` gates expo-router).
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  AcceptInvite: { token: string };
};

// Reports Stack
export type ReportsStackParamList = {
  ReportsMain: undefined;
  ReportDetail: { householdId: string; reportId: string };
};

// Garbage Collection Stack
export type GarbageStackParamList = {
  GarbageMain: undefined;
  CategoryDetail: { category: 'garbage' | 'recycling' | 'organics' };
  ReminderSettings: { scheduleId: string };
};

// Main Tab Navigator
export type MainTabParamList = {
  MyHome: undefined;
  Home: undefined;
  Gardening: NavigatorScreenParams<GardeningStackParamList>;
  Tasks: NavigatorScreenParams<TasksStackParamList>;
  Budget: NavigatorScreenParams<BudgetStackParamList>;
  Contractors: NavigatorScreenParams<ContractorsStackParamList>;
  Reports: NavigatorScreenParams<ReportsStackParamList>;
  Utilities: NavigatorScreenParams<UtilitiesStackParamList>;
  Notifications: undefined;
  Settings: NavigatorScreenParams<SettingsStackParamList>;
};

// Smart Budget Stack
export type BudgetStackParamList = {
  BudgetMain: undefined;
  BudgetItemForm:
    | {
        itemId?: string;
        expenseId?: string;
        kind?: 'planned' | 'spent';
        expenseDraft?: {
          title: string;
          amount: number;
          expense_date: string;
          category_id?: string | null;
          /**
           * Sales tax folded into `amount`. Carried so the form can split the
           * total back into its pre-tax amount + tax rows on the FIRST paint,
           * instead of briefly showing the tax-inclusive figure as the price.
           */
          tax_amount?: number;
          /** Stock-up plan, so the bulk section opens already set on the first paint. */
          bulk?: ExpenseBulkPlan | null;
        };
        // Prefill a brand-new form from a quick-add chip tapped
        // outside the form (e.g. the Spendings list). Applied once on mount and
        // left dirty so Save stays enabled.
        quickAddDraft?: BudgetQuickAddSuggestion;
      }
    | undefined;
  BudgetItemAI: { kind?: 'planned' | 'spent' } | undefined;
  BudgetReceiptScan: undefined;
  BudgetSettings: undefined;
  // Mortgage (Budget-only) — setup wizard + detail flows.
  MortgageSetup: undefined;
  // Manage properties: switch active, edit, delete, clean/edit statement data.
  MortgageSettings: undefined;
  // Reorder / hide the Mortgage dashboard's tab strip (nested off settings).
  MortgageTabs: undefined;
  // Edit an existing property's editable fields (name, lender, address, value, active).
  MortgageEdit: { mortgageId: string };
  // List/clean/edit the statements that anchor a property's balance.
  MortgageStatements: { mortgageId: string };
  // `statement` present → edit that statement (prefill + replace) instead of add.
  MortgageStatementForm: { mortgageId: string; statement?: import('@api/mortgage').MortgageStatement };
  MortgageRenew: { mortgageId: string };
  MortgageRenewalOffers: { mortgageId: string };
  MortgageHistory: { mortgageId: string };
  MortgageRecordChange: { mortgageId: string };
  // Add/remove custom categories and toggle built-in ones (nested off settings).
  BudgetCategories: undefined;
  // Per-category caps within the monthly budget (nested off settings).
  BudgetSubBudgets: undefined;
  /** The per-year monthly cap editor — the 12-month grid, split out of Settings. */
  BudgetMonthlyCaps: undefined;
  /** Backup & Restore — split out of Settings, which had grown four peer buttons. */
  BudgetBackup: undefined;
  /** Device sync — sync now, trusted devices, and the local danger zone. */
  BudgetSync: undefined;
  /**
   * The per-category record census, for verifying two devices hold the same
   * budget. Pushed from Device sync rather than reachable on its own: it only
   * means anything next to the sync controls that produced it.
   */
  BudgetSyncInventory: undefined;
  /**
   * Invite & Household — the hub. Who is in this household, and three rows that
   * push: invite somebody, join somebody, manage the households on this device.
   */
  BudgetInvite: undefined;
  /** The owner's half: mint a code, hand it over, approve the device that claims it. */
  BudgetInviteCreate: undefined;
  /**
   * The invitee's half. Params arrive from a tapped invite link, which carries
   * both halves of the invite — the hub hands them straight over so the fields
   * are filled and only the confirmation is left.
   */
  BudgetJoin: { code?: string; secret?: string } | undefined;
  /**
   * The households on this device — the LIST. Create, switch, and open one.
   *
   * Takes no params: editing one household is `BudgetHouseholdEdit` below, a
   * screen of its own, so there is no sheet here for a param to pre-open.
   */
  BudgetHouseholds: undefined;
  /**
   * One household, everything about it — photo, name, optional address, the
   * people in it, and the exits.
   *
   * Omit `householdId` and the same screen is the CREATE form: a household is
   * named, pictured and addressed in one save rather than created from a
   * name-only sheet and then edited for the rest.
   */
  BudgetHouseholdEdit: { householdId?: string } | undefined;
  /** Export — pick the sections, then take an .xlsx workbook or the CSV bundle. */
  BudgetExport: undefined;
  // Move a month's leftover budget to next month / a savings goal / a TFSA-RRSP account.
  BudgetTransfer: undefined;
  BudgetYearSetup: { year: number; fromMonth: number; plannedBudget: number };
  BudgetLongTermTimeline: undefined;
  /**
   * Product-level breakdown + trends for a single spending category, or — when
   * `categoryIds` is present (the dashboard's aggregate "Other" row) — for that
   * whole bucket of categories merged into one view.
   */
  BudgetCategoryDetail: {
    categoryId: string;
    categoryName: string;
    categoryIds?: string[];
  };
  // "See all spending" explorer — filter by range/category/search, view distributions.
  BudgetAllSpending: undefined;
  BudgetAllPlanning: undefined;
  /**
   * The page behind a Spent-tab banner (discounts saved / deposits paid / taxes
   * paid): what the figure is, how it is calculated, the previous months.
   */
  BudgetSpendingExtras: { kind: 'discounts' | 'deposits' | 'taxes' };
  // A single wish (long-term dream) with its chat/feed of notes, photos, links.
  WishDetail: { wishId: string };
  // Savings — income / spending / registered / recurring / AI import flows.
  SavingsEntryForm: { mode: 'income' | 'spending'; entryId?: string };
  SavingsGoalForm: { goalId?: string } | undefined;
  SavingsRegistered: undefined;
  // `focusItemId` auto-opens that payment's full edit form (or its loan detail
  // sheet first, for loan-tracked payments) on mount — the same behavior as
  // tapping the row directly in this screen's own list.
  SavingsRecurringPayments: { focusItemId?: string } | undefined;
  SavingsImport: { scope?: 'all' | 'income' | 'spending' | 'recurring' | 'history' } | undefined;
  // Pension tab — registered-statement AI import (create accounts + contributions).
  PensionImport: undefined;
  // Previous-years history grid + year-over-year comparison.
  SavingsYearHistory: { year?: number } | undefined;
  SavingsCompareYears: { years?: number[] } | undefined;
  // Bills / Utilities used to be mirrored here so the Budget "Bills" tab could
  // push utilities screens inside the Budget stack. Utilities is now a
  // House-only feature module (`@features/utilities`) and Budget no longer
  // mounts or routes to any of it — see `@features/utilities/gate`.
  /** House → Budget Soft Transfer import (stub until packages ship). */
  SoftTransferImport: undefined;
  /** Active Soft Transfer consents (House ↔ Budget). */
  DataSharing: undefined;
  /** Export budget.summary to Symply House. */
  SoftTransferExport: undefined;
  /**
   * The shared preference screens, mounted HERE as well as in the Settings
   * stack.
   *
   * Full Budget's settings hub is this stack's `BudgetSettings`, not the More
   * tab — More kept only the tabs that did not fit on the bottom bar. Pushing
   * these into the Settings stack instead would work, but "back" would land on
   * an empty More screen in another tab rather than on the Settings screen the
   * member opened them from. Same components either way (they take no
   * `navigation` prop for exactly this reason), so there is no fork to drift.
   */
  Appearance: undefined;
  Currency: undefined;
  Region: undefined;
  NotificationSettings: undefined;
};

// Gardening — independent stack for yard/garden site plans. Does NOT reuse floor plans.
export type GardeningStackParamList = {
  GardeningMain: { householdId?: string } | undefined;
  GardenPlanAddress: { initialAddressLine1?: string } | undefined;
  GardenPlanBoundaryConfirm: { draftId: string };
  /**
   * Draw the yard on a satellite map — lot line, then areas, then features.
   * The only creation path a local-first household has: it needs no upload,
   * because a map-drawn plan has no bytes.
   */
  GardenPlanMapWizard:
    | { defaultPlanType?: GardenPlanType; label?: string | null }
    | undefined;
  GardenPlanUpload: { defaultPlanType?: GardenPlanType } | undefined;
  GardenPlanViewer: { gardenPlanId: string };
  GardenPlanObjectEditor: {
    gardenPlanId: string;
    preferSatellite?: boolean;
    initialCamera?: {
      center: { latitude: number; longitude: number };
      altitude?: number;
      heading?: number;
      pitch?: number;
    };
  };
  GardenPlanMarkerPlacement: {
    gardenPlanId: string;
    linkedEntityType: 'task';
    linkedEntityId: string;
  };
};

/**
 * Neighbours — the homes around this property.
 *
 * `NeighbourPickOnMap` is a screen rather than a mode of the edit form, and that
 * is the stack's one interesting decision. Dropping a pin needs the whole
 * viewport: a map inside a scrolling form fights the form for every gesture, and
 * a member trying to pan a 200pt map inside a `ScrollView` scrolls the page
 * instead about half the time. `SurfaceStudio` is in the tree for the same
 * reason, and its comment says so.
 *
 * The picker RETURNS its result rather than writing it, via `onPicked` params on
 * the destination: it is used from the add form, from the edit form and from the
 * import flow, and only the caller knows what to do with a coordinate.
 */
export type NeighboursStackParamList = {
  /** The map. The feature's front door, with a list toggle in the header. */
  NeighboursMap: { focusNeighbourId?: string } | undefined;
  /**
   * Add or edit one home.
   *
   * `neighbourId` absent = create. `latitude`/`longitude` present = the member
   * arrived from the map having already chosen where, which is the primary path
   * and the one the whole feature is designed around.
   */
  AddEditNeighbour: {
    neighbourId?: string;
    latitude?: number;
    longitude?: number;
    /** Pre-filled from a reverse geocode, so the member confirms rather than types. */
    prefill?: {
      label?: string;
      address_line1?: string | null;
      city?: string | null;
      state_province?: string | null;
      postal_code?: string | null;
      country?: string | null;
      formatted_address?: string | null;
      place_source?: 'map_tap' | 'geocoded' | 'manual' | 'contact_import';
      phone?: string | null;
      email?: string | null;
      deviceContactId?: string | null;
    };
  } | undefined;
  NeighbourDetail: { neighbourId: string };
  /**
   * Full-screen pin picker.
   *
   * `returnTo` names where the chosen point goes — `'add'` opens the create form
   * with it, `'edit'` re-opens the edit form for `neighbourId`. Encoded as a
   * param rather than a callback because a function cannot survive a deep link
   * or a state restore, and this screen is reachable from both.
   */
  NeighbourPickOnMap: {
    returnTo: 'add' | 'edit';
    neighbourId?: string;
    initialLatitude?: number;
    initialLongitude?: number;
  };
  Neighbourhoods: undefined;
  NeighbourImportContacts: undefined;
};

// Contractors Stack (Labor Hub - for detail screens)
export type ContractorsStackParamList = {
  // Labor Hub Dashboard (new main entry)
  LaborHubDashboard: undefined;

  // Contractors
  ContractorsList: undefined;
  ContractorDetail: { contractorId: string };
  AddEditContractor: { contractorId?: string; contractor?: object };
  AddVisit: { contractorId: string; visitId?: string; visit?: object };
  ContractorSearch: {
    problemTitle: string;
    problemDescription: string;
    systemCategory: string;
    sourceType: 'task' | 'task_draft';
    sourceId: string;
    // Enhanced metadata for better AI search
    contractorCategory?: string;
    severity?: 'critical' | 'major' | 'minor' | 'informational';
    urgencyScore?: string; // Passed as string in navigation params
    propertyAddress?: string;
    sourcePageNumbers?: string; // JSON stringified array
    sourceQuotes?: string; // JSON stringified array
    subtasks?: string; // JSON stringified array
  } | undefined;
  ContractorSearchResults: {
    searchResult: {
      contractors: Array<{
        name: string;
        company_name: string | null;
        specialty: string;
        rating: number;
        review_count: number;
        address: string;
        phone: string | null;
        email: string | null;
        website: string | null;
        google_maps_url: string;
        highlights: string[];
        reddit_mentions: string | null;
        ai_confidence: number;
      }>;
      search_summary: string;
      total_found: number;
      location_note: string | null;
    };
    problemTitle: string;
    problemDescription: string;
  };
  ComposeContractorEmail: {
    contractors: Array<{
      name: string;
      company_name: string | null;
      specialty: string;
      rating: number;
      review_count: number;
      address: string;
      phone: string | null;
      email: string | null;
      website: string | null;
      google_maps_url: string;
      highlights: string[];
      reddit_mentions: string | null;
      ai_confidence: number;
    }>;
    problemTitle: string;
    problemDescription: string;
  };

  // Appointments
  Appointments: undefined;
  AppointmentDetail: { appointmentId: string };
  AddEditAppointment: {
    appointmentId?: string;
    contractorId?: string;
    linkedReportId?: string;
    linkedTaskId?: string;
    linkedQuoteId?: string;
    linkedProjectId?: string;
  };

  // Quotes
  Quotes: undefined;
  QuoteDetail: { quoteId: string };
  RequestQuote: {
    contractorIds?: string[];
    linkedReportId?: string;
    linkedTaskId?: string;
    problemTitle?: string;
    problemDescription?: string;
  };
  QuoteComparison: { quoteIds: string[] };

  // Projects
  Projects: undefined;
  ProjectDetail: { projectId: string };
  AddEditProject: {
    projectId?: string;
    contractorId?: string;
    quoteId?: string;
  };
  ProjectMilestones: { projectId: string };
  ProjectPayments: { projectId: string };
  ProjectPhotos: { projectId: string };

  // Checklists & Visit Mode
  Checklists: undefined;
  ChecklistDetail: { checklistId: string };
  ChecklistEditor: {
    checklistId?: string;
    appointmentId?: string;
    templateId?: string;
  };
  ChecklistTemplates: undefined;
  VisitMode: {
    appointmentId: string;
    checklistId?: string;
  };
  AITechnicalInfo: {
    technicalTerm: string;
    checklistItemId?: string;
    context?: {
      visitPurpose?: string;
      contractorSpecialty?: string;
      relatedIssue?: string;
    };
  };

  // Messages
  Messages: undefined;
  Conversation: { contractorId: string; contractorName: string };

  // Ratings
  ContractorRatings: { contractorId: string };
};

// Task detail nested stack (detail → edit)
export type TaskDetailStackParamList = {
  TaskDetail: { taskId: string; householdId?: string };
  ScheduleTask: { taskId?: string; task?: object } | undefined;
};

// Tasks Stack
export type TasksStackParamList = {
  TasksMain: undefined;
  /** Nested detail/edit flow — use instead of flat TaskDetail + ScheduleTask for edits. */
  TaskDetailFlow: NavigatorScreenParams<TaskDetailStackParamList>;
  /** Standalone create/copy flows only (not opened from TaskDetail). */
  ScheduleTask: { taskId?: string; task?: object } | undefined;
  TaskTemplates: undefined;
  CopyFromExistingTasks: undefined;
  TaskDrafts: { reportId?: string; reportName?: string } | undefined;
  TaskDraftDetail: { draftId: string };
  MaintenanceSetup: { reportId?: string } | undefined;
  HomeFeatures: undefined;
  // Smart Task Assistant: "what can I do in N minutes?" planner
  TimeBudgetPlanner: undefined;
  // Quote management screens
  QuoteManagement: { taskId: string; taskType: 'maintenance' | 'action' };
  QuoteComparison: { taskId: string; quoteIds: string[] };
  ContractorSelection: { taskId: string; category: string };
  ScheduleWork: { taskId: string; quoteId: string; contractorId: string };
};

// Utilities Stack — defined by the feature module (House-only, self-contained).
// Re-exported here so existing `@navigation/types` consumers keep resolving it.
export type { UtilitiesStackParamList };

// Home Projects Stack (Settings-adjacent / expo-router host)
export type HomeProjectsStackParamList = {
  HomeProjectsList: undefined;
  CreateHomeProject: { spaceId?: string } | undefined;
  HomeProjectHub: { projectId: string };
  /**
   * The per-surface finish planner — room shape, walls/floor/ceiling, sub-areas
   * and materials. A full screen rather than a hub section because it owns a
   * drag gesture and a canvas, both of which fight a scrolling parent.
   */
  SurfaceStudio: { projectId: string };
  /**
   * One material, in full.
   *
   * A link import fills in a dozen fields — price, what one box covers, the
   * size, the sku, the brand, the spec table, the photo — and the card shows
   * two of them. Everything else was extracted and then unreachable, and the
   * only editor was three inputs in a list row. This is where the rest lives.
   */
  MaterialDetail: { projectId: string; selectionId: string };
  /**
   * Describe-to-draft. Its own screen rather than a step on
   * `CreateHomeProject` because it hands work to a queue and waits, which the
   * template wizard's synchronous step counter has no shape for.
   */
  SmartProject: { spaceId?: string } | undefined;
  /**
   * The project's (or one material's) conversation, hosted INSIDE this stack.
   *
   * These are the shared chat screens from `@features/chat`, registered here as
   * well as on the chat tab. Routing to the tab instead would have been fewer
   * lines and the wrong behaviour: a member who opens the chat from a material
   * to ask "is this enough tile" expects Back to return them to that material,
   * not to leave them in a different tab with the project two taps away.
   *
   * Same param shapes as `ChatStackParamList` — the screens read them by name,
   * so the two hosts must not drift.
   */
  ChatRoom: { roomId: string; roomName: string; aiEnabled?: boolean };
  ChatRoomSettings: { roomId: string; roomName: string; canManage: boolean };
};

// Settings Stack
export type SettingsStackParamList = {
  SettingsMain: undefined;
  /**
   * House's settings hub — everything the More tab used to carry.
   *
   * House's More tab is the overflow-tabs hub now (tabs that did not fit the
   * bar, Customization, Insights), the same shape full Budget's took when its
   * settings moved behind the header gear. This is where the rest went:
   * preferences, units, the AI surfaces, notifications and data sharing.
   *
   * Reached from the gear on every House tab header and from Profile's gear,
   * both of which open the `/house-settings` root route rather than pushing
   * into this stack — a gear on the Garden tab cannot navigate into a stack
   * hosted by the More tab, and switching tabs to show a settings screen loses
   * the member's place. That route mounts this navigator with `HouseSettings`
   * as its initial route, so every row below can still `navigate()` normally.
   */
  HouseSettings: undefined;
  // `editHouseholdId` auto-opens the edit sheet for that property (used by the
  // "Edit details" action on PropertyDetail).
  HouseholdManagement: { editHouseholdId?: string } | undefined;
  HouseholdMembers: { householdId: string };
  /**
   * Budget only. The local-first enrolment screen, registered here as well as
   * in the Budget stack so "Manage members & invites" opens it in place — with
   * a back button that returns to My Households — instead of throwing the
   * member into another tab. `HouseholdMembers` is the server-side model
   * (email invitations, `/join/<token>` links, server roles) and is House's;
   * Budget's members ARE enrolled devices, and this is where they come from.
   *
   * Its three pushed children are registered here for the same reason: a hub
   * whose rows can only be followed from one of the two stacks it is mounted in
   * is a hub with dead rows in the other.
   */
  BudgetInvite: undefined;
  BudgetInviteCreate: undefined;
  BudgetJoin: { code?: string; secret?: string } | undefined;
  BudgetHouseholds: undefined;
  // One household's own page — omit `householdId` and it is the create form.
  // See the Budget stack's copy of this route.
  BudgetHouseholdEdit: { householdId?: string } | undefined;
  // Tabbed detail for one property. `initialTab` optionally deep-links a tab.
  PropertyDetail: {
    householdId: string;
    initialTab?: 'overview' | 'tax' | 'assessment' | 'members';
  };
  Appearance: undefined;
  Currency: undefined;
  Region: undefined;
  Customization: undefined;
  WidgetCustomization: undefined;
  NavigationCustomization: undefined;
  AIHousekeeperSettings: undefined;
  AIInsightsDashboard: undefined;
  NotificationSettings: undefined;
  CalendarSync: undefined;
  TermsOfService: undefined;
  PrivacyPolicy: undefined;
  FloorPlansMain: { householdId?: string } | undefined;
  FloorPlanUpload: undefined;
  FloorPlanViewer: {
    floorPlanId: string;
    // When set, FloorPlanViewer skips its zones list and jumps straight to the
    // interactive map view. 'floor' / 'detached' focus a specific zone (using
    // initialZoneIndex into analysis.floors / analysis.detached_areas), while
    // 'full' opens the entire floor plan without a zone filter.
    initialZoneType?: 'floor' | 'detached' | 'full';
    initialZoneIndex?: number;
  };
  FloorPlanPicker: {
    linkedEntityType: 'task';
    linkedEntityId: string;
  };
  FloorPlanMarkerPlacement: {
    floorPlanId: string;
    linkedEntityType: 'task';
    linkedEntityId: string;
  };
  FloorPlanAreaEdit: {
    floorPlanId: string;
    // Identifies the area being edited. Omit for "add new" mode.
    areaKind?: 'floor' | 'detached';
    areaIndex?: number;
  };
  SpacesManagement: { householdId?: string } | undefined;
  SpaceDetail: { spaceId: string; householdId: string };
  /**
   * One appliance, its documents, and the H6 attachment field that files them.
   *
   * **Both params are optional, and each absence means something.** No
   * `applianceId` is ADD mode — the screen renders a short create form and
   * switches itself to detail mode once the row exists, because an attachment
   * cannot be filed against an appliance that has not been saved. No
   * `householdId` means "the active property", which is what the Appliances
   * list itself passes when it is already showing one home's appliances; a
   * caller that knows the property states it, so a device that switched
   * mid-navigation cannot read one home's appliance out of another's.
   *
   * The whole route is therefore `| undefined`, which is also what lets the
   * settings tab's URL bridge open it with no params at all.
   */
  ApplianceDetail: { applianceId?: string; householdId?: string } | undefined;
  // Aihousekeeper (plan §H8)
  AihousekeeperSettings: undefined;
  AihousekeeperConnectedAccounts: undefined;
  /** Soft Transfer hub (House ↔ Budget / Health / Language). */
  SoftTransferConnect: undefined;
  SoftTransferFlow: {
    preset?:
      | 'house-to-budget'
      | 'budget-to-house'
      | 'house-to-health'
      | 'health-to-house'
      | 'house-to-language'
      | 'language-to-house';
    title?: string;
    fixedPackageId?:
      | 'profile.core.v1'
      | 'house.property.v1'
      | 'budget.summary.v1'
      | 'profile.core.health.v1'
      | 'health.summary.v1'
      | 'profile.core.language.v1'
      | 'language.summary.v1'
      | 'home_project_cost_summary.v1';
  };
  DataSharing: undefined;
  /**
   * House V2 local-first surface (plan §0.1, the "H3.5 surface pass").
   *
   * The engine behind these has been deployed and green since H4/H6/H9, but
   * every screen was unreachable: nothing in `src/` or `app/` referenced
   * `src/screens/house-v2/`, so a member could not invite a partner, back up a
   * property or see why a change had been replaced. These six entries are the
   * doorway.
   *
   * They take no params — each screen reads the active property from the engine
   * and draws its own `ScreenHeader`, which is also why none of them needs
   * `options` in the navigator — with one exception.
   *
   * `HouseJoin` carries the code and secret of a TAPPED INVITE LINK, handed over
   * by the hub. Route params are not where a secret belongs (they land in
   * navigation state, and in anything that logs a route), which is why the link
   * itself is parked in `inviteLinkStore` on the way in and only handed across
   * this one hop, in memory, at the moment the Join screen is opened for it.
   * Nothing is claimed by the navigation: the confirmation on the other side is
   * what enrols.
   */
  HouseDeviceSync: undefined;
  HouseInvite: undefined;
  HouseInviteCreate: undefined;
  HouseJoin:
    | { code?: string; secret?: string; fromOnboarding?: boolean }
    | undefined;
  HouseProperties: undefined;
  HouseDevices: undefined;
  HouseBackup: undefined;
};

// Auth Stack
export type AuthStackParamList = {
  Login: { redirectTo?: string; inviteToken?: string } | undefined;
  Register: { redirectTo?: string; inviteToken?: string } | undefined;
  ForgotPassword: undefined;
  ResetPassword: { token: string };
  VerifyEmail: { token: string };
};

// Onboarding Stack
export type OnboardingStackParamList = {
  Welcome: undefined;
  // Where to go once the member has answered (or skipped) the permission
  // ask — 'complete' finishes onboarding outright (child brands, Language);
  // House continues into whichever household step Welcome had already
  // decided on before the detour. Symply Health reaches this screen LAST —
  // after its own five-step goals mini-flow — and routes on into
  // HealthKitPermission before `onDone` is finally resolved.
  EssentialPermissions: { onDone: 'CreateHousehold' | 'JoinHousehold' | 'complete' };
  // Reached only after `EssentialPermissions`, on the Health brand — the true
  // last step of onboarding there. Resolves `onDone` directly.
  HealthKitPermission: { onDone: 'CreateHousehold' | 'JoinHousehold' | 'complete' };
  // Symply Health's goals setup — five back/forward-navigable steps reached
  // straight from `ChildWelcomeScreen` on the Health brand, BEFORE
  // notifications/Apple Health rather than after. Every step saves through
  // the SAME storage modules the in-app Goals screen uses (so the targets are
  // real server writes, not onboarding-only drafts) and every step is
  // skippable: `HealthGoalsBiometrics` (the last one) hands `onDone` on to
  // `EssentialPermissions` rather than resolving it itself.
  HealthGoalsNutrition: { onDone: 'CreateHousehold' | 'JoinHousehold' | 'complete' };
  HealthGoalsWeight: { onDone: 'CreateHousehold' | 'JoinHousehold' | 'complete' };
  HealthGoalsActivity: { onDone: 'CreateHousehold' | 'JoinHousehold' | 'complete' };
  HealthGoalsWater: { onDone: 'CreateHousehold' | 'JoinHousehold' | 'complete' };
  HealthGoalsBiometrics: { onDone: 'CreateHousehold' | 'JoinHousehold' | 'complete' };
  CreateHousehold: undefined;
  JoinHousehold: undefined;
  /**
   * The local-first join screen, reachable DURING onboarding as well as from
   * Settings.
   *
   * It was registered only on the settings stack, which meant a member holding
   * an invite on a fresh install had nowhere to take it: "Set Up Your Home"
   * offered Create Home and nothing else, so the only way to reach the scanner
   * was to first create a home they did not want and then dig through Settings.
   * `HouseInviteQrSheet` already told the owner their code could be scanned
   * ("the invitee's Symply House can scan it"), which was true everywhere
   * except the one screen where a new member actually starts.
   *
   * `fromOnboarding` is what distinguishes the two entries. From Settings the
   * screen goes back to the hub when it is done; from here there is no hub yet,
   * so a successful join has to finish onboarding instead.
   */
  HouseJoin:
    | { code?: string; secret?: string; fromOnboarding?: boolean }
    | undefined;
  SpaceSetup: undefined;
  /**
   * The AI-access ask, and the step that plans the two after it.
   *
   * `UploadReport` and `FloorPlan` both exist to feed a model, so a member with
   * no AI access is never routed through them: `AIProviderScreen` records the
   * answer (`@features/house/onboarding/aiSteps`) and `SpaceSetup` →
   * `GarbageSetup` → finish becomes the whole remaining flow. Entitled members
   * — Pro, or a key already connected — are forwarded on sight and never see
   * this screen at all.
   */
  AIProvider: undefined;
  UploadReport: undefined;
  GarbageSetup: undefined;
  FloorPlan: undefined;
  LanguageOnboarding: undefined;
  // Symply Kaizen's required "build your system" setup — reached only after
  // `EssentialPermissions`, the true last stretch of onboarding there.
  // `KaizenSystemsSetup` requires picking at least one life system (Continue
  // is disabled at zero); `KaizenSystemConfig` then loops once per selected
  // system (`navigation.push`, not `navigate`, so each is its own back-stack
  // entry); `KaizenCareerSetup` is reached only if Career was selected and is
  // always the true final screen, finishing onboarding itself.
  KaizenSystemsSetup: undefined;
  KaizenSystemConfig: { system: LifeSystem };
  KaizenCareerSetup: undefined;
};

// Screen Props Types
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, T>,
    RootStackScreenProps<keyof RootStackParamList>
  >;

/** Legacy alias — floor plan screens only live in the Settings stack now. */
export type FloorPlansSharedStack = SettingsStackParamList;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<AuthStackParamList, T>,
    RootStackScreenProps<keyof RootStackParamList>
  >;

export type OnboardingStackScreenProps<T extends keyof OnboardingStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<OnboardingStackParamList, T>,
    RootStackScreenProps<keyof RootStackParamList>
  >;

export type UtilitiesStackScreenProps<T extends keyof UtilitiesStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<UtilitiesStackParamList, T>,
    MainTabScreenProps<'Utilities'>
  >;

export type SettingsStackScreenProps<T extends keyof SettingsStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<SettingsStackParamList, T>,
    MainTabScreenProps<'Settings'>
  >;

export type TasksStackScreenProps<T extends keyof TasksStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<TasksStackParamList, T>,
    MainTabScreenProps<'Tasks'>
  >;

export type TaskDetailStackScreenProps<T extends keyof TaskDetailStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<TaskDetailStackParamList, T>,
    TasksStackScreenProps<'TaskDetailFlow'>
  >;

export type BudgetStackScreenProps<T extends keyof BudgetStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<BudgetStackParamList, T>,
    MainTabScreenProps<'Budget'>
  >;

export type ReportsStackScreenProps<T extends keyof ReportsStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<ReportsStackParamList, T>,
    MainTabScreenProps<'Reports'>
  >;

export type GarbageStackScreenProps<T extends keyof GarbageStackParamList> =
  NativeStackScreenProps<GarbageStackParamList, T>;

export type ContractorsStackScreenProps<T extends keyof ContractorsStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<ContractorsStackParamList, T>,
    MainTabScreenProps<'Contractors'>
  >;

// NOTE: expo-router owns the global `ReactNavigation.RootParamList` augmentation
// (typed via the app/ route tree). The app must NOT also augment it — doing so
// duplicated the identifier (TS2300) and broke `navigate()` typing app-wide.
