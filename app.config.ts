import type { ConfigContext, ExpoConfig } from 'expo/config';

// CJS brand resolver — Expo config cannot import TypeScript brand packs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getActiveBrandConfig } = require('./brands/resolve.cjs') as typeof import('./brands');

function googleReversedScheme(iosClientId: string): string | null {
  const prefix = iosClientId.replace(/\.apps\.googleusercontent\.com$/i, '');
  if (!prefix || prefix === iosClientId) return null;
  return `com.googleusercontent.apps.${prefix}`;
}

type UrlType = { CFBundleURLSchemes?: string[] };

/**
 * Dynamic Expo config driven by APP_BRAND / EXPO_PUBLIC_APP_BRAND.
 * Static defaults live in app.json; this layer overrides identity fields.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const brand = getActiveBrandConfig();
  const product = brand.permissionProductName;
  const googleScheme = googleReversedScheme(
    brand.integrations.googleAuth.iosClientId,
  );

  const urlTypes: UrlType[] = Array.isArray(
    config.ios?.infoPlist?.CFBundleURLTypes,
  )
    ? [...(config.ios!.infoPlist!.CFBundleURLTypes as UrlType[])]
    : [];

  if (googleScheme) {
    const already = urlTypes.some(t =>
      (t.CFBundleURLSchemes ?? []).includes(googleScheme),
    );
    if (!already) {
      urlTypes.push({ CFBundleURLSchemes: [googleScheme] });
    }
  }

  const hasBrandScheme = urlTypes.some(t =>
    (t.CFBundleURLSchemes ?? []).includes(brand.scheme),
  );
  if (!hasBrandScheme) {
    urlTypes.push({ CFBundleURLSchemes: [brand.scheme] });
  }

  const iosBuildNumber = parseInt(String(brand.iosBuildNumber ?? config.ios?.buildNumber ?? '23'), 10);

  return {
    ...config,
    name: brand.displayName,
    slug: brand.slug,
    scheme: brand.scheme,
    version: brand.iosVersion ?? config.version ?? '1.0.0',
    icon: brand.assets.appIcon,
    ios: {
      ...config.ios,
      bundleIdentifier: brand.iosBundleId,
      buildNumber: String(iosBuildNumber),
      // iOS 18+ light/dark app-icon appearance variants when the brand ships a
      // dark master; otherwise fall back to the single opaque icon. Android and
      // notifications keep the top-level `icon` (appIcon).
      icon: brand.assets.appIconDark
        ? { light: brand.assets.appIcon, dark: brand.assets.appIconDark }
        : brand.assets.appIcon,
      infoPlist: {
        ...config.ios?.infoPlist,
        // Brand-neutral: this plugin set is shared by every brand's build
        // (the `plugins` map below runs for all of them, unfiltered by
        // brand), and House's "Aihousekeeper" voice mode is not a feature
        // every brand ships — naming it here previously meant e.g. a Symply
        // Health build asked for microphone access "to talk to Aihousekeeper".
        NSMicrophoneUsageDescription: `Allow ${product} to access your microphone.`,
        // Required for Face ID; missing this crashes Face ID prompts on device.
        NSFaceIDUsageDescription: `Allow ${product} to use Face ID for quick and secure sign-in.`,
        // ITMS-90683. Apple scans the BINARY for API references, so a purpose
        // string is required even when the app never calls the API itself —
        // linked SDKs are enough to trigger it. Both of these are declared by
        // config plugins (`expo-contacts`), but plugins only inject into
        // Info.plist on the PREBUILD path, and release archives build the
        // COMMITTED ios/ project — so the keys never reached the binary.
        // Four TestFlight uploads (budget 69, house 36/37) were silently
        // discarded by Apple for exactly this on 2026-08-30..09-02: altool
        // reported UPLOAD SUCCEEDED, the build never appeared in App Store
        // Connect, and the only notice was an email. Keep these in sync with
        // ios/SymplyEcosystem/Info.plist, which is what actually ships.
        NSContactsUsageDescription: `Allow ${product} to access your contacts so you can add them and save people back to your address book.`,
        NSMotionUsageDescription: `Allow ${product} to access motion and fitness activity.`,
        // Expose the app's Documents folder in the Files app ("On My iPhone →
        // <App>"), so encrypted backups saved on-device can be found, copied to
        // iCloud Drive, or AirDropped without going through the app. Both keys
        // are needed: UIFileSharingEnabled publishes the folder, and
        // LSSupportsOpeningDocumentsInPlace stops iOS handing back a temporary
        // copy when a backup is opened from Files.
        UIFileSharingEnabled: true,
        LSSupportsOpeningDocumentsInPlace: true,
        CFBundleURLTypes: urlTypes.length
          ? urlTypes
          : config.ios?.infoPlist?.CFBundleURLTypes,
        // Sibling Symply app schemes so Linking.canOpenURL can detect which of
        // the other apps are installed (the "Symply apps" grid). iOS returns
        // false for any scheme not listed here. Keep in sync with each brand's
        // `scheme` in brands/*/brand.cjs. (Android's equivalent — the manifest
        // <queries> package list — is added by ./plugins/withSymplyAppQueries.js.)
        LSApplicationQueriesSchemes: Array.from(
          new Set([
            ...((config.ios?.infoPlist?.LSApplicationQueriesSchemes as string[] | undefined) ?? []),
            brand.scheme,
          ]),
        ),
      },
    },
    android: {
      ...config.android,
      package: brand.androidPackage,
      // Sync with iOS buildNumber; EAS overrides via EAS_BUILD_ANDROID_VERSION_CODE (BUILD-7).
      versionCode: process.env.EAS_BUILD_ANDROID_VERSION_CODE
        ? parseInt(process.env.EAS_BUILD_ANDROID_VERSION_CODE, 10)
        : iosBuildNumber,
      // Per-brand FCM config (brands/<id>/google-services.json), provisioned via
      // scripts/provision/firebase-android.sh. Overrides the static app.json path
      // so each brand build gets its own Firebase Android app; prebuild copies it in.
      googleServicesFile: `./brands/${brand.id}/google-services.json`,
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        foregroundImage: brand.assets.appIcon,
        backgroundColor:
          config.android?.adaptiveIcon?.backgroundColor ?? '#FFFFFF',
      },
    },
    plugins: (config.plugins ?? []).map((plugin): NonNullable<ExpoConfig['plugins']>[number] => {
      if (Array.isArray(plugin) && plugin[0] === 'expo-notifications') {
        return [
          'expo-notifications',
          {
            ...(typeof plugin[1] === 'object' && plugin[1] ? plugin[1] : {}),
            icon: brand.assets.appIcon,
          },
        ];
      }
      if (
        Array.isArray(plugin) &&
        plugin[0] === '@config-plugins/react-native-webrtc'
      ) {
        return [
          '@config-plugins/react-native-webrtc',
          {
            cameraPermission: `${product} does not use the camera for voice mode.`,
            // Brand-neutral for the same reason as `NSMicrophoneUsageDescription`
            // above — this plugin is shared across all five brands' builds.
            microphonePermission: `Allow ${product} to access your microphone.`,
          },
        ];
      }
      if (Array.isArray(plugin) && plugin[0] === 'expo-speech-recognition') {
        return [
          'expo-speech-recognition',
          {
            microphonePermission: `Allow ${product} to access your microphone`,
            speechRecognitionPermission: `Allow ${product} to convert your speech into text when you dictate a task`,
          },
        ];
      }
      if (
        Array.isArray(plugin) &&
        plugin[0] === 'expo-local-authentication'
      ) {
        return [
          'expo-local-authentication',
          {
            faceIDPermission: `Allow ${product} to use Face ID for quick and secure sign-in.`,
          },
        ];
      }
      // Sentry source-map / debug-symbol upload target. Points at the brand's own
      // Sentry project when it declares `integrations.sentry.project`, so uploaded
      // symbols land in the same project its runtime DSN reports crashes to
      // (see src/services/monitoring.ts). Falls back to the shared project.
      if (Array.isArray(plugin) && plugin[0] === '@sentry/react-native/expo') {
        const sentry = brand.integrations.sentry;
        return [
          '@sentry/react-native/expo',
          {
            ...(typeof plugin[1] === 'object' && plugin[1] ? plugin[1] : {}),
            url: 'https://sentry.io/',
            project: sentry?.project ?? 'symply-budget',
            organization: sentry?.org ?? 'andrei-tekhtelev',
          },
        ];
      }
      return plugin;
    }).concat([
      'expo-audio',
      'expo-video',
      'expo-sqlite',
      // Neighbours. Both purpose strings are brand-neutral for the same reason
      // `NSMicrophoneUsageDescription` above is: this `plugins` list runs for
      // every brand's build, unfiltered, so naming a House-only feature here
      // would make a Symply Health build ask for contacts "to add a neighbour".
      //
      // Location is WHEN-IN-USE only, and only to centre the map on the home the
      // member is already looking at. Nothing in this feature tracks a position,
      // stores one, or asks in the background — `@services/geocoding` uses the
      // permission for a one-shot fix and otherwise geocodes the household's own
      // typed address, which needs no permission at all.
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: `Allow ${product} to use your location while you are using the app.`,
          locationWhenInUsePermission: `Allow ${product} to use your location to centre the map on where you are.`,
          isIosBackgroundLocationEnabled: false,
          isAndroidBackgroundLocationEnabled: false,
        },
      ],
      // Read AND write: the member imports a neighbour from their address book
      // and exports one back to it. The write half is why the second string is
      // here — iOS refuses a save with no `NSContactsUsageDescription`, and the
      // failure is silent.
      [
        'expo-contacts',
        {
          contactsPermission: `Allow ${product} to access your contacts so you can add them and save people back to your address book.`,
        },
      ],
      './modules/roomplan/app.plugin.js',
      // Adds the HealthKit entitlement + read purpose string on the PREBUILD path,
      // and only for the health build in the former multi-brand tree. The committed ios/ tree (what EAS and
      // Xcode actually build) carries the same two facts via Brand.xcconfig and the
      // SymplyEcosystem-Health*.entitlements pair.
      './plugins/withSymplyAppQueries.js',
    ] as unknown as NonNullable<ExpoConfig['plugins']>),
    extra: {
      ...config.extra,
      // When this bundle was built. Expo resolves this config at bundle time —
      // the `[Expo] Configure project` build phase regenerates
      // `EXConstants.bundle/app.config` on every native build, `eas update`
      // freezes it into the published manifest, and `expo start` stamps the dev
      // session — so `Constants.expoConfig.extra.buildTime` always describes the
      // JS that is actually running, not the last archive. Surfaced in the
      // settings footer (`@components/common/AppVersionFooter`) so a tester can
      // tell a stale install from a missing fix without a console.
      buildTime: new Date().toISOString(),
      brandId: brand.id,
      appBrand: brand.id,
      brandIos: brand.ios,
      brandFeatures: brand.features,
      eas: {
        ...config.extra?.eas,
        // Per-brand EAS project. Empty easProjectId (e.g. Language pre-init) ⇒
        // undefined so `eas init` can create a fresh project for that brand.
        projectId: brand.easProjectId || undefined,
        build: {
          ...(typeof config.extra?.eas?.build === 'object'
            ? config.extra.eas.build
            : {}),
          experimental: {
            ...(typeof config.extra?.eas?.build?.experimental === 'object'
              ? config.extra.eas.build.experimental
              : {}),
            ios: {
              ...(typeof config.extra?.eas?.build?.experimental?.ios ===
              'object'
                ? config.extra.eas.build.experimental.ios
                : {}),
              appExtensions: [
                {
                  targetName: 'SymplyEcosystemWidgetExtension',
                  bundleIdentifier: brand.ios.widgetBundleId,
                },
                {
                  targetName: 'SymplyEcosystemWatchApp Watch App',
                  bundleIdentifier: brand.ios.watchBundleId,
                },
              ],
            },
          },
        },
      },
    },
    updates: {
      ...(typeof config.updates === 'object' ? config.updates : {}),
      url:
        (typeof config.updates === 'object' && config.updates?.url) ||
        (brand.easProjectId ? `https://u.expo.dev/${brand.easProjectId}` : undefined),
      fallbackToCacheTimeout: 0,
      // Manual (non-EAS) archives never get a channel injected, so the launch
      // update check 400s ("expo-channel-name Required"). Set the release channel
      // ourselves; EAS builds still override this from the build profile.
      requestHeaders: {
        ...(typeof config.updates === 'object'
          ? config.updates?.requestHeaders
          : {}),
        'expo-channel-name': `${brand.id}-production`,
      },
    },
    // Bare workflow: EAS Update requires an explicit string (policy objects are unsupported).
    runtimeVersion: String(config.version ?? '1.0.0'),
  };
};
