//
//  SymplyHouseWidgetContent.swift
//  SymplyEcosystemWidget
//
//  Symply House (appKey "house") home-maintenance widget, built ENTIRELY from the
//  shared Symply Widget kit (`SymplyCard` / `SymplyHeader` / `SymplyStatTile` /
//  `SymplyListRow` / `SymplyEmptyState` in WidgetTheme.swift) so it shares the exact
//  visual rhythm of every other app's widget. Content = overdue task count, the next
//  urgent tasks, and the AI Housekeeper ("Mira") insight line.
//
//  Data source: the shared App Group `UserDefaults` (`WidgetStore.defaults`). It reads
//  the SAME keys the app already writes — `widget_home_insight` (a `HomeInsightData`
//  object, optionally wrapped in a `{ insight: … }` envelope) and `widget_tasks`
//  (a snake_cased `[WidgetTask]`). Both Codable shapes live in WidgetModels.swift and
//  are reused here rather than redefined.
//

import SwiftUI
import WidgetKit

// MARK: - Codable entry model (decoded from the App Group JSON)

/// A render-ready snapshot decoded from the shared App Group store. Composes the
/// existing `HomeInsightData` + `WidgetTask` models (see WidgetModels.swift) so the
/// widget stays byte-compatible with what the app pushes.
struct SymplyHouseWidgetEntry: Codable, Hashable {
    let insight: HomeInsightData?
    let tasks: [WidgetTask]

    /// True when there is anything worth rendering (otherwise show the empty state).
    var hasContent: Bool { insight != nil || !tasks.isEmpty }

    /// Decode the snapshot straight from the shared App Group defaults, tolerating a
    /// raw insight object OR the `{ insight: … }` envelope, and snake_cased tasks.
    /// Returns `nil` when signed out / nothing cached so callers render `SymplyEmptyState`.
    static func load(from defaults: UserDefaults? = WidgetStore.defaults) -> SymplyHouseWidgetEntry? {
        guard let defaults else { return nil }

        var insight: HomeInsightData?
        if let data = defaults.data(forKey: WidgetStore.insightJSONKey) {
            if let direct = try? JSONDecoder().decode(HomeInsightData.self, from: data) {
                insight = direct
            } else {
                insight = try? JSONDecoder().decode(HomeInsightEnvelope.self, from: data).insight
            }
        }

        var tasks: [WidgetTask] = []
        if let data = defaults.data(forKey: WidgetStore.tasksJSONKey) {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            tasks = (try? decoder.decode([WidgetTask].self, from: data)) ?? []
        }

        let entry = SymplyHouseWidgetEntry(insight: insight, tasks: tasks)
        return entry.hasContent ? entry : nil
    }

    /// Illustrative content for the widget gallery / previews (never real data).
    static let sample = SymplyHouseWidgetEntry(
        insight: WidgetSamples.insight,
        tasks: WidgetSamples.tasks
    )
}

// MARK: - Derived, render-ready values

/// Tolerant view-model over the decoded entry — mirrors `Brief` in MiraWidgetViews
/// but expressed for the shared primitives (stat values, counts, insight line).
private struct HouseBrief {
    let entry: SymplyHouseWidgetEntry

    var insight: HomeInsightData? { entry.insight }
    var tasks: [WidgetTask] { entry.tasks }

    /// Active tasks whose due date is already past.
    var overdueCount: Int {
        tasks.filter { task in
            task.isActive != false && (task.dueDate.map(WidgetDueLabel.isOverdue) ?? false)
        }.count
    }

    /// Active tasks overdue or due within the next 7 days.
    var weekCount: Int { WidgetTasks.urgentCount(from: tasks) }

    /// The most pressing tasks, soonest first.
    func nextTasks(limit: Int) -> [WidgetTask] { WidgetTasks.urgent(from: tasks, limit: limit) }

    /// The AI Housekeeper insight line, if the backend composed one.
    var insightLine: String? {
        if let message = insight?.message, !message.isEmpty { return message }
        if let title = insight?.title, !title.isEmpty { return title }
        return nil
    }

    /// SF Symbol for the insight accent (backend sends an Ionicons name).
    var insightIcon: String { Ionicon.symbol(insight?.icon) }

    /// Red the moment anything is overdue; otherwise the brand accent.
    var overdueTint: Color { overdueCount > 0 ? WidgetTheme.urgentRed : BrandTokens.primary }
}

// MARK: - Content view

/// Renders the Symply House widget for `systemSmall` and `systemMedium` using ONLY
/// the shared Symply primitives. Pass the decoded entry (or `nil` when signed out /
/// no data → `SymplyEmptyState`). Family is read from the environment but can be
/// overridden (handy for previews / snapshots).
struct SymplyHouseWidgetContent: View {
    let entry: SymplyHouseWidgetEntry?
    var familyOverride: WidgetFamily? = nil

    @Environment(\.widgetFamily) private var environmentFamily

    /// App short name for the header.
    private static let shortName = "House"

    private var family: WidgetFamily { familyOverride ?? environmentFamily }

    var body: some View {
        SymplyCard {
            if let entry, entry.hasContent {
                let brief = HouseBrief(entry: entry)
                switch family {
                case .systemSmall:
                    small(brief)
                default:
                    medium(brief)
                }
            } else {
                SymplyEmptyState(
                    icon: "house.fill",
                    message: "Sign in to Symply House to see your home at a glance."
                )
            }
        }
    }

    // MARK: systemSmall — one headline stat + the single most urgent line

    @ViewBuilder
    private func small(_ brief: HouseBrief) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(icon: "house.fill", title: Self.shortName)

            SymplyStatTile(
                value: "\(brief.overdueCount)",
                caption: brief.overdueCount == 1 ? "task overdue" : "tasks overdue",
                tint: brief.overdueTint
            )

            Spacer(minLength: 0)

            if let task = brief.nextTasks(limit: 1).first {
                SymplyListRow(
                    icon: "calendar",
                    text: task.title,
                    detail: task.dueDate.map(WidgetDueLabel.short),
                    tint: dueTint(for: task)
                )
            } else if let line = brief.insightLine {
                SymplyListRow(icon: brief.insightIcon, text: line)
            }
        }
    }

    // MARK: systemMedium — twin stats, the insight line, and next tasks

    @ViewBuilder
    private func medium(_ brief: HouseBrief) -> some View {
        // Reserve a task row when there's also an insight line to keep the medium
        // height within budget; otherwise show two tasks.
        let taskLimit = brief.insightLine == nil ? 2 : 1
        let tasks = brief.nextTasks(limit: taskLimit)

        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(
                icon: "house.fill",
                title: Self.shortName,
                trailing: brief.weekCount > 0 ? "\(brief.weekCount) this week" : "All clear"
            )

            HStack(spacing: SymplyLayout.gap) {
                SymplyStatTile(
                    value: "\(brief.overdueCount)",
                    caption: "Overdue",
                    tint: brief.overdueTint
                )
                SymplyStatTile(value: "\(brief.weekCount)", caption: "This week")
            }

            if let line = brief.insightLine {
                SymplyListRow(icon: brief.insightIcon, text: line)
            }

            Spacer(minLength: 0)

            if !tasks.isEmpty {
                VStack(alignment: .leading, spacing: SymplyLayout.tightGap) {
                    ForEach(tasks) { task in
                        SymplyListRow(
                            icon: "calendar",
                            text: task.title,
                            detail: task.dueDate.map(WidgetDueLabel.short),
                            tint: dueTint(for: task)
                        )
                    }
                }
            }
        }
    }

    // MARK: Helpers

    /// Red when overdue, amber when due today, brand accent otherwise — mirrors the
    /// severity dots in MiraWidgetViews so colour meaning stays consistent.
    private func dueTint(for task: WidgetTask) -> Color {
        guard let due = task.dueDate else { return BrandTokens.primary }
        if WidgetDueLabel.isOverdue(due) { return WidgetTheme.urgentRed }
        if WidgetDueLabel.isToday(due) { return WidgetTheme.amber }
        return BrandTokens.primary
    }
}
