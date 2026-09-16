//
//  AppGroup.swift
//  SymplyEcosystem Shared
//
//  Shared utilities for App Group communication between iOS app and Apple Watch
//

import Foundation

/// Shared App Group configuration for iOS app and watchOS extension
enum AppGroup {
    /// App Group identifier, derived at runtime from THIS target's own bundle ID so
    /// every brand — and each extension — resolves its own group. Strips the widget /
    /// watch suffixes so all three targets of a brand share one group:
    ///   com.symply.budget                                  → group.com.symply.budget
    ///   com.symply.budget.widget                           → group.com.symply.budget
    ///   com.symply.budget.watchkitapp                      → group.com.symply.budget
    ///   com.symply.budget.watchkitapp.watchkitextension    → group.com.symply.budget
    static let identifier: String = {
        let bundleId = Bundle.main.bundleIdentifier ?? "com.symply.house"
        let base = bundleId
            .replacingOccurrences(of: ".watchkitapp.watchkitextension", with: "")
            .replacingOccurrences(of: ".watchkitapp", with: "")
            .replacingOccurrences(of: ".widget", with: "")
        return "group.\(base)"
    }()

    /// Shared UserDefaults instance for the App Group
    static let defaults: UserDefaults = {
        guard let defaults = UserDefaults(suiteName: identifier) else {
            fatalError("Unable to initialize UserDefaults with App Group identifier: \(identifier)")
        }
        return defaults
    }()

    // MARK: - Storage Keys

    /// JWT authentication token
    static let authTokenKey = "auth_token"

    /// Current household ID
    static let householdIdKey = "current_household_id"

    /// User ID
    static let userIdKey = "user_id"

    /// Cached tasks (JSON data)
    static let cachedTasksKey = "cached_tasks"

    /// Last sync timestamp
    static let lastSyncTimestampKey = "last_sync_timestamp"

    /// Backend API base URL
    static let apiBaseURLKey = "api_base_url"

    /// Aihousekeeper — today's briefing paragraph (Stream H §H7)
    static let aihousekeeperBriefingParagraphKey = "aihousekeeper_briefing_paragraph"

    /// Aihousekeeper — date the briefing was generated for (YYYY-MM-DD)
    static let aihousekeeperBriefingDateKey = "aihousekeeper_briefing_date"

    /// Aihousekeeper — last time we pushed a briefing to the Watch (seconds since epoch)
    static let aihousekeeperBriefingUpdatedAtKey = "aihousekeeper_briefing_updated_at"

    /// Widget — latest Home insight snapshot (raw insight JSON, stored as Data)
    static let widgetHomeInsightKey = "widget_home_insight"

    /// Widget — latest task feed snapshot (raw JSON array, stored as Data)
    static let widgetTasksKey = "widget_tasks"

    /// Widget — snapshot updated timestamp
    static let widgetUpdatedAtKey = "widget_updated_at"

    // MARK: - Helper Methods

    /// Persist the API base URL so extensions (Watch / Widget) hit the same
    /// environment the app is signed in to (staging for dev builds, prod for
    /// release). Stored as a plain string under `apiBaseURLKey`.
    static func storeApiBaseURL(_ url: String) {
        guard !url.isEmpty else { return }
        defaults.set(url, forKey: apiBaseURLKey)
        defaults.synchronize()
    }

    /// Store the latest Home insight snapshot for the widget. `json` is the raw
    /// insight object as returned by the backend; stored as UTF-8 Data so the
    /// widget can read it back via `UserDefaults.data(forKey:)`.
    static func storeWidgetHomeInsight(_ json: String) {
        guard !json.isEmpty else { return }
        defaults.set(Data(json.utf8), forKey: widgetHomeInsightKey)
        defaults.set(Date(), forKey: widgetUpdatedAtKey)
        defaults.synchronize()
    }

    /// Store the latest task feed snapshot for the widget. `json` is a JSON
    /// array of tasks (snake_case fields); stored as UTF-8 Data.
    static func storeWidgetTasks(_ json: String) {
        guard !json.isEmpty else { return }
        defaults.set(Data(json.utf8), forKey: widgetTasksKey)
        defaults.set(Date(), forKey: widgetUpdatedAtKey)
        defaults.synchronize()
    }

    /// Remove the widget snapshot (called on logout).
    static func clearWidgetSnapshot() {
        defaults.removeObject(forKey: widgetHomeInsightKey)
        defaults.removeObject(forKey: widgetTasksKey)
        defaults.removeObject(forKey: widgetUpdatedAtKey)
        defaults.synchronize()
    }

    /// Store authentication credentials
    static func storeAuth(token: String, householdId: String, userId: String) {
        defaults.set(token, forKey: authTokenKey)
        defaults.set(householdId, forKey: householdIdKey)
        defaults.set(userId, forKey: userIdKey)
        defaults.synchronize()
    }

    /// Get authentication token
    static func getAuthToken() -> String? {
        return defaults.string(forKey: authTokenKey)
    }

    /// Get household ID
    static func getHouseholdId() -> String? {
        return defaults.string(forKey: householdIdKey)
    }

    /// Get user ID
    static func getUserId() -> String? {
        return defaults.string(forKey: userIdKey)
    }

    /// Check if user is authenticated
    static func isAuthenticated() -> Bool {
        return getAuthToken() != nil && getHouseholdId() != nil
    }

    /// Clear all authentication data
    static func clearAuth() {
        defaults.removeObject(forKey: authTokenKey)
        defaults.removeObject(forKey: householdIdKey)
        defaults.removeObject(forKey: userIdKey)
        defaults.removeObject(forKey: cachedTasksKey)
        // Aihousekeeper briefing is household-scoped; clear with auth.
        defaults.removeObject(forKey: aihousekeeperBriefingParagraphKey)
        defaults.removeObject(forKey: aihousekeeperBriefingDateKey)
        defaults.removeObject(forKey: aihousekeeperBriefingUpdatedAtKey)
        // Widget snapshot is also household-scoped; clear with auth.
        defaults.removeObject(forKey: widgetHomeInsightKey)
        defaults.removeObject(forKey: widgetTasksKey)
        defaults.removeObject(forKey: widgetUpdatedAtKey)
        defaults.synchronize()
    }

    // MARK: - One-time test-data cleanup

    /// Bump this when a new one-time cleanup of leaked test data is required.
    static let mockPurgeVersionKey = "mock_purge_version"
    static let currentMockPurgeVersion = 1

    /// Remove any fabricated UI-test data that an older build could have
    /// persisted into the shared App Group, so the Watch/widget only ever render
    /// real backend data. Runs once per `currentMockPurgeVersion`. Safe to call
    /// on every launch — it no-ops after the first run.
    static func purgeLeakedTestDataIfNeeded() {
        if defaults.integer(forKey: mockPurgeVersionKey) >= currentMockPurgeVersion { return }

        var purged = false

        // Sentinel auth written by the removed UI-test harness.
        if getAuthToken() == "ui-test-token" || getHouseholdId() == "household-test" {
            clearAuth() // also drops cached tasks + briefing
            purged = true
        } else {
            // Auth may already be real, but cached tasks/briefing can still be mock.
            if let tasks = getCachedTasks(),
               tasks.contains(where: { $0.householdId == "household-test" || $0.id.hasPrefix("ui-") }) {
                defaults.removeObject(forKey: cachedTasksKey)
                purged = true
            }
            // The old hardcoded UI-test briefing paragraph.
            if defaults.string(forKey: aihousekeeperBriefingParagraphKey)
                == "Today: replace the HVAC filter and address the overdue plumbing task." {
                clearAihousekeeperBriefing()
                purged = true
            }
        }

        defaults.set(currentMockPurgeVersion, forKey: mockPurgeVersionKey)
        defaults.synchronize()
        if purged { print("[AppGroup] Purged leaked UI-test data from shared store") }
    }

    /// Store cached tasks
    static func cacheTasks(_ tasks: [WatchTask]) {
        if let encoded = try? JSONEncoder().encode(tasks) {
            defaults.set(encoded, forKey: cachedTasksKey)
            defaults.set(Date(), forKey: lastSyncTimestampKey)
            defaults.synchronize()
        }
    }

    /// Load cached tasks
    static func getCachedTasks() -> [WatchTask]? {
        guard let data = defaults.data(forKey: cachedTasksKey) else {
            return nil
        }
        return try? JSONDecoder().decode([WatchTask].self, from: data)
    }

    /// Get last sync timestamp
    static func getLastSyncTimestamp() -> Date? {
        return defaults.object(forKey: lastSyncTimestampKey) as? Date
    }

    /// Check if cache is expired (older than 1 hour)
    static func isCacheExpired() -> Bool {
        guard let lastSync = getLastSyncTimestamp() else {
            return true
        }
        return Date().timeIntervalSince(lastSync) > 3600 // 1 hour
    }

    // MARK: - Aihousekeeper briefing (Plan §H7)

    /// Store today's Aihousekeeper briefing for Watch access.
    static func storeAihousekeeperBriefing(paragraph: String, date: String) {
        defaults.set(paragraph, forKey: aihousekeeperBriefingParagraphKey)
        defaults.set(date, forKey: aihousekeeperBriefingDateKey)
        defaults.set(Date(), forKey: aihousekeeperBriefingUpdatedAtKey)
        defaults.synchronize()
    }

    /// Load today's Aihousekeeper briefing (returns `nil` if no briefing or if cached for a different date).
    static func getAihousekeeperBriefing(for date: String) -> String? {
        guard
            let stored = defaults.string(forKey: aihousekeeperBriefingParagraphKey),
            let storedDate = defaults.string(forKey: aihousekeeperBriefingDateKey),
            storedDate == date
        else { return nil }
        return stored
    }

    /// Load the most recent Aihousekeeper briefing regardless of date (for stale-fallback display).
    static func getAihousekeeperBriefingLatest() -> (paragraph: String, date: String)? {
        guard
            let paragraph = defaults.string(forKey: aihousekeeperBriefingParagraphKey),
            let date = defaults.string(forKey: aihousekeeperBriefingDateKey)
        else { return nil }
        return (paragraph, date)
    }

    /// Clear the stored briefing (called on logout).
    static func clearAihousekeeperBriefing() {
        defaults.removeObject(forKey: aihousekeeperBriefingParagraphKey)
        defaults.removeObject(forKey: aihousekeeperBriefingDateKey)
        defaults.removeObject(forKey: aihousekeeperBriefingUpdatedAtKey)
        defaults.synchronize()
    }
}
