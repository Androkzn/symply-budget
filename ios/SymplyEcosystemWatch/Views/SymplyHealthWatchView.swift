//
//  SymplyHealthWatchView.swift
//  SymplyEcosystemWatch
//
//  Symply Health (appKey "health") — single glanceable watch screen.
//
//  Renders today's health snapshot (move goal %, steps, water, next reminder)
//  from whatever the phone synced into the shared App Group under
//  "watch_health_today". Built entirely from the shared Symply layout kit
//  (SymplyCard / SymplyHeader / SymplyStatTile / SymplyListRow / SymplyEmptyState)
//  so it reads as one product line with every other app's widget + watch view.
//
//  No dedicated WatchConnectivity sync exists yet, so `load()` simply reads the
//  App Group key and returns nil when absent → the view falls back to
//  SymplyEmptyState.
//

import SwiftUI

// MARK: - Model

/// Today's health snapshot, mirrored from the phone into the App Group as JSON
/// (snake_case). Every field is optional so a partial payload still decodes.
struct HealthTodaySnapshot: Codable {
    /// Move goal completion, 0–100.
    let moveGoalPercent: Int?
    /// Steps taken today.
    let steps: Int?
    /// Optional daily step goal (for context).
    let stepsGoal: Int?
    /// Water intake today, in millilitres.
    let waterMl: Int?
    /// Optional daily water goal, in millilitres.
    let waterGoalMl: Int?
    /// Label of the next reminder (e.g. "Drink water", "Stand up").
    let nextReminder: String?
    /// Pre-formatted time for the next reminder (e.g. "2:30 PM").
    let nextReminderTime: String?
    /// ISO date (YYYY-MM-DD) the snapshot was generated for.
    let date: String?

    enum CodingKeys: String, CodingKey {
        case moveGoalPercent = "move_goal_percent"
        case steps
        case stepsGoal = "steps_goal"
        case waterMl = "water_ml"
        case waterGoalMl = "water_goal_ml"
        case nextReminder = "next_reminder"
        case nextReminderTime = "next_reminder_time"
        case date
    }

    /// App Group key the phone writes this snapshot to.
    static let appGroupKey = "watch_health_today"

    /// Read + decode the snapshot from the shared App Group. Returns `nil` when
    /// signed out, when nothing has been synced yet, or when the payload can't
    /// be decoded.
    ///
    /// Gated on household presence, matching the widget's own `isSignedIn` —
    /// never on `AppGroup.isAuthenticated()`, which checks for a JWT that is
    /// deliberately never written to the App Group and so is always false.
    /// Without this gate, a signed-out watch could keep rendering a PREVIOUS
    /// sign-in's real health data indefinitely: `AppGroup.clearAuth()` (run on
    /// logout) drops `current_household_id` but never touches this snapshot
    /// key, which is written by the phone's RN side, not by `AppGroup` itself.
    static func load() -> HealthTodaySnapshot? {
        guard AppGroup.getHouseholdId()?.isEmpty == false else { return nil }
        guard let data = AppGroup.defaults.data(forKey: appGroupKey) else { return nil }
        return try? JSONDecoder().decode(HealthTodaySnapshot.self, from: data)
    }

    /// True when the snapshot carries no glanceable value at all.
    var isEmpty: Bool {
        moveGoalPercent == nil && steps == nil && waterMl == nil && nextReminder == nil
    }
}

// MARK: - View

struct SymplyHealthWatchView: View {
    private let snapshot: HealthTodaySnapshot?

    /// Defaults to reading the live App Group snapshot; an explicit value can be
    /// injected for previews / tests.
    init(snapshot: HealthTodaySnapshot? = HealthTodaySnapshot.load()) {
        self.snapshot = snapshot
    }

    var body: some View {
        if let snapshot, !snapshot.isEmpty {
            ScrollView {
                SymplyCard {
                    VStack(alignment: .leading, spacing: SymplyLayout.gap) {
                        SymplyHeader(icon: "heart.fill", title: "Health")

                        SymplyStatTile(
                            value: percentText(snapshot.moveGoalPercent),
                            caption: "Move goal"
                        )

                        HStack(spacing: SymplyLayout.gap) {
                            SymplyStatTile(
                                value: stepsText(snapshot.steps),
                                caption: "Steps"
                            )
                            SymplyStatTile(
                                value: waterText(snapshot.waterMl),
                                caption: "Water"
                            )
                        }

                        SymplyListRow(
                            icon: "bell.fill",
                            text: snapshot.nextReminder ?? "No upcoming reminders",
                            detail: snapshot.nextReminderTime
                        )
                    }
                }
            }
        } else {
            SymplyCard {
                SymplyEmptyState(
                    icon: "heart",
                    message: "Open Symply Health on your iPhone to see today's activity."
                )
            }
        }
    }

    // MARK: - Formatting

    private func percentText(_ value: Int?) -> String {
        guard let value else { return "—" }
        return "\(value)%"
    }

    private func stepsText(_ value: Int?) -> String {
        guard let value else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    private func waterText(_ ml: Int?) -> String {
        guard let ml else { return "—" }
        if ml >= 1000 {
            return String(format: "%.1fL", Double(ml) / 1000.0)
        }
        return "\(ml)ml"
    }
}

// MARK: - Preview

#Preview("With data") {
    SymplyHealthWatchView(
        snapshot: HealthTodaySnapshot(
            moveGoalPercent: 72,
            steps: 8240,
            stepsGoal: 10000,
            waterMl: 1200,
            waterGoalMl: 2000,
            nextReminder: "Drink water",
            nextReminderTime: "2:30 PM",
            date: "2026-07-13"
        )
    )
}

#Preview("Empty") {
    SymplyHealthWatchView(snapshot: nil)
}
