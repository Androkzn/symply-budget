//
//  WidgetDataService.swift
//  SymplyEcosystemWidget
//
//  Reads shared auth from the App Group (written by the app's WatchBridge),
//  fetches the live Mira insight + task feed directly from the backend (the
//  same direct-API approach the Apple Watch uses), and caches the last good
//  snapshot so the widget renders instantly and survives being offline.
//

import Foundation
import WidgetKit

// MARK: - Shared App Group store

/// Thin accessor over the shared App Group `UserDefaults`. Keys are kept in
/// sync with `ios/Shared/Utilities/AppGroup.swift` (the app writes; we read).
enum WidgetStore {
    /// Derived from the widget's own bundle ID so each brand reads its own group:
    /// `com.symply.<brand>.widget` → `group.com.symply.<brand>`. (Mirrors AppGroup.swift.)
    static let appGroup: String = {
        let bundleId = Bundle.main.bundleIdentifier ?? "com.symply.house.widget"
        return "group.\(bundleId.replacingOccurrences(of: ".widget", with: ""))"
    }()

    static let authTokenKey = "auth_token"
    static let householdIdKey = "current_household_id"
    static let apiBaseURLKey = "api_base_url"

    // Snapshot cache (also written by the app so the widget has data before its
    // first network refresh).
    static let insightJSONKey = "widget_home_insight"
    static let tasksJSONKey = "widget_tasks"
    static let updatedAtKey = "widget_updated_at"

    /// Production API — matches the Watch client default. The app overrides this
    /// with the environment base URL (staging for dev builds) via the App Group.
    static let defaultBaseURL = "https://simple-house-api.a-tekhtelev.workers.dev"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static var authToken: String? { defaults?.string(forKey: authTokenKey) }
    static var householdId: String? { defaults?.string(forKey: householdIdKey) }

    static var baseURL: String {
        let stored = defaults?.string(forKey: apiBaseURLKey)
        if let stored, !stored.isEmpty { return stored }
        return defaultBaseURL
    }

    /// Legacy gate for the direct live-fetch path (`WidgetDataService.load`), which
    /// still needs a bearer token. Snapshot-based brand widgets must NOT use this:
    /// the product JWT is deliberately never written to the App Group
    /// (`WidgetSyncModule.setAuth` strips `auth_token`), so this is always false in
    /// the current model — use `isSignedIn` instead.
    static var isAuthenticated: Bool {
        (authToken?.isEmpty == false) && (householdId?.isEmpty == false)
    }

    /// The correct "connected" signal for snapshot-driven widgets. The app writes
    /// `current_household_id` on login and `clear()` wipes it on logout, so a
    /// present household id means the user is signed in — without ever putting the
    /// product access token in the shared App Group.
    static var isSignedIn: Bool { isSignedIn(in: defaults) }

    /// Signed-in check against an explicit store — injectable so the widget unit
    /// tests can exercise the gate headless, without the real App Group entitlement.
    static func isSignedIn(in defaults: UserDefaults?) -> Bool {
        defaults?.string(forKey: householdIdKey)?.isEmpty == false
    }

    // MARK: Cache

    static func cache(insight: HomeInsightData?, tasks: [WidgetTask]) {
        guard let defaults else { return }
        if let insight, let data = try? JSONEncoder().encode(insight) {
            defaults.set(data, forKey: insightJSONKey)
        }
        // Encode tasks snake_cased so the widget's own cache matches the shape
        // the app pushes (both read back via `.convertFromSnakeCase`).
        let taskEncoder = JSONEncoder()
        taskEncoder.keyEncodingStrategy = .convertToSnakeCase
        if let data = try? taskEncoder.encode(tasks) {
            defaults.set(data, forKey: tasksJSONKey)
        }
        defaults.set(Date(), forKey: updatedAtKey)
    }

    static func cachedInsight() -> HomeInsightData? {
        // The app pushes either the raw insight object or the `{ insight: ... }`
        // envelope; accept both.
        guard let data = defaults?.data(forKey: insightJSONKey) else { return nil }
        if let direct = try? JSONDecoder().decode(HomeInsightData.self, from: data) {
            return direct
        }
        return try? JSONDecoder().decode(HomeInsightEnvelope.self, from: data).insight
    }

    static func cachedTasks() -> [WidgetTask] {
        guard let data = defaults?.data(forKey: tasksJSONKey) else { return [] }
        // Both the widget's own cache and the app's push store tasks snake_cased.
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return (try? decoder.decode([WidgetTask].self, from: data)) ?? []
    }

    static func clearCache() {
        guard let defaults else { return }
        defaults.removeObject(forKey: insightJSONKey)
        defaults.removeObject(forKey: tasksJSONKey)
        defaults.removeObject(forKey: updatedAtKey)
    }
}

// MARK: - Widget content

/// Everything a timeline entry needs to render.
struct WidgetContent {
    var insight: HomeInsightData?
    var tasks: [WidgetTask]
    var isLoggedOut: Bool
    /// True when served from cache because the live fetch failed.
    var isStale: Bool

    static let loggedOut = WidgetContent(insight: nil, tasks: [], isLoggedOut: true, isStale: false)
}

// MARK: - Data service

enum WidgetDataService {
    private static let timeout: TimeInterval = 12

    /// Load the freshest content: live fetch when authenticated, falling back to
    /// the cached snapshot on any failure so the widget never goes blank.
    static func load() async -> WidgetContent {
        guard WidgetStore.isAuthenticated,
              let token = WidgetStore.authToken,
              let householdId = WidgetStore.householdId else {
            return .loggedOut
        }

        async let insight = fetchInsight(token: token, householdId: householdId)
        async let tasks = fetchTasks(token: token, householdId: householdId)

        let fetchedInsight = await insight
        let fetchedTasks = await tasks

        // Full success → cache and serve live.
        if fetchedInsight != nil || !fetchedTasks.isEmpty {
            WidgetStore.cache(insight: fetchedInsight, tasks: fetchedTasks)
            return WidgetContent(
                insight: fetchedInsight ?? WidgetStore.cachedInsight(),
                tasks: fetchedTasks.isEmpty ? WidgetStore.cachedTasks() : fetchedTasks,
                isLoggedOut: false,
                isStale: false
            )
        }

        // Both failed → serve whatever we cached last.
        return WidgetContent(
            insight: WidgetStore.cachedInsight(),
            tasks: WidgetStore.cachedTasks(),
            isLoggedOut: false,
            isStale: true
        )
    }

    /// Cached-only content for fast snapshots (no network).
    static func cachedContent() -> WidgetContent {
        guard WidgetStore.isAuthenticated else { return .loggedOut }
        return WidgetContent(
            insight: WidgetStore.cachedInsight(),
            tasks: WidgetStore.cachedTasks(),
            isLoggedOut: false,
            isStale: true
        )
    }

    // MARK: Networking

    private static func fetchInsight(token: String, householdId: String) async -> HomeInsightData? {
        let tz = TimeZone.current.identifier
        var components = URLComponents(string: "\(WidgetStore.baseURL)/households/\(householdId)/aihousekeeper/home-insight")
        components?.queryItems = [URLQueryItem(name: "tz", value: tz)]
        guard let url = components?.url else { return nil }

        guard let data = await get(url, token: token) else { return nil }
        return try? JSONDecoder().decode(HomeInsightEnvelope.self, from: data).insight
    }

    private static func fetchTasks(token: String, householdId: String) async -> [WidgetTask] {
        guard let url = URL(string: "\(WidgetStore.baseURL)/households/\(householdId)/tasks/watch?days=7") else {
            return []
        }
        guard let data = await get(url, token: token) else { return [] }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return (try? decoder.decode([WidgetTask].self, from: data)) ?? []
    }

    private static func get(_ url: URL, token: String) async -> Data? {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = timeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            return data
        } catch {
            return nil
        }
    }
}

// MARK: - Urgent-task selection & due labels

enum WidgetTasks {
    /// The most pressing tasks: overdue and due-soon first, then the rest of the
    /// week, capped at `limit`. Undated / inactive tasks are dropped.
    static func urgent(from tasks: [WidgetTask], limit: Int, withinDays: Int = 7) -> [WidgetTask] {
        let now = Date()
        let horizon = Calendar.current.date(byAdding: .day, value: withinDays, to: now) ?? now
        let candidates = tasks.filter { task in
            guard task.isActive != false, let due = task.dueDate else { return false }
            return due <= horizon
        }
        let sorted = candidates.sorted { a, b in
            guard let da = a.dueDate, let db = b.dueDate else { return false }
            if da != db { return da < db }
            return a.priorityRank > b.priorityRank
        }
        return Array(sorted.prefix(limit))
    }

    /// Count of tasks that are overdue or due within `withinDays`.
    static func urgentCount(from tasks: [WidgetTask], withinDays: Int = 7) -> Int {
        urgent(from: tasks, limit: Int.max, withinDays: withinDays).count
    }
}

enum WidgetDueLabel {
    /// Whole-calendar-day difference from today (local), negative when overdue.
    static func daysUntil(_ date: Date) -> Int {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let due = cal.startOfDay(for: date)
        return cal.dateComponents([.day], from: today, to: due).day ?? 0
    }

    /// Short relative label, e.g. "Overdue", "Today", "Tomorrow", "In 3 days".
    static func short(for date: Date) -> String {
        let days = daysUntil(date)
        if days < 0 { return days == -1 ? "1 day overdue" : "\(-days) days overdue" }
        if days == 0 { return "Today" }
        if days == 1 { return "Tomorrow" }
        return "In \(days) days"
    }

    static func isOverdue(_ date: Date) -> Bool { daysUntil(date) < 0 }
    static func isToday(_ date: Date) -> Bool { daysUntil(date) == 0 }
}
