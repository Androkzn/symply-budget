//
//  SymplyLanguageWidgetContent.swift
//  SymplyEcosystemWidget
//
//  Symply Language home-screen widget content. Renders the learner's daily
//  snapshot — streak, XP earned vs today's goal, next lesson, and words due for
//  review — built ONLY from the shared Symply widget kit (SymplyCard / Header /
//  StatTile / ListRow / EmptyState) so it shares the exact rhythm of every other
//  app's widget. Data comes from the shared App Group under `widget_language_*`.
//

import WidgetKit
import SwiftUI

// MARK: - Data contract

/// Decoded from the App Group JSON at `widget_language_today`, written by the app.
///
/// Shape (snake_case on the wire):
/// ```json
/// {
///   "streak": 5,
///   "xp": 40,
///   "xp_goal": 50,
///   "next_lesson": { "title": "Past tense verbs", "icon": "book" },
///   "words_due": 12
/// }
/// ```
///
/// Every field decodes leniently: the app currently writes only `streak`,
/// `words_due` and `next_lesson` (see `LanguageLearnScreen.tsx` →
/// `widgetSync.setSnapshot('widget_language_today', …)`), so `xp` / `xp_goal`
/// are absent in practice. Non-optional `let`s with the synthesized `Codable`
/// init made the whole decode throw `keyNotFound` on that real payload, which
/// `load()`'s `try?` swallowed — leaving every signed-in learner on the
/// "Sign in to track your streak" empty state. Mirrors the tolerant decoding
/// `LanguageWatchSnapshot` already uses; see `hasXP` for the render-side gate.
struct LanguageWidgetData: Codable {
    let streak: Int
    let xp: Int
    let xpGoal: Int
    let nextLesson: NextLesson?
    let wordsDue: Int

    struct NextLesson: Codable {
        let title: String
        let icon: String?   // Ionicons name from backend → mapped via `Ionicon.symbol`
    }

    enum CodingKeys: String, CodingKey {
        case streak
        case xp
        case xpGoal = "xp_goal"
        case nextLesson = "next_lesson"
        case wordsDue = "words_due"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        streak     = (try? c.decode(Int.self, forKey: .streak)) ?? 0
        xp         = (try? c.decode(Int.self, forKey: .xp)) ?? 0
        xpGoal     = (try? c.decode(Int.self, forKey: .xpGoal)) ?? 0
        wordsDue   = (try? c.decode(Int.self, forKey: .wordsDue)) ?? 0
        nextLesson = try? c.decode(NextLesson.self, forKey: .nextLesson)
    }

    /// Direct initializer (previews / tests).
    init(streak: Int, xp: Int, xpGoal: Int, nextLesson: NextLesson?, wordsDue: Int) {
        self.streak = streak
        self.xp = xp
        self.xpGoal = xpGoal
        self.nextLesson = nextLesson
        self.wordsDue = wordsDue
    }

    /// App Group key the app writes and the widget reads.
    static let appGroupKey = "widget_language_today"

    /// Load the latest snapshot from the shared App Group, or `nil` when signed
    /// out / nothing cached yet (→ the view shows `SymplyEmptyState`).
    static func load() -> LanguageWidgetData? {
        guard let data = WidgetStore.defaults?.data(forKey: appGroupKey) else { return nil }
        return try? JSONDecoder().decode(LanguageWidgetData.self, from: data)
    }

    /// Illustrative content for the widget gallery / previews (never real data).
    static let sample = LanguageWidgetData(
        streak: 5, xp: 40, xpGoal: 50,
        nextLesson: NextLesson(title: "Past tense verbs", icon: "book"),
        wordsDue: 12
    )

    // Derived, render-ready values ------------------------------------------------

    var xpGoalMet: Bool { xpGoal > 0 && xp >= xpGoal }
    var xpProgress: String { "\(xp)/\(max(xpGoal, xp))" }

    /// The app does not yet write `xp` / `xp_goal`. Without this gate the XP
    /// tiles render a meaningless "0/0" on every real snapshot, so the layouts
    /// fall back to streak + words-due until an XP source ships.
    var hasXP: Bool { xp > 0 || xpGoal > 0 }

    var streakCaption: String { "day streak" }
    var streakTrailing: String? {
        guard streak > 0 else { return nil }
        return streak == 1 ? "1 day streak" : "\(streak) day streak"
    }

    var wordsDueCaption: String { wordsDue == 1 ? "word due" : "words due" }

    var nextLessonIcon: String { Ionicon.symbol(nextLesson?.icon) }
    var nextLessonTitle: String { nextLesson?.title ?? "You're all caught up" }
    var hasNextLesson: Bool { nextLesson != nil }
}

// MARK: - Content view

/// Renders the Symply Language widget for `systemSmall` + `systemMedium`.
/// Pass the decoded snapshot, or `nil` for the signed-out / no-data state.
struct SymplyLanguageWidgetContent: View {
    let data: LanguageWidgetData?
    @Environment(\.widgetFamily) private var family

    private let title = "Language"
    private let headerIcon = "character.bubble.fill"

    var body: some View {
        SymplyCard {
            if let data {
                switch family {
                case .systemSmall:
                    small(data)
                default:
                    medium(data)
                }
            } else {
                SymplyEmptyState(
                    icon: "character.bubble",
                    message: "Sign in to track your streak"
                )
            }
        }
    }

    // MARK: Semantic tints (brand accent by default; semantics allowed for streak/goal/due)

    private func streakTint(_ d: LanguageWidgetData) -> Color {
        d.streak > 0 ? WidgetTheme.amber : BrandTokens.primary
    }
    private func xpTint(_ d: LanguageWidgetData) -> Color {
        d.xpGoalMet ? WidgetTheme.green : BrandTokens.primary
    }
    private func wordsDueTint(_ d: LanguageWidgetData) -> Color {
        d.wordsDue > 0 ? WidgetTheme.amber : WidgetTheme.green
    }

    // MARK: Small — streak + XP at a glance, words-due in the header

    @ViewBuilder
    private func small(_ d: LanguageWidgetData) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(
                icon: headerIcon,
                title: title,
                trailing: d.wordsDue > 0 ? "\(d.wordsDue) due" : nil
            )
            SymplyStatTile(
                value: "\(d.streak)",
                caption: d.streakCaption,
                tint: streakTint(d)
            )
            if d.hasXP {
                SymplyStatTile(
                    value: d.xpProgress,
                    caption: "XP today",
                    tint: xpTint(d)
                )
            } else {
                SymplyStatTile(
                    value: "\(d.wordsDue)",
                    caption: d.wordsDueCaption,
                    tint: wordsDueTint(d)
                )
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Medium — two stat tiles + the next lesson row

    @ViewBuilder
    private func medium(_ d: LanguageWidgetData) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(
                icon: headerIcon,
                title: title,
                trailing: d.streakTrailing,
                tint: streakTint(d)
            )
            HStack(spacing: SymplyLayout.gap) {
                SymplyStatTile(
                    value: d.hasXP ? d.xpProgress : "\(d.streak)",
                    caption: d.hasXP ? "XP today" : d.streakCaption,
                    tint: d.hasXP ? xpTint(d) : streakTint(d)
                )
                SymplyStatTile(
                    value: "\(d.wordsDue)",
                    caption: d.wordsDueCaption,
                    tint: wordsDueTint(d)
                )
            }
            Spacer(minLength: 0)
            SymplyListRow(
                icon: d.hasNextLesson ? d.nextLessonIcon : "checkmark.circle.fill",
                text: d.nextLessonTitle,
                detail: d.hasNextLesson ? "Next" : nil,
                tint: d.hasNextLesson ? BrandTokens.primary : WidgetTheme.green
            )
        }
    }
}
