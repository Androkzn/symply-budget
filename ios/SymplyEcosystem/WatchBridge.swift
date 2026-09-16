//
//  WatchBridge.swift
//  SymplyEcosystem
//
//  React Native bridge for Apple Watch synchronization
//

import Foundation
import React
import WatchConnectivity
import WidgetKit

@objc(WatchBridge)
class WatchBridge: RCTEventEmitter {

    /// Specify events that this module can emit
    override func supportedEvents() -> [String]! {
        return ["onWatchTaskCompleted", "onWatchSyncRequested"]
    }

    /// Require main queue setup for UI operations
    override static func requiresMainQueueSetup() -> Bool {
        return true
    }

    /// Don't require JavaScript initialization
    override class func moduleName() -> String! {
        return "WatchBridge"
    }

    /// Synchronous constants surfaced to JS at module load.
    ///
    /// Xcode shared schemes set launch env for local runs:
    /// - `SIMPLEHOUSE_API_ENV` = staging | production
    /// - `APP_BRAND` / `EXPO_PUBLIC_APP_BRAND` = symply-house | symply-budget | symply-kaizen | …
    /// Schemes: "Symply House|Budget|Kaizen|Language|Health (Staging|Production)".
    /// These vars are only present when launched from Xcode (not TestFlight/App Store).
    /// Brand JS still comes from Metro/`APP_BRAND` at bundle time — start Metro with
    /// the matching `npm run start:<brand>` before Run.
    @objc
    func constantsToExport() -> [AnyHashable: Any]! {
        let env = ProcessInfo.processInfo.environment
        let apiEnvironment = env["SIMPLEHOUSE_API_ENV"] ?? ""
        let appBrand = env["APP_BRAND"] ?? env["EXPO_PUBLIC_APP_BRAND"] ?? ""
        return [
            "apiEnvironment": apiEnvironment,
            "appBrand": appBrand,
        ]
    }

    // MARK: - Methods Exported to React Native

    /// Sync authentication tokens to Apple Watch
    @objc
    func syncAuthTokens(_ token: String, householdId: String, userId: String) {
        print("[WatchBridge] Syncing auth tokens to watch")

        // Store in App Group for watch access
        AppGroup.storeAuth(token: token, householdId: householdId, userId: userId)

        // Notify watch via WatchConnectivity
        DispatchQueue.main.async {
            WatchConnectivityService.shared.syncAuthTokensToWatch()
        }
    }

    /// Sync tasks to Apple Watch
    @objc
    func syncTasksToWatch(_ tasksJson: String) {
        print("[WatchBridge] Syncing tasks to watch")

        guard let tasksData = tasksJson.data(using: .utf8) else {
            print("[WatchBridge] Error: Invalid JSON string")
            return
        }

        do {
            let tasks = try JSONDecoder().decode([WatchTask].self, from: tasksData)

            DispatchQueue.main.async {
                WatchConnectivityService.shared.syncTasksToWatch(tasks)
            }

            print("[WatchBridge] Synced \(tasks.count) tasks to watch")
        } catch {
            print("[WatchBridge] Error decoding tasks: \(error)")
        }
    }

    /// Clear watch data (on logout)
    @objc
    func clearWatchData() {
        print("[WatchBridge] Clearing watch data")

        AppGroup.clearAuth()

        // The Home Screen widget is authed off the same App Group; refresh it so
        // it flips to the signed-out state immediately.
        WidgetCenter.shared.reloadAllTimelines()

        // Notify watch to clear its data
        DispatchQueue.main.async {
            WatchConnectivityService.shared.syncAuthTokensToWatch()
        }
    }

    // MARK: - Home Screen widget

    /// Persist the API base URL for the Watch / widget extensions so they call
    /// the same environment the app is signed in to (staging in dev, prod in
    /// release). Called alongside `syncAuthTokens`.
    @objc
    func setApiBaseUrl(_ url: String) {
        AppGroup.storeApiBaseURL(url)
    }

    /// Push the freshest Home insight (raw JSON of the insight object) to the
    /// App Group and reload the widget so it renders live Mira content instantly.
    @objc
    func syncHomeInsight(_ json: String) {
        AppGroup.storeWidgetHomeInsight(json)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Push the latest task feed (raw JSON array) to the App Group and reload
    /// the widget so its urgent-task list stays fresh from the app even when the
    /// widget's own short-lived access token has expired.
    @objc
    func syncWidgetTasks(_ json: String) {
        AppGroup.storeWidgetTasks(json)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Force a widget timeline refresh (e.g. after tasks change).
    @objc
    func reloadWidgets() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Sync today's Aihousekeeper briefing to the Watch (plan §H7).
    @objc
    func syncBriefing(_ paragraph: String, date: String) {
        print("[WatchBridge] Syncing Aihousekeeper briefing to watch (\(date))")

        DispatchQueue.main.async {
            WatchConnectivityService.shared.syncBriefingToWatch(
                paragraph: paragraph,
                date: date
            )
        }
    }

    /// Check if watch is connected and reachable
    @objc
    func isWatchReachable(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard WCSession.isSupported() else {
            resolve(["supported": false, "reachable": false])
            return
        }

        let session = WCSession.default
        resolve([
            "supported": true,
            "paired": session.isPaired,
            "watchAppInstalled": session.isWatchAppInstalled,
            "reachable": session.isReachable
        ])
    }
}
