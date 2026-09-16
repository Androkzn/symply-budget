internal import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    // Initialize Apple Watch connectivity
    // TODO: Re-enable after adding WatchConnectivityService.swift to Xcode project target
    // #if os(iOS)
    // WatchConnectivityService.shared.activate()
    // #endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    let provider = RCTBundleURLProvider.sharedSettings()
    // The Expo prebuilt React core (RCT_USE_PREBUILT_RNCORE) is release-configured
    // (RCT_DEV=0), so its automatic localhost packager discovery is compiled out and
    // jsBundleURL returns nil on the simulator unless a packager location is set.
    // Default to localhost so `expo run:ios` connects to Metro without needing a
    // `-RCT_jsLocation` launch arg. An explicit RCT_jsLocation (e.g. a device's LAN
    // IP) still wins because jsLocation reads it from the argument domain first.
    // Parallel brand Metros: Kaizen=8081, Budget=8082, House=8083, Language=8084, Health=8085.
    // Always pin known brands (jsLocation can stick in UserDefaults from a
    // prior launch). Explicit -RCT_jsLocation launch arg still wins first.
    let bundleId = Bundle.main.bundleIdentifier ?? ""
    let hasLaunchOverride = ProcessInfo.processInfo.arguments.contains { $0.hasPrefix("-RCT_jsLocation") }
      || ProcessInfo.processInfo.environment["RCT_jsLocation"] != nil
    if !hasLaunchOverride {
      if bundleId.hasPrefix("com.symply.budget") {
        provider.jsLocation = "localhost:8082"
      } else if bundleId.hasPrefix("com.symply.house") {
        provider.jsLocation = "localhost:8083"
      } else if bundleId.hasPrefix("com.symply.kaizen") {
        provider.jsLocation = "localhost:8081"
      } else if bundleId.hasPrefix("com.symply.language") {
        provider.jsLocation = "localhost:8084"
      } else if bundleId.hasPrefix("com.symply.health") {
        provider.jsLocation = "localhost:8085"
      } else if provider.jsLocation == nil {
        provider.jsLocation = "localhost:8081"
      }
    }
    return provider.jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
