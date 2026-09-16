import { brand } from '@brand';
import type { BrandTabConfig, BrandTabRoute } from '@brand';

export type TabConfigEntry = BrandTabConfig;

/**
 * Every file under `app/(tabs)/` that must be registered with `<Tabs.Screen>`.
 * Visible chrome comes from `brand.tabs` (+ featureTabs); the rest stay
 * routable with `href: null` (More / deep links).
 */
export const ROUTABLE_TAB_SCREENS: ReadonlyArray<{
  route: BrandTabRoute;
  defaultTitle: string;
}> = [
  { route: 'index', defaultTitle: 'Home' },
  { route: 'mira', defaultTitle: 'Mira' },
  { route: 'gardening', defaultTitle: 'Garden' },
  { route: 'budget', defaultTitle: 'Budget' },
  { route: 'my-home', defaultTitle: 'My Home' },
  { route: 'projects', defaultTitle: 'Projects' },
  { route: 'spaces', defaultTitle: 'Spaces' },
  { route: 'tasks', defaultTitle: 'Tasks' },
  { route: 'contractors', defaultTitle: 'Pros' },
  { route: 'reports', defaultTitle: 'Reports' },
  { route: 'chat', defaultTitle: 'Chat' },
  { route: 'utilities', defaultTitle: 'Bills' },
  { route: 'settings', defaultTitle: 'More' },
  { route: 'notifications', defaultTitle: 'Alerts' },
  { route: 'profile', defaultTitle: 'Profile' },
  // Budget sections promoted to first-class (customizable) tabs.
  { route: 'planning', defaultTitle: 'Planning' },
  { route: 'spending', defaultTitle: 'Spending' },
  { route: 'savings', defaultTitle: 'Savings' },
  { route: 'pension', defaultTitle: 'Pension' },
  { route: 'bills', defaultTitle: 'Bills' },
  { route: 'wishes', defaultTitle: 'Wishes' },
  { route: 'mortgage', defaultTitle: 'Mortgage' },
  // Kaizen sections.
  { route: 'kaizen-assess', defaultTitle: 'Assess' },
  { route: 'kaizen-career', defaultTitle: 'Career' },
  { route: 'kaizen-learn', defaultTitle: 'Learn' },
  { route: 'kaizen-systems', defaultTitle: 'Systems' },
  // Language sections.
  { route: 'language-assessment', defaultTitle: 'Assessment' },
  { route: 'language-dialogue', defaultTitle: 'Dialogue' },
  { route: 'language-plan', defaultTitle: 'Plan' },
  { route: 'language-review', defaultTitle: 'Review' },
  // Health sections.
  { route: 'health-nutrition', defaultTitle: 'Nutrition' },
  { route: 'health-activity', defaultTitle: 'Activity' },
  { route: 'health-trends', defaultTitle: 'Trends' },
  { route: 'health-weight', defaultTitle: 'Weight' },
  { route: 'health-body', defaultTitle: 'Body' },
  { route: 'health-habits', defaultTitle: 'Habits' },
  { route: 'health-water', defaultTitle: 'Water' },
  { route: 'health-cycle', defaultTitle: "Women's Health" },
  { route: 'health-vitality', defaultTitle: "Men's Health" },
  { route: 'health-food', defaultTitle: 'Foods' },
  { route: 'health-recipes', defaultTitle: 'Recipes' },
  { route: 'health-fridge', defaultTitle: 'Fridge' },
  { route: 'health-exercises', defaultTitle: 'Workouts' },
  { route: 'health-injuries', defaultTitle: 'Injuries' },
  { route: 'health-goals', defaultTitle: 'Goals' },
  // Parity phase P3 — the AI surfaces. A pool entry that is not registered here
  // is a tab expo-router can never mount, which is the quietest way to ship a
  // screen nobody can open; `HEALTH-TAB-032` asserts the two lists agree.
  { route: 'health-coach', defaultTitle: 'Coach' },
  { route: 'health-scan', defaultTitle: 'Scan' },
  // The donor's "My Files" — stored photos, documents and body photos.
  { route: 'health-files', defaultTitle: 'Files' },
  // Settings sub-screens reached from "More". Registered so expo-router can
  // mount them; deliberately absent from `brand.tabs`, so `getTabScreenHref`
  // resolves them to null and they never appear on the bar or in the pool.
  { route: 'health-notifications', defaultTitle: 'Notifications' },
  { route: 'health-widget', defaultTitle: 'Widget' },
  // The donor's barcode scanner (parity P5) — pushed from Scan's quick-add,
  // never pinned to the bar; same href:null treatment as the two routes above.
  { route: 'health-barcode-scan', defaultTitle: 'Scan Barcode' },
];

/**
 * Builds the visible tab list for FloatingTabBar / SidebarTabBar.
 * Feature-gated tabs (e.g. Tasks) insert after their configured route.
 */
export function buildTabConfig(options: {
  showTasks: boolean;
}): TabConfigEntry[] {
  const tabs: TabConfigEntry[] = brand.tabs.map(t => ({ ...t }));

  for (const featureTab of brand.featureTabs ?? []) {
    if (featureTab.feature === 'smartTaskAssistant' && !options.showTasks) {
      continue;
    }
    const afterIndex = tabs.findIndex(t => t.route === featureTab.insertAfter);
    const entry: TabConfigEntry = {
      route: featureTab.route,
      icon: featureTab.icon,
      label: featureTab.label,
      labelKey: featureTab.labelKey,
      sfSymbol: featureTab.sfSymbol,
    };
    if (afterIndex >= 0) {
      tabs.splice(afterIndex + 1, 0, entry);
    } else {
      tabs.push(entry);
    }
  }

  return tabs;
}

export function isBrandTabRoute(route: string): route is BrandTabRoute {
  return (
    brand.tabs.some(t => t.route === route) ||
    (brand.featureTabs?.some(t => t.route === route) ?? false)
  );
}

/** First visible brand tab route — used as Tabs `initialRouteName`. */
export function getInitialTabRoute(): BrandTabRoute {
  const requested = brand.tabs[0]?.route;
  if (requested && ROUTABLE_TAB_SCREENS.some(s => s.route === requested)) {
    return requested;
  }
  return 'index';
}

/** Href for expo-router Tabs.Screen — null keeps the route but hides the bar item. */
export function getTabScreenHref(
  route: BrandTabRoute,
  options: { showTasks: boolean },
): string | null {
  const visible = buildTabConfig(options);
  if (!visible.some(t => t.route === route)) {
    return null;
  }
  if (route === 'index') return '/';
  return `/${route}`;
}

/** Title for a tab screen: brand label when visible, else default. */
export function getTabScreenTitle(
  route: BrandTabRoute,
  options: {
    showTasks: boolean;
    housekeeperName?: string;
  },
): string {
  const visible = buildTabConfig({ showTasks: options.showTasks });
  const entry = visible.find(t => t.route === route);
  if (entry?.labelKey === 'housekeeper' && options.housekeeperName) {
    return options.housekeeperName;
  }
  if (entry?.label) return entry.label;
  return (
    ROUTABLE_TAB_SCREENS.find(s => s.route === route)?.defaultTitle ?? route
  );
}

/** Ionicons name for a route from brand pack (visible) or sensible default. */
export function getTabScreenIcon(route: BrandTabRoute): string {
  const fromBrand =
    brand.tabs.find(t => t.route === route)?.icon ||
    brand.featureTabs?.find(t => t.route === route)?.icon;
  if (fromBrand) return fromBrand;

  const fallbacks: Partial<Record<BrandTabRoute, string>> = {
    gardening: 'leaf',
    'my-home': 'home',
    projects: 'construct',
    spaces: 'location',
    contractors: 'hammer',
    reports: 'document-text',
    utilities: 'receipt',
    notifications: 'notifications',
    profile: 'person',
    planning: 'clipboard',
    spending: 'card',
    savings: 'trending-up',
    pension: 'shield-checkmark',
    bills: 'receipt',
    wishes: 'gift',
    mortgage: 'home',
    'kaizen-assess': 'clipboard',
    'kaizen-career': 'briefcase',
    'kaizen-learn': 'book',
    'kaizen-systems': 'grid',
    'language-assessment': 'school',
    'language-dialogue': 'chatbubbles',
    'language-plan': 'map',
    'language-review': 'albums',
    'health-nutrition': 'nutrition',
    'health-activity': 'walk',
    'health-trends': 'trending-up',
    'health-weight': 'barbell',
    'health-body': 'body',
    'health-habits': 'leaf',
    'health-water': 'water',
    'health-cycle': 'calendar',
    'health-vitality': 'pulse',
    'health-food': 'search',
    'health-recipes': 'book',
    'health-fridge': 'basket',
    'health-exercises': 'barbell',
    'health-injuries': 'bandage',
    'health-goals': 'flag',
    'health-coach': 'sparkles',
    'health-scan': 'scan',
  };
  return fallbacks[route] ?? 'ellipse';
}

/**
 * Brand-kit icon name for a route — the new PNG icon system (`<Icon>` /
 * `BrandSymbol`). Prefers a per-brand override (`tab.brandIcon`) and falls back
 * to a semantic default shared across brands. Names not present in the active
 * brand's kit degrade to the Ionicons glyph via `hasBrandIcon` in the renderer.
 */
export function getTabScreenBrandIcon(route: BrandTabRoute): string | undefined {
  const fromBrand =
    brand.tabs.find(t => t.route === route)?.brandIcon ||
    brand.featureTabs?.find(t => t.route === route)?.brandIcon;
  if (fromBrand) return fromBrand;

  const defaults: Partial<Record<BrandTabRoute, string>> = {
    index: 'home',
    mira: 'ai-housekeeper',
    gardening: 'garden-plan',
    budget: 'budget-glance',
    'my-home': 'spaces',
    projects: 'construct',
    spaces: 'spaces',
    tasks: 'tasks',
    contractors: 'contractors',
    reports: 'reports',
    chat: 'chat',
    utilities: 'utilities',
    settings: 'more',
    notifications: 'reminders',
    profile: 'profile',
    planning: 'planned',
    spending: 'spendings',
    savings: 'savings',
    pension: 'registered-account',
    bills: 'bills',
    wishes: 'goal',
    mortgage: 'housing',
    'kaizen-assess': 'assess',
    'kaizen-career': 'career',
    'kaizen-learn': 'learn',
    'kaizen-systems': 'systems',
    'language-assessment': 'assessment',
    'language-dialogue': 'conversation',
    'language-plan': 'learning-plan',
    'language-review': 'review-due',
    'health-nutrition': 'nutrition-tab',
    'health-activity': 'activity-tab',
    'health-trends': 'trends-tab',
    'health-weight': 'weight',
    'health-body': 'body-measurements',
    'health-habits': 'streak',
    'health-water': 'hydration',
    'health-cycle': 'cycle',
    'health-vitality': 'recovery',
    'health-food': 'food-search',
    'health-recipes': 'recipe',
    'health-fridge': 'meals',
    'health-exercises': 'workout-library',
    'health-injuries': 'symptoms',
    'health-goals': 'goals',
    'health-coach': 'ai-coach',
    'health-scan': 'barcode',
  };
  return defaults[route];
}

/** SF Symbol name from brand pack when present (iOS / Native Tabs). */
export function getTabScreenSfSymbol(route: BrandTabRoute): string | undefined {
  return (
    brand.tabs.find(t => t.route === route)?.sfSymbol ||
    brand.featureTabs?.find(t => t.route === route)?.sfSymbol
  );
}
