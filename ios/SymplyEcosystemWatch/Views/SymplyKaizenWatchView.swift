//
//  SymplyKaizenWatchView.swift
//  SymplyEcosystemWatch
//
//  Symply Kaizen — glanceable watch face for today's habits.
//  Reads a phone-synced snapshot from the shared App Group and renders it with
//  ONLY the shared Symply primitives so it matches every other app in the fleet.
//  No dedicated sync yet → falls back to SymplyEmptyState when the key is absent.
//

import SwiftUI

// MARK: - Model

/// Today's habit snapshot for Kaizen, synced from the phone into the shared
/// App Group under `watch_kaizen_today` as JSON (snake_case fields).
struct KaizenToday: Codable {
    /// Habits completed today.
    let done: Int
    /// Total habits scheduled today.
    let total: Int
    /// Current daily completion streak (consecutive days).
    let currentStreak: Int
    /// Title of the next habit to do today (nil / empty when nothing is left).
    let nextHabit: String?

    enum CodingKeys: String, CodingKey {
        case done
        case total
        case currentStreak = "current_streak"
        case nextHabit = "next_habit"
    }

    /// App Group key the phone writes this snapshot to.
    static let storageKey = "watch_kaizen_today"

    /// Launch argument carrying a UI-test snapshot as inline JSON.
    ///
    /// Deliberately **non-persistent**: the payload is decoded straight from the
    /// process arguments and is never written to `AppGroup.defaults`. The previous
    /// Watch UI-test harness seeded fabricated data into the real App Group keys,
    /// which then stuck and leaked into real sessions (see WatchUITesting.swift).
    /// Reading from argv makes that class of leak impossible — nothing survives the
    /// process. DEBUG-only so it cannot exist in a shipped build at all.
    static let uiTestSnapshotArgument = "-SYMPLY_UI_TEST_KAIZEN_SNAPSHOT"

    /// Load today's snapshot from the shared App Group.
    /// Returns `nil` when no snapshot has been synced yet (→ empty state).
    static func load() -> KaizenToday? {
        #if DEBUG
        if let injected = uiTestSnapshot() { return injected }
        #endif
        guard let data = AppGroup.defaults.data(forKey: storageKey) else { return nil }
        return try? JSONDecoder().decode(KaizenToday.self, from: data)
    }

    #if DEBUG
    /// Decode an injected UI-test snapshot from the launch arguments, if present.
    /// `-SYMPLY_UI_TEST_KAIZEN_SNAPSHOT "<json>"`; an empty payload means "signed
    /// out", letting a UI test drive the empty state deterministically.
    static func uiTestSnapshot() -> KaizenToday? {
        let args = ProcessInfo.processInfo.arguments
        guard let flag = args.firstIndex(of: uiTestSnapshotArgument),
              args.index(after: flag) < args.endIndex else { return nil }
        let json = args[args.index(after: flag)]
        guard !json.isEmpty else { return nil }
        return try? JSONDecoder().decode(KaizenToday.self, from: Data(json.utf8))
    }
    #endif

    /// Completion progress as a whole percentage (0–100), safe when `total == 0`.
    var progressPercent: Int {
        guard total > 0 else { return 0 }
        return Int((Double(done) / Double(total) * 100).rounded())
    }

    /// Whether a habit is still pending today.
    ///
    /// An empty-string `next_habit` counts as "nothing left" — same as `nil` — so a
    /// blank title can never render an "Up next" row with no text in it.
    var hasNextHabit: Bool {
        !(nextHabit ?? "").isEmpty
    }
}

// MARK: - View

/// Single glanceable Kaizen screen: progress header, done + streak stat tiles,
/// and the next habit up. Built entirely from the shared Symply primitives.
struct SymplyKaizenWatchView: View {
    private let today = KaizenToday.load()

    var body: some View {
        SymplyCard {
            if let today {
                ScrollView {
                    VStack(alignment: .leading, spacing: SymplyLayout.gap) {
                        SymplyHeader(
                            icon: Ionicon.symbol("checkmark-done"),
                            title: "Kaizen",
                            trailing: "\(today.progressPercent)%"
                        )

                        HStack(spacing: SymplyLayout.gap) {
                            SymplyStatTile(
                                value: "\(today.done)/\(today.total)",
                                caption: "Habits done"
                            )
                            SymplyStatTile(
                                value: "\(today.currentStreak)",
                                caption: "Day streak"
                            )
                        }

                        nextRow(for: today)
                    }
                }
            } else {
                SymplyEmptyState(
                    icon: Ionicon.symbol("checkmark-circle"),
                    message: "No habits to track yet"
                )
            }
        }
    }

    /// The "up next" habit row, or a completion row when nothing is left today.
    @ViewBuilder
    private func nextRow(for today: KaizenToday) -> some View {
        if today.hasNextHabit, let next = today.nextHabit {
            SymplyListRow(
                icon: Ionicon.symbol("flag"),
                text: next,
                detail: "Up next"
            )
        } else {
            SymplyListRow(
                icon: Ionicon.symbol("checkmark-circle"),
                text: "All habits complete",
                detail: nil
            )
        }
    }
}
