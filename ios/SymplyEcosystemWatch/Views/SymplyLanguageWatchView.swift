//
//  SymplyLanguageWatchView.swift
//  SymplyEcosystemWatch
//
//  Symply Language (appKey "language") — glanceable watch screen.
//
//  Renders today's language snapshot (streak, XP today vs goal, next lesson,
//  words due) synced from the phone into the shared App Group under the key
//  "watch_language_today". Built ONLY from the Symply shared kit primitives
//  (SymplyCard / SymplyHeader / SymplyStatTile / SymplyListRow / SymplyEmptyState)
//  so it looks like one product line with every other app's watch + widget.
//
//  Self-contained: defines its own Codable model + load(); references no
//  widget-only types beyond the shared kit and no other app's code.
//

import SwiftUI

// MARK: - Model

/// Today's language snapshot the phone writes into the App Group as JSON Data
/// (snake_case fields) under `watch_language_today`. Decoding is tolerant: any
/// missing field falls back to a sensible default so a partial payload still renders.
struct LanguageWatchSnapshot: Codable {
    /// Consecutive-day practice streak.
    let streak: Int
    /// XP earned so far today.
    let xpToday: Int
    /// Daily XP goal (0 ⇒ no goal configured).
    let xpGoal: Int
    /// Title of the next lesson to start, if any.
    let nextLesson: String?
    /// Number of vocabulary words due for review.
    let wordsDue: Int

    enum CodingKeys: String, CodingKey {
        case streak
        case xpToday = "xp_today"
        case xpGoal = "xp_goal"
        case nextLesson = "next_lesson"
        case wordsDue = "words_due"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        streak     = (try? c.decode(Int.self, forKey: .streak)) ?? 0
        xpToday    = (try? c.decode(Int.self, forKey: .xpToday)) ?? 0
        xpGoal     = (try? c.decode(Int.self, forKey: .xpGoal)) ?? 0
        wordsDue   = (try? c.decode(Int.self, forKey: .wordsDue)) ?? 0
        nextLesson = try? c.decode(String.self, forKey: .nextLesson)
    }

    /// Direct initializer (previews / tests).
    init(streak: Int, xpToday: Int, xpGoal: Int, nextLesson: String?, wordsDue: Int) {
        self.streak = streak
        self.xpToday = xpToday
        self.xpGoal = xpGoal
        self.nextLesson = nextLesson
        self.wordsDue = wordsDue
    }

    /// App Group key the phone syncs today's language snapshot under.
    static let storageKey = "watch_language_today"

    /// Read the snapshot from the shared App Group. Returns `nil` when nothing
    /// has been synced yet (⇒ the view shows `SymplyEmptyState`).
    static func load() -> LanguageWatchSnapshot? {
        guard let data = AppGroup.defaults.data(forKey: storageKey) else { return nil }
        return try? JSONDecoder().decode(LanguageWatchSnapshot.self, from: data)
    }

    /// True once today's XP goal has been reached.
    var xpGoalMet: Bool { xpGoal > 0 && xpToday >= xpGoal }

    /// XP progress shown in the header, e.g. "40/50 XP" (or just "40 XP" with no goal).
    var xpSummary: String { xpGoal > 0 ? "\(xpToday)/\(xpGoal) XP" : "\(xpToday) XP" }
}

// MARK: - View

struct SymplyLanguageWatchView: View {

    /// Header title uses the app's short name.
    private static let appShortName = "Language"

    private let snapshot: LanguageWatchSnapshot?

    init() { self.snapshot = LanguageWatchSnapshot.load() }
    init(snapshot: LanguageWatchSnapshot?) { self.snapshot = snapshot }

    var body: some View {
        ScrollView {
            SymplyCard {
                if let s = snapshot {
                    glance(s)
                } else {
                    SymplyEmptyState(
                        icon: "character.book.closed",
                        message: "Open Symply Language on your iPhone to start today's session."
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func glance(_ s: LanguageWatchSnapshot) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(
                icon: "character.book.closed.fill",
                title: Self.appShortName,
                trailing: s.xpSummary,
                tint: s.xpGoalMet ? WidgetTheme.green : BrandTokens.primary
            )

            HStack(spacing: SymplyLayout.gap) {
                SymplyStatTile(
                    value: "\(s.streak)",
                    caption: "Day streak",
                    tint: WidgetTheme.amber
                )
                SymplyStatTile(
                    value: s.xpSummary.replacingOccurrences(of: " XP", with: ""),
                    caption: "XP today",
                    tint: s.xpGoalMet ? WidgetTheme.green : BrandTokens.primary
                )
            }

            SymplyListRow(
                icon: "clock.arrow.circlepath",
                text: "Words to review",
                detail: "\(s.wordsDue)",
                tint: s.wordsDue > 0 ? WidgetTheme.amber : WidgetTheme.green
            )

            if let lesson = s.nextLesson, !lesson.isEmpty {
                SymplyListRow(
                    icon: "play.circle.fill",
                    text: lesson,
                    detail: "Next"
                )
            }
        }
    }
}

// MARK: - Preview

#Preview("With data") {
    SymplyLanguageWatchView(
        snapshot: LanguageWatchSnapshot(
            streak: 12,
            xpToday: 40,
            xpGoal: 50,
            nextLesson: "Past tense verbs",
            wordsDue: 8
        )
    )
}

#Preview("Empty") {
    SymplyLanguageWatchView(snapshot: nil)
}
