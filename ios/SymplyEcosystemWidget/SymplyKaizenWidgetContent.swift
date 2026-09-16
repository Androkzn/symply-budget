//
//  SymplyKaizenWidgetContent.swift
//  SymplyEcosystemWidget
//
//  Symply Kaizen (habits / self-improvement) widget body. Renders today's
//  habit progress (done/total), the current streak, and the next habit to do.
//  Built ONLY from the shared Symply primitives (WidgetTheme.swift) so it shares
//  the exact same rhythm as every other app's widget. Data comes from the shared
//  App Group `UserDefaults` under the `widget_kaizen_` key namespace.
//

import SwiftUI
import WidgetKit

// MARK: - Data contract (App Group)

/// Decoded from the shared App Group JSON stored at `KaizenWidgetData.todayKey`.
///
/// Shape (written by the app's widget-sync bridge):
/// ```json
/// { "done": 3, "total": 5, "streak": 12,
///   "next_habit": { "title": "Meditate", "icon": "leaf-outline" } }
/// ```
struct KaizenWidgetData: Codable {
    let done: Int
    let total: Int
    let streak: Int
    let nextHabit: NextHabit?

    struct NextHabit: Codable {
        let title: String
        /// Backend Ionicons name; mapped to an SF Symbol via `Ionicon.symbol`.
        let icon: String?
    }

    enum CodingKeys: String, CodingKey {
        case done, total, streak
        case nextHabit = "next_habit"
    }
}

extension KaizenWidgetData {
    /// App Group key namespace for Kaizen. Prefix: `widget_kaizen_`.
    static let todayKey = "widget_kaizen_today"

    /// Convenience loader over the shared App Group store (`WidgetStore.defaults`).
    /// Returns `nil` when signed out / no snapshot has been written yet.
    static func load(from defaults: UserDefaults? = WidgetStore.defaults) -> KaizenWidgetData? {
        guard let data = defaults?.data(forKey: todayKey) else { return nil }
        return try? JSONDecoder().decode(KaizenWidgetData.self, from: data)
    }

    /// Illustrative content for the widget gallery / previews (never real data).
    static let sample = KaizenWidgetData(
        done: 3, total: 5, streak: 12,
        nextHabit: NextHabit(title: "Meditate 10 min", icon: "leaf-outline")
    )
}

// MARK: - View

/// Renders the Kaizen widget for both `systemSmall` and `systemMedium`, from the
/// decoded data (or `nil` → shared empty state). Uses ONLY the Symply primitives.
struct SymplyKaizenWidgetContent: View {
    @Environment(\.widgetFamily) private var family
    let data: KaizenWidgetData?

    /// Header identity — app short name + fitting SF Symbol.
    private let appName = "Kaizen"
    private let headerIcon = "checkmark.seal.fill"

    var body: some View {
        SymplyCard {
            if let data, data.total > 0 {
                switch family {
                case .systemMedium:
                    medium(data)
                default:
                    small(data)
                }
            } else {
                SymplyEmptyState(
                    icon: "checkmark.seal",
                    message: data == nil ? "Sign in to track your habits" : "No habits scheduled today"
                )
            }
        }
    }

    // MARK: systemSmall

    private func small(_ d: KaizenWidgetData) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(
                icon: headerIcon,
                title: appName,
                trailing: d.streak > 0 ? "\(d.streak)d" : nil,
                tint: accent(d)
            )

            SymplyStatTile(
                value: "\(d.done)/\(d.total)",
                caption: isAllDone(d) ? "all done!" : "done today",
                tint: accent(d)
            )

            nextRow(d)

            Spacer(minLength: 0)
        }
    }

    // MARK: systemMedium

    private func medium(_ d: KaizenWidgetData) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(
                icon: headerIcon,
                title: appName,
                trailing: isAllDone(d) ? "Complete" : "\(percent(d))%",
                tint: accent(d)
            )

            HStack(spacing: SymplyLayout.gap) {
                SymplyStatTile(
                    value: "\(d.done)/\(d.total)",
                    caption: "done today",
                    tint: accent(d)
                )
                SymplyStatTile(
                    value: "\(d.streak)",
                    caption: "day streak",
                    tint: d.streak > 0 ? WidgetTheme.amber : accent(d)
                )
            }

            nextRow(d)

            Spacer(minLength: 0)
        }
    }

    // MARK: Shared pieces

    /// Next-habit row, or a celebratory row when everything is done.
    @ViewBuilder
    private func nextRow(_ d: KaizenWidgetData) -> some View {
        if let next = d.nextHabit {
            SymplyListRow(
                icon: Ionicon.symbol(next.icon),
                text: next.title,
                detail: "next",
                tint: accent(d)
            )
        } else if isAllDone(d) {
            SymplyListRow(
                icon: "checkmark.circle.fill",
                text: "All habits complete",
                tint: WidgetTheme.green
            )
        } else {
            SymplyListRow(
                icon: "sparkles",
                text: "Keep your streak going",
                tint: accent(d)
            )
        }
    }

    // MARK: Helpers

    private func isAllDone(_ d: KaizenWidgetData) -> Bool {
        d.total > 0 && d.done >= d.total
    }

    private func percent(_ d: KaizenWidgetData) -> Int {
        guard d.total > 0 else { return 0 }
        let ratio = Double(d.done) / Double(d.total)
        return Int((ratio * 100).rounded())
    }

    /// Brand accent, or the semantic "good" green when all habits are done.
    private func accent(_ d: KaizenWidgetData) -> Color {
        isAllDone(d) ? WidgetTheme.green : BrandTokens.primary
    }
}
