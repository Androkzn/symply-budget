/**
 * Simple Budget brand pack — config-time CJS source.
 * Keep in sync with brand.ts
 */
module.exports = {
  id: 'symply-budget',
  displayName: 'Symply Budget',
  slug: 'symply-budget',
  scheme: 'simplebudget',
  iosBundleId: 'com.symply.budget',
  // Per-app version identity (drives native MARKETING_VERSION / CURRENT_PROJECT_VERSION
  // via ios/Brand.xcconfig). Each brand owns its OWN build-number line — bump
  // iosBuildNumber before every TestFlight/App Store archive. See scripts/ios/write-brand-xcconfig.cjs.
  iosVersion: '1.0.1',
  iosBuildNumber: 85,
  androidPackage: 'com.symply.budget',
  easProjectId: '7e6f549f-c8ed-4018-8f20-fc578b812c20',
  permissionProductName: 'Symply Budget',
  colors: {
    primary: '#2BB673',
    primaryDark: '#239A61',
    primaryLight: '#5FD49A',
    primaryOnDark: '#239A61',
    primaryDarkOnDark: '#1B7A4C',
  },
  // Customizable-tabs pool (see `customizableTabs` below). Order here is the
  // default order; entries without `defaultHidden` are pinned to the bottom bar
  // (capped at maxVisibleTabs), the rest live in the "More" hub until the user
  // adds them. `index` = Budget Dashboard content; `settings` = More.
  tabs: [
    { route: 'index', icon: 'grid', brandIcon: 'home', label: 'Home', sfSymbol: 'house', locked: true },
    { route: 'planning', icon: 'clipboard', brandIcon: 'planned', label: 'Planning', sfSymbol: 'list.bullet.rectangle' },
    { route: 'spending', icon: 'card', brandIcon: 'spendings', label: 'Spending', sfSymbol: 'creditcard' },
    { route: 'savings', icon: 'trending-up', brandIcon: 'savings', label: 'Savings', sfSymbol: 'chart.line.uptrend.xyaxis' },
    { route: 'pension', icon: 'shield-checkmark', brandIcon: 'registered-account', label: 'Pension', sfSymbol: 'building.columns', defaultHidden: true },
    { route: 'wishes', icon: 'gift', brandIcon: 'goal', label: 'Wishes', sfSymbol: 'star', defaultHidden: true },
    { route: 'mortgage', icon: 'home', brandIcon: 'housing', label: 'Mortgage', sfSymbol: 'house', defaultHidden: true },
    { route: 'settings', icon: 'ellipsis-horizontal', brandIcon: 'more', label: 'More', sfSymbol: 'ellipsis', locked: true },
  ],
  featureTabs: [],
  customizableTabs: true,
  maxVisibleTabs: 5,
  assets: {
    appIcon: 'brands/symply-budget/src/assets/images/app-icon.png',
    appIconDark: 'brands/symply-budget/src/assets/images/app-icon-dark.png',
    splashLight: 'brands/symply-budget/src/assets/images/splash-light.png',
    splashDark: 'brands/symply-budget/src/assets/images/splash-dark.png',
    logoHorizontal: 'brands/symply-budget/src/assets/images/logo-horizontal.png',
    logoSplash: 'brands/symply-budget/src/assets/images/logo-splash.png',
  },
  integrations: {
    googleAuth: {
      iosClientId: '144228018802-pj9u6tp8uvh1k81l8d1ji0v2ccb33iq5.apps.googleusercontent.com',
      androidClientId: '144228018802-reptk64t883gv90j8otk9ruqaq9qectv.apps.googleusercontent.com',
      webClientId: '144228018802-hga4shft7puttamh36gfgr7aa5rrpchl.apps.googleusercontent.com',
    },
    googleDrive: {
      iosClientId: '144228018802-pj9u6tp8uvh1k81l8d1ji0v2ccb33iq5.apps.googleusercontent.com',
      androidClientId: '144228018802-reptk64t883gv90j8otk9ruqaq9qectv.apps.googleusercontent.com',
      webClientId: '144228018802-hga4shft7puttamh36gfgr7aa5rrpchl.apps.googleusercontent.com',
    },
    appleAuth: { enabled: true },
    // PostHog: shared ecosystem project 509073 (US Cloud). Analytics is brand-tagged,
    // so all apps segment by the `brand` property in one project. Free-plan project
    // limit prevents a per-app project — revisit if upgraded. Publishable key (safe).
    // See documents/engineering/analytics.md
    posthog: { apiKey: 'phc_uzGRfVexQuQwnU6NK5Kd5GoCnFUPi9SAvK2yitPjq5Hp' },
    // Sentry crash reporting: this brand's OWN project (publishable DSN — safe to
    // embed). Org andrei-tekhtelev. See documents/engineering/sentry.md
    sentry: {
      dsn: 'https://91d451c9d06cbadd3212b180deb78c07@o4506338522431488.ingest.us.sentry.io/4511730659360768',
      project: 'symply-budget',
    },
    revenueCat: {
      iosApiKey: 'appl_aWqACsWZaAVBgvaJadDMjZUTHvU',
      androidApiKey: 'goog_pABmQSTyLdkoUTEZHgrHsSuAoDl',
    },
  },
  ios: {
    widgetBundleId: 'com.symply.budget.widget',
    watchBundleId: 'com.symply.budget.watchkitapp',
    watchExtensionBundleId: 'com.symply.budget.watchkitapp.watchkitextension',
    appGroup: 'group.com.symply.budget',
    appleTeamId: 'B2ZY5M2YW2',
  },
  features: {
    budget: 'full',
    widget: true,
    watch: true,
    googleDrive: true,
  },
};
