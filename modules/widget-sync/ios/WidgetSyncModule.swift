import ExpoModulesCore
import WidgetKit

// App Group shared with the iOS app, the Apple Watch, and the Home Screen widget.
// Derived at runtime from THIS target's own bundle ID (which is brand-driven via
// Brand.xcconfig → $(SYMPLY_BUNDLE_ID)), so every brand resolves its own group with
// no per-brand source patching. Mirrors ios/Shared/Utilities/AppGroup.swift.
private let kAppGroup: String = {
  let bundleId = Bundle.main.bundleIdentifier ?? "com.symply.house"
  let base = bundleId
    .replacingOccurrences(of: ".watchkitapp.watchkitextension", with: "")
    .replacingOccurrences(of: ".watchkitapp", with: "")
    .replacingOccurrences(of: ".widget", with: "")
  return "group.\(base)"
}()

private func appGroupDefaults() -> UserDefaults? {
  UserDefaults(suiteName: kAppGroup)
}

private func reloadHomeWidget() {
  WidgetCenter.shared.reloadAllTimelines()
}

/// Expo native module that writes the widget's data into the shared App Group and
/// refreshes the Home Screen widget. This is the New-Architecture-safe path for
/// the app→widget (and app→Watch token) handoff: Expo modules are always exposed
/// under bridgeless, unlike the legacy `RCT_EXTERN_MODULE` WatchBridge, which can
/// resolve `null` on `NativeModules`.
public class WidgetSyncModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WidgetSync")

    // Auth context for widget/Watch — product at+jwt must NEVER enter App Group.
    // householdId + userId only; companion+jwt uses setCompanionAuth when minted.
    Function("setAuth") { (householdId: String, userId: String) in
      let defaults = appGroupDefaults()
      defaults?.removeObject(forKey: "auth_token")
      defaults?.set(householdId, forKey: "current_household_id")
      defaults?.set(userId, forKey: "user_id")
      reloadHomeWidget()
    }

    // House companion JWT only (typ=companion+jwt). Never product access tokens.
    Function("setCompanionAuth") { (token: String) in
      guard !token.isEmpty else { return }
      appGroupDefaults()?.set(token, forKey: "companion_token")
      reloadHomeWidget()
    }

    // Environment base URL (staging on dev builds, prod on release).
    Function("setApiBaseUrl") { (url: String) in
      guard !url.isEmpty else { return }
      appGroupDefaults()?.set(url, forKey: "api_base_url")
    }

    // Freshest Mira insight snapshot (raw insight JSON, stored as Data).
    Function("setHomeInsight") { (json: String) in
      guard !json.isEmpty else { return }
      let defaults = appGroupDefaults()
      defaults?.set(Data(json.utf8), forKey: "widget_home_insight")
      defaults?.set(Date(), forKey: "widget_updated_at")
      reloadHomeWidget()
    }

    // Latest task feed snapshot (raw JSON array, snake_case fields).
    Function("setTasks") { (json: String) in
      guard !json.isEmpty else { return }
      let defaults = appGroupDefaults()
      defaults?.set(Data(json.utf8), forKey: "widget_tasks")
      defaults?.set(Date(), forKey: "widget_updated_at")
      reloadHomeWidget()
    }

    // Generic per-brand widget snapshot (JSON stored as Data). Lets each app write
    // its own key — e.g. "widget_budget_summary", "widget_kaizen_today",
    // "widget_language_today", "widget_health_today" — read by that brand's widget.
    Function("setSnapshot") { (key: String, json: String) in
      guard !key.isEmpty, !json.isEmpty else { return }
      let defaults = appGroupDefaults()
      defaults?.set(Data(json.utf8), forKey: key)
      defaults?.set(Date(), forKey: "widget_updated_at")
      reloadHomeWidget()
    }

    // Wipe on logout (all brands' snapshot keys).
    //
    // This list must stay a superset of every key `setSnapshot` is called with
    // anywhere in the app, or household data survives sign-out on a home screen
    // or a paired watch. Guarded by BUDGET-WIDGET-008 / BUDGET-WATCH-007.
    Function("clear") {
      let defaults = appGroupDefaults()
      ["auth_token", "companion_token", "current_household_id", "user_id",
       "widget_home_insight", "widget_tasks", "widget_updated_at",
       "widget_budget_summary", "widget_kaizen_today",
       "widget_language_today", "widget_health_today",
       // Watch faces read their own `watch_*` keys — household-scoped, so they
       // must be wiped on logout alongside the widget snapshots. All four
       // brands' views read one of these.
       "watch_budget_today", "watch_kaizen_today",
       "watch_language_today", "watch_health_today"].forEach {
        defaults?.removeObject(forKey: $0)
      }
      reloadHomeWidget()
    }

    // Force a widget timeline refresh.
    Function("reload") {
      reloadHomeWidget()
    }
  }
}
