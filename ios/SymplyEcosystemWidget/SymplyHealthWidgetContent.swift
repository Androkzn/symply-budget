//
//  SymplyHealthWidgetContent.swift
//  SymplyEcosystemWidget
//
//  Symply Health widget body. Full donor feature parity (Small: 3 styles;
//  Medium: 3 layouts; Large: activity rings + nutrition macros + weekly
//  weight/calories trend chart), re-skinned onto the shared Symply widget kit
//  (SymplyCard / SymplyHeader / SymplyStatTile / SymplyListRow /
//  SymplyEmptyState + BrandTokens) instead of the donor's own aurora
//  background and bespoke chrome. Per-metric colors (steps=green,
//  calories=amber, water=cyan, exercise=blue, weight=purple) are kept as-is —
//  they are a universal health-data-viz convention, not donor branding.
//
//  Data contract (App Group `UserDefaults`, written by the RN app — see
//  `src/features/health/healthWidgetStorage.ts`), key "widget_health_today":
//    {
//      "steps": 7240, "steps_goal": 10000,
//      "water_ml": 1200, "water_goal_ml": 2000,
//      "move_pct": 0.68,
//      "next_reminder": { "title": "Evening walk", "at": "2026-07-13T18:30:00Z" } | null,
//      "weight": { "value": 70.5, "unit": "kg", "date": "2026-07-13" } | null,
//      "weight_trend": {
//        "unit": "kg", "entries": [{ "date": "2026-07-13", "weight": 70.5 }, …],
//        "avg_this_week": 70.8, "avg_last_week": 71.2,
//        "starting_weight_kg": 80, "starting_weight_date": "2026-01-01",
//        "progress_from_start": -9.5, "progress_percentage": -11.9
//      } | null,
//      "nutrition": {
//        "calories": 1450, "proteins": 90, "carbohydrates": 140, "fats": 50,
//        "goal_calories": 2000, "protein_target": 120, "carbs_target": 250, "fats_target": 65
//      } | null,
//      "nutrition_trend": { "entries": [{ "date": "2026-07-13", "calories": 1800 }, …], "avg_this_week": 1750, "avg_last_week": 1900 } | null,
//      "workouts": { "count": 1, "minutes": 20, "calories": 150, "goal_minutes": 30 } | null,
//      "preferences": {
//        "small_widget_metric": "steps", "small_widget_style": "standard",
//        "medium_widget_layout": "standard", "medium_primary_metric": "steps",
//        "medium_secondary_metric": "calories", "medium_show_all_metrics": true,
//        "chart_type": "bar", "chart_metric": "weight",
//        "show_weight": true, "show_nutrition": true, "show_workouts": true
//      } | null
//    }
//
//  `weight` / `weight_trend` / `nutrition` / `nutrition_trend` / `workouts` are
//  `null` exactly when the member's matching `show_*` toggle is off — presence
//  of the data IS the gate, so this file never reads a `show_*` flag directly.
//
//  There is no HealthKit "active calories burned" figure in this data model —
//  "Calories" everywhere in this widget means nutrition calories CONSUMED
//  against the daily target (matching how the backend's `small.metric`
//  resolves "calories" — see `HealthAssetsService.widgetSnapshot`). There is
//  also no distinct "walking minutes" metric, so the Large family renders 4
//  rings (steps / calories / water / workouts), not the donor's 5.
//

import WidgetKit
import SwiftUI

// MARK: - Entry model

struct HealthWidgetData: Codable {
    let steps: Int?
    let stepsGoal: Int?
    let waterMl: Int?
    let waterGoalMl: Int?
    let movePct: Double?
    let nextReminder: HealthReminder?
    let weight: WeightToday?
    let weightTrend: WeightTrend?
    let nutrition: NutritionToday?
    let nutritionTrend: NutritionTrend?
    let workouts: WorkoutsToday?
    let preferences: WidgetPreferences?

    enum CodingKeys: String, CodingKey {
        case steps
        case stepsGoal = "steps_goal"
        case waterMl = "water_ml"
        case waterGoalMl = "water_goal_ml"
        case movePct = "move_pct"
        case nextReminder = "next_reminder"
        case weight
        case weightTrend = "weight_trend"
        case nutrition
        case nutritionTrend = "nutrition_trend"
        case workouts
        case preferences
    }

    struct HealthReminder: Codable {
        let title: String?
        let at: String?
    }

    struct WeightToday: Codable {
        let value: Double
        let unit: String
        let date: String
    }

    struct WeightPoint: Codable {
        let date: String
        let weight: Double
    }

    struct WeightTrend: Codable {
        let unit: String
        let entries: [WeightPoint]
        let avgThisWeek: Double?
        let avgLastWeek: Double?
        let startingWeightKg: Double?
        let startingWeightDate: String?
        let progressFromStart: Double?
        let progressPercentage: Double?

        enum CodingKeys: String, CodingKey {
            case unit, entries
            case avgThisWeek = "avg_this_week"
            case avgLastWeek = "avg_last_week"
            case startingWeightKg = "starting_weight_kg"
            case startingWeightDate = "starting_weight_date"
            case progressFromStart = "progress_from_start"
            case progressPercentage = "progress_percentage"
        }
    }

    struct NutritionToday: Codable {
        let calories: Double
        let proteins: Double
        let carbohydrates: Double
        let fats: Double
        let goalCalories: Int?
        let proteinTarget: Double?
        let carbsTarget: Double?
        let fatsTarget: Double?

        enum CodingKeys: String, CodingKey {
            case calories, proteins, carbohydrates, fats
            case goalCalories = "goal_calories"
            case proteinTarget = "protein_target"
            case carbsTarget = "carbs_target"
            case fatsTarget = "fats_target"
        }
    }

    struct CaloriesPoint: Codable {
        let date: String
        let calories: Int
    }

    struct NutritionTrend: Codable {
        let entries: [CaloriesPoint]
        let avgThisWeek: Double
        let avgLastWeek: Double

        enum CodingKeys: String, CodingKey {
            case entries
            case avgThisWeek = "avg_this_week"
            case avgLastWeek = "avg_last_week"
        }
    }

    struct WorkoutsToday: Codable {
        let count: Int
        let minutes: Int
        let calories: Int
        let goalMinutes: Int?

        enum CodingKeys: String, CodingKey {
            case count, minutes, calories
            case goalMinutes = "goal_minutes"
        }
    }

    /// Layout choices. Mirrors `HealthWidgetPreferences` (`src/api/healthAssets.ts`).
    /// A `nil` field (older cached payload, or a fresh account) falls back to
    /// the "standard everything" default via the `resolved*` accessors below.
    struct WidgetPreferences: Codable {
        let smallWidgetMetric: String?
        let smallWidgetStyle: String?
        let mediumWidgetLayout: String?
        let mediumPrimaryMetric: String?
        let mediumSecondaryMetric: String?
        let mediumShowAllMetrics: Bool?
        let chartType: String?
        let chartMetric: String?

        enum CodingKeys: String, CodingKey {
            case smallWidgetMetric = "small_widget_metric"
            case smallWidgetStyle = "small_widget_style"
            case mediumWidgetLayout = "medium_widget_layout"
            case mediumPrimaryMetric = "medium_primary_metric"
            case mediumSecondaryMetric = "medium_secondary_metric"
            case mediumShowAllMetrics = "medium_show_all_metrics"
            case chartType = "chart_type"
            case chartMetric = "chart_metric"
        }
    }
}

// MARK: - App Group loader

extension HealthWidgetData {
    static let todayKey = "widget_health_today"

    /// Gated on `isSignedIn` (household present), NOT `isAuthenticated`: the product
    /// JWT is never written to the App Group, so requiring `auth_token` here left the
    /// widget permanently on the empty state even when signed in.
    static func load(from defaults: UserDefaults? = WidgetStore.defaults) -> HealthWidgetData? {
        guard WidgetStore.isSignedIn(in: defaults), let defaults else { return nil }
        if let data = defaults.data(forKey: todayKey) {
            return try? JSONDecoder().decode(HealthWidgetData.self, from: data)
        }
        if let string = defaults.string(forKey: todayKey), let data = string.data(using: .utf8) {
            return try? JSONDecoder().decode(HealthWidgetData.self, from: data)
        }
        return nil
    }

    /// Illustrative content for the widget gallery / previews (never real data).
    static let sample: HealthWidgetData = {
        let at = ISO8601DateFormatter().string(
            from: Calendar.current.date(byAdding: .hour, value: 3, to: Date()) ?? Date()
        )
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let today = calendar.startOfDay(for: Date())
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = calendar.timeZone
        func key(_ offset: Int) -> String {
            formatter.string(from: calendar.date(byAdding: .day, value: offset, to: today) ?? today)
        }
        return HealthWidgetData(
            steps: 7_240,
            stepsGoal: 10_000,
            waterMl: 1_200,
            waterGoalMl: 2_000,
            movePct: 0.68,
            nextReminder: HealthReminder(title: "Evening walk", at: at),
            weight: WeightToday(value: 70.5, unit: "kg", date: key(0)),
            weightTrend: WeightTrend(
                unit: "kg",
                entries: [
                    WeightPoint(date: key(-2), weight: 71.2),
                    WeightPoint(date: key(-1), weight: 70.9),
                    WeightPoint(date: key(0), weight: 70.5),
                ],
                avgThisWeek: 70.9,
                avgLastWeek: 71.6,
                startingWeightKg: 80,
                startingWeightDate: "2026-01-01",
                progressFromStart: -9.5,
                progressPercentage: -11.9
            ),
            nutrition: NutritionToday(
                calories: 1_450, proteins: 90, carbohydrates: 140, fats: 50,
                goalCalories: 2_000, proteinTarget: 120, carbsTarget: 250, fatsTarget: 65
            ),
            nutritionTrend: NutritionTrend(
                entries: (0..<7).map { CaloriesPoint(date: key($0 - 6), calories: [1800, 1650, 2100, 1900, 0, 1750, 1450][$0]) },
                avgThisWeek: 1750,
                avgLastWeek: 1900
            ),
            workouts: WorkoutsToday(count: 1, minutes: 20, calories: 150, goalMinutes: 30),
            preferences: WidgetPreferences(
                smallWidgetMetric: "steps", smallWidgetStyle: "standard",
                mediumWidgetLayout: "standard", mediumPrimaryMetric: "steps", mediumSecondaryMetric: "calories",
                mediumShowAllMetrics: true, chartType: "bar", chartMetric: "both"
            )
        )
    }()
}

// MARK: - Resolved preferences (nil-safe defaults matching DEFAULT_HEALTH_WIDGET_PREFERENCES)
//
// Internal (not private): exercised directly by HealthWidgetDataTests via
// `@testable import`, which only sees `internal`-and-above members.

extension HealthWidgetData {
    var resolvedSmallMetric: String { preferences?.smallWidgetMetric ?? "steps" }
    var resolvedSmallStyle: String { preferences?.smallWidgetStyle ?? "standard" }
    var resolvedMediumLayout: String { preferences?.mediumWidgetLayout ?? "standard" }
    var resolvedMediumPrimary: String { preferences?.mediumPrimaryMetric ?? "steps" }
    var resolvedMediumSecondary: String { preferences?.mediumSecondaryMetric ?? "calories" }
    var resolvedMediumShowAll: Bool { preferences?.mediumShowAllMetrics ?? true }
    var resolvedChartType: String { preferences?.chartType ?? "bar" }
    var resolvedChartMetric: String { preferences?.chartMetric ?? "weight" }
}

// MARK: - Per-metric display (shared by Small / Medium / Large)

/// One of the four metrics a Small/Medium/Large slot can show. "calories"
/// means nutrition calories CONSUMED (see file header) — not a burned figure.
private struct HealthMetricInfo {
    let label: String
    let value: String
    let goalText: String?
    let progress: Double?
    let color: Color
    let icon: String
}

private func healthMetricInfo(_ metric: String, _ data: HealthWidgetData) -> HealthMetricInfo {
    switch metric {
    case "calories":
        let value = data.nutrition?.calories
        let goal = data.nutrition?.goalCalories
        return HealthMetricInfo(
            label: "Calories",
            value: value.map { "\(Int($0))" } ?? "—",
            goalText: goal.map { "\($0) kcal" },
            progress: progressFraction(value, goal.map(Double.init)),
            color: WidgetTheme.amber,
            icon: "flame.fill"
        )
    case "water":
        let value = data.waterMl
        let goal = data.waterGoalMl
        return HealthMetricInfo(
            label: "Water",
            value: value.map(HealthFormat.liters) ?? "—",
            goalText: goal.map(HealthFormat.liters),
            progress: progressFraction(value.map(Double.init), goal.map(Double.init)),
            color: .cyan,
            icon: "drop.fill"
        )
    case "workout":
        let value = data.workouts?.minutes
        let goal = data.workouts?.goalMinutes
        return HealthMetricInfo(
            label: "Exercise",
            value: value.map { "\($0)m" } ?? "—",
            goalText: goal.map { "\($0)m" },
            progress: progressFraction(value.map(Double.init), goal.map(Double.init)),
            color: .blue,
            icon: "figure.run"
        )
    default: // steps
        let value = data.steps
        let goal = data.stepsGoal
        return HealthMetricInfo(
            label: "Steps",
            value: value.map(HealthFormat.grouped) ?? "—",
            goalText: goal.map(HealthFormat.grouped),
            progress: progressFraction(value.map(Double.init), goal.map(Double.init)),
            color: WidgetTheme.green,
            icon: "figure.walk"
        )
    }
}

private func progressFraction(_ value: Double?, _ goal: Double?) -> Double? {
    guard let value, let goal, goal > 0 else { return nil }
    return min(max(value / goal, 0), 1)
}

private enum HealthFormat {
    static func grouped(_ n: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: n)) ?? "\(n)"
    }

    static func liters(_ ml: Int) -> String {
        String(format: "%.1fL", Double(ml) / 1000.0)
    }

    static func signed(_ value: Double, digits: Int = 1) -> String {
        let sign = value > 0 ? "+" : ""
        return "\(sign)\(String(format: "%.\(digits)f", value))"
    }
}

// MARK: - Reminder + move display helpers

private extension HealthWidgetData {
    var resolvedMovePct: Int? {
        guard let raw = movePct else { return nil }
        let pct = raw <= 1.0 ? raw * 100 : raw
        return Int(pct.rounded())
    }

    var movePctText: String? { resolvedMovePct.map { "\($0)%" } }
    var moveTint: Color { (resolvedMovePct ?? 0) >= 100 ? WidgetTheme.green : BrandTokens.primary }

    var reminderTitle: String? {
        guard let title = nextReminder?.title, !title.isEmpty else { return nil }
        return title
    }

    var reminderTimeLabel: String? {
        guard let at = nextReminder?.at, !at.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        if let date = withFraction.date(from: at) ?? plain.date(from: at) {
            let formatter = DateFormatter()
            formatter.timeStyle = .short
            formatter.dateStyle = .none
            return formatter.string(from: date)
        }
        return at
    }
}

// MARK: - Deep links

/// `simplehealth://<section>` — scoped to this file rather than the shared
/// `WidgetLink.swift`, which hardcodes the House brand's own scheme.
private enum HealthWidgetLink {
    static let scheme = "simplehealth"

    static func url(_ path: String) -> URL {
        URL(string: "\(scheme)://\(path)") ?? URL(string: "\(scheme)://")!
    }

    static func forMetric(_ metric: String) -> URL {
        switch metric {
        case "calories": return url("nutrition")
        case "water": return url("water")
        case "workout": return url("workouts")
        default: return url("steps")
        }
    }

    static let weight = url("weight")
    static let nutrition = url("nutrition")
}

// MARK: - Content view

/// Renders the Symply Health widget for `systemSmall` / `systemMedium` /
/// `systemLarge`. Pass the decoded snapshot (or `nil` for signed-out / no-data).
struct SymplyHealthWidgetContent: View {
    let data: HealthWidgetData?
    var family: WidgetFamily? = nil

    @Environment(\.widgetFamily) private var environmentFamily

    fileprivate static let headerIcon = "heart.fill"
    fileprivate static let headerTitle = "Health"

    private var resolvedFamily: WidgetFamily { family ?? environmentFamily }

    var body: some View {
        SymplyCard {
            if let data {
                switch resolvedFamily {
                case .systemSmall:
                    SmallHealthLayout(data: data)
                case .systemLarge:
                    LargeHealthLayout(data: data)
                default:
                    MediumHealthLayout(data: data)
                }
            } else {
                SymplyEmptyState(
                    icon: "heart.text.square",
                    message: "Open Symply Health to track your day"
                )
            }
        }
    }
}

// MARK: - Small (3 styles: standard / compact / minimal)

private struct SmallHealthLayout: View {
    let data: HealthWidgetData
    @Environment(\.colorScheme) private var scheme

    private var primary: HealthMetricInfo { healthMetricInfo(data.resolvedSmallMetric, data) }

    var body: some View {
        switch data.resolvedSmallStyle {
        case "compact":
            compact
        case "minimal":
            minimal
        default:
            standard
        }
    }

    private var standard: some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(
                icon: SymplyHealthWidgetContent.headerIcon,
                title: SymplyHealthWidgetContent.headerTitle,
                trailing: data.movePctText,
                tint: data.moveTint
            )

            VStack(alignment: .leading, spacing: SymplyLayout.tightGap) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(primary.value)
                        .font(BrandTokens.font(26, .bold))
                        .foregroundStyle(BrandTokens.primaryText(scheme))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if let goal = primary.goalText {
                        Text("/ \(goal)")
                            .font(BrandTokens.font(11, .medium))
                            .foregroundStyle(BrandTokens.primaryText(scheme).opacity(0.55))
                    }
                }
                if let progress = primary.progress {
                    ProgressCapsule(progress: progress, tint: primary.color)
                }
            }

            Spacer(minLength: 0)

            HStack(spacing: SymplyLayout.gap) {
                ForEach(otherMetrics, id: \.self) { metric in
                    let info = healthMetricInfo(metric, data)
                    MiniMetric(icon: info.icon, value: info.value, color: info.color)
                }
            }
        }
    }

    private var compact: some View {
        VStack(spacing: SymplyLayout.gap) {
            SymplyHeader(icon: primary.icon, title: primary.label, tint: primary.color)
            Spacer(minLength: 0)
            ZStack {
                if let progress = primary.progress {
                    Circle().stroke(primary.color.opacity(scheme == .dark ? 0.22 : 0.15), lineWidth: 8)
                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(primary.color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                VStack(spacing: 0) {
                    Text(primary.value)
                        .font(BrandTokens.font(20, .bold))
                        .foregroundStyle(BrandTokens.primaryText(scheme))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                }
            }
            .frame(width: 84, height: 84)
            Spacer(minLength: 0)
            if let progress = primary.progress, let goal = primary.goalText {
                Text("\(Int(progress * 100))% of \(goal)")
                    .font(BrandTokens.font(10, .medium))
                    .foregroundStyle(BrandTokens.primaryText(scheme).opacity(0.6))
            }
        }
    }

    private var minimal: some View {
        VStack(spacing: 4) {
            Spacer(minLength: 0)
            Image(systemName: primary.icon)
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(primary.color)
            Text(primary.value)
                .font(BrandTokens.font(36, .bold))
                .foregroundStyle(BrandTokens.primaryText(scheme))
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            if let goal = primary.goalText {
                Text("/ \(goal)")
                    .font(BrandTokens.font(11, .medium))
                    .foregroundStyle(BrandTokens.primaryText(scheme).opacity(0.5))
            }
            Spacer(minLength: 0)
        }
    }

    private var otherMetrics: [String] {
        ["steps", "calories", "water"].filter { $0 != data.resolvedSmallMetric }
    }
}

// MARK: - Medium (3 layouts: standard / dual / grid)

private struct MediumHealthLayout: View {
    let data: HealthWidgetData

    var body: some View {
        switch data.resolvedMediumLayout {
        case "dual":
            dual
        case "grid":
            grid
        default:
            standard
        }
    }

    private var standard: some View {
        let primary = healthMetricInfo(data.resolvedMediumPrimary, data)
        return HStack(spacing: SymplyLayout.gutter) {
            VStack(alignment: .leading, spacing: SymplyLayout.tightGap) {
                SymplyHeader(icon: primary.icon, title: primary.label, tint: primary.color)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(primary.value).font(BrandTokens.font(28, .bold))
                    if let goal = primary.goalText {
                        Text("/ \(goal)").font(BrandTokens.font(12, .medium)).opacity(0.55)
                    }
                }
                if let progress = primary.progress {
                    ProgressCapsule(progress: progress, tint: primary.color)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if data.resolvedMediumShowAll {
                VStack(alignment: .leading, spacing: SymplyLayout.gap) {
                    ForEach(otherMetrics(excluding: data.resolvedMediumPrimary), id: \.self) { metric in
                        let info = healthMetricInfo(metric, data)
                        SymplyListRow(icon: info.icon, text: info.value, detail: info.label, tint: info.color)
                    }
                }
                .frame(width: 130)
            }
        }
    }

    private var dual: some View {
        HStack(spacing: SymplyLayout.gap) {
            MetricCard(info: healthMetricInfo(data.resolvedMediumPrimary, data))
            MetricCard(info: healthMetricInfo(data.resolvedMediumSecondary, data))
        }
    }

    private var grid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: SymplyLayout.tightGap) {
            ForEach(["steps", "calories", "water", "workout"], id: \.self) { metric in
                GridCell(info: healthMetricInfo(metric, data))
            }
        }
    }

    private func otherMetrics(excluding primary: String) -> [String] {
        ["steps", "calories", "water", "workout"].filter { $0 != primary }
    }
}

private struct MetricCard: View {
    let info: HealthMetricInfo
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: SymplyLayout.tightGap) {
            HStack(spacing: 4) {
                Image(systemName: info.icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(info.color)
                Text(info.label).font(BrandTokens.font(11, .medium)).foregroundStyle(BrandTokens.primaryText(scheme).opacity(0.65))
            }
            Text(info.value)
                .font(BrandTokens.font(22, .bold))
                .foregroundStyle(BrandTokens.primaryText(scheme))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let progress = info.progress {
                ProgressCapsule(progress: progress, tint: info.color, height: 5)
            }
        }
        .padding(SymplyLayout.gap)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(info.color.opacity(scheme == .dark ? 0.10 : 0.07), in: RoundedRectangle(cornerRadius: SymplyLayout.tileCorner, style: .continuous))
    }
}

private struct GridCell: View {
    let info: HealthMetricInfo
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: info.icon).font(.system(size: 10, weight: .semibold)).foregroundStyle(info.color)
                Text(info.label).font(BrandTokens.font(9, .medium)).foregroundStyle(BrandTokens.primaryText(scheme).opacity(0.6))
            }
            Text(info.value).font(BrandTokens.font(16, .bold)).foregroundStyle(BrandTokens.primaryText(scheme)).lineLimit(1).minimumScaleFactor(0.7)
            if let progress = info.progress {
                ProgressCapsule(progress: progress, tint: info.color, height: 4)
            }
        }
        .padding(SymplyLayout.tightGap)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(info.color.opacity(scheme == .dark ? 0.08 : 0.05), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

// MARK: - Large (rings + nutrition macros + weekly trend chart)

private struct LargeHealthLayout: View {
    let data: HealthWidgetData

    private var hasNutrition: Bool { data.nutrition != nil }
    private var hasTrend: Bool { data.weightTrend != nil || data.nutritionTrend != nil }

    var body: some View {
        VStack(spacing: SymplyLayout.gap) {
            HStack(spacing: SymplyLayout.tightGap) {
                ForEach(["steps", "calories", "water", "workout"], id: \.self) { metric in
                    Link(destination: HealthWidgetLink.forMetric(metric)) {
                        RingTile(info: healthMetricInfo(metric, data))
                    }
                }
            }

            if let nutrition = data.nutrition {
                Divider()
                Link(destination: HealthWidgetLink.nutrition) {
                    NutritionSection(nutrition: nutrition)
                }
            }

            if data.weightTrend != nil || data.nutritionTrend != nil {
                Divider()
                Link(destination: HealthWidgetLink.weight) {
                    TrendSection(data: data)
                }
            }

            // Neither section has anything to draw yet (no meals/weigh-ins logged,
            // or their show_* toggles are off) — without this the card is just the
            // ring row pinned to the top of an otherwise-empty large widget, which
            // reads as broken rather than as an empty day.
            if !hasNutrition && !hasTrend {
                Spacer(minLength: 0)
                Link(destination: HealthWidgetLink.nutrition) {
                    SymplyEmptyState(
                        icon: "fork.knife.circle",
                        message: "Log a meal or weigh in to fill in your day"
                    )
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct RingTile: View {
    let info: HealthMetricInfo

    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                Circle().stroke(info.color.opacity(0.2), lineWidth: 4).frame(width: 40, height: 40)
                if let progress = info.progress {
                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(info.color, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .frame(width: 40, height: 40)
                        .rotationEffect(.degrees(-90))
                }
                Image(systemName: info.icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(info.color)
            }
            Text(info.value).font(BrandTokens.font(11, .bold)).lineLimit(1).minimumScaleFactor(0.7)
            Text(info.label).font(BrandTokens.font(8, .medium)).opacity(0.6).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct NutritionSection: View {
    let nutrition: HealthWidgetData.NutritionToday

    var body: some View {
        VStack(alignment: .leading, spacing: SymplyLayout.tightGap) {
            HStack {
                Image(systemName: "fork.knife").font(.system(size: 11, weight: .semibold)).foregroundStyle(WidgetTheme.amber)
                Text("Nutrition").font(BrandTokens.font(12, .medium)).opacity(0.7)
                Spacer()
                Text("\(Int(nutrition.calories)) / \(nutrition.goalCalories.map { "\($0)" } ?? "—") kcal")
                    .font(BrandTokens.font(11, .medium))
            }
            HStack(spacing: 10) {
                MacroBar(label: "Protein", value: nutrition.proteins, target: nutrition.proteinTarget, color: .red)
                MacroBar(label: "Carbs", value: nutrition.carbohydrates, target: nutrition.carbsTarget, color: .blue)
                MacroBar(label: "Fats", value: nutrition.fats, target: nutrition.fatsTarget, color: .yellow)
            }
        }
    }
}

private struct MacroBar: View {
    let label: String
    let value: Double
    let target: Double?
    let color: Color
    @Environment(\.colorScheme) private var scheme

    private var progress: Double {
        guard let target, target > 0 else { return 0 }
        return min(value / target, 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label).font(BrandTokens.font(9, .medium)).opacity(0.6)
                Spacer()
                Text("\(Int(value))g").font(BrandTokens.font(9, .semibold))
            }
            ProgressCapsule(progress: progress, tint: color, height: 4)
        }
    }
}

private struct TrendSection: View {
    let data: HealthWidgetData
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(alignment: .top, spacing: SymplyLayout.gap) {
            VStack(alignment: .leading, spacing: 3) {
                if data.resolvedChartMetric != "nutrition", let trend = data.weightTrend {
                    WeeklyAverageLabel(title: "This week", value: trend.avgThisWeek.map { String(format: "%.1f", $0) } ?? "—", unit: trend.unit)
                    WeeklyAverageLabel(
                        title: "vs last week",
                        value: weekChangeText(trend),
                        unit: trend.unit,
                        tint: weekChangeTint(trend)
                    )
                    if let progress = trend.progressFromStart, let pct = trend.progressPercentage {
                        WeeklyAverageLabel(
                            title: "From start",
                            value: "\(HealthFormat.signed(progress)) (\(HealthFormat.signed(pct, digits: 1))%)",
                            unit: trend.unit,
                            tint: progress <= 0 ? WidgetTheme.green : .red
                        )
                    }
                }
                if data.resolvedChartMetric != "weight", let trend = data.nutritionTrend {
                    WeeklyAverageLabel(title: "Avg kcal", value: "\(Int(trend.avgThisWeek))", unit: "kcal")
                }
            }
            .frame(width: 84, alignment: .leading)

            WeeklyTrendChart(data: data)
        }
    }

    private func weekChangeText(_ trend: HealthWidgetData.WeightTrend) -> String {
        guard let thisWeek = trend.avgThisWeek, let lastWeek = trend.avgLastWeek else { return "—" }
        return HealthFormat.signed(thisWeek - lastWeek)
    }

    private func weekChangeTint(_ trend: HealthWidgetData.WeightTrend) -> Color {
        guard let thisWeek = trend.avgThisWeek, let lastWeek = trend.avgLastWeek else { return .secondary }
        let change = thisWeek - lastWeek
        if change < -0.1 { return WidgetTheme.green }
        if change > 0.1 { return .red }
        return .secondary
    }
}

private struct WeeklyAverageLabel: View {
    let title: String
    let value: String
    let unit: String
    var tint: Color? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(BrandTokens.font(7, .medium)).opacity(0.55)
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value).font(BrandTokens.font(12, .bold)).foregroundStyle(tint ?? .primary)
                Text(unit).font(BrandTokens.font(7, .medium)).opacity(0.55)
            }
        }
    }
}

/// Weekly weight + calories trend, bar or line depending on `chart_type`.
/// Weight plots only LOGGED days (`weightTrend.entries` is sparse by design);
/// calories plots all 7 days (`nutritionTrend.entries` is zero-filled).
private struct WeeklyTrendChart: View {
    let data: HealthWidgetData

    private struct Day {
        let label: String
        let key: String
        let weight: Double?
        let calories: Int?
        let isToday: Bool
    }

    private var showWeight: Bool { data.resolvedChartMetric != "nutrition" && data.weightTrend != nil }
    private var showCalories: Bool { data.resolvedChartMetric != "weight" && data.nutritionTrend != nil }

    private var days: [Day] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        calendar.firstWeekday = 2
        let today = calendar.startOfDay(for: Date())
        var comps = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: today)
        comps.calendar = calendar
        guard let weekStart = comps.date else { return [] }

        let weightByDate = Dictionary(
            (data.weightTrend?.entries ?? []).map { ($0.date, $0.weight) },
            uniquingKeysWith: { _, latest in latest }
        )
        let caloriesByDate = Dictionary(
            (data.nutritionTrend?.entries ?? []).map { ($0.date, $0.calories) },
            uniquingKeysWith: { _, latest in latest }
        )

        let keyFormatter = DateFormatter()
        keyFormatter.dateFormat = "yyyy-MM-dd"
        keyFormatter.timeZone = calendar.timeZone
        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "E"
        dayFormatter.timeZone = calendar.timeZone

        return (0..<7).compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: offset, to: weekStart) else { return nil }
            let key = keyFormatter.string(from: date)
            return Day(
                label: String(dayFormatter.string(from: date).prefix(1)),
                key: key,
                weight: weightByDate[key],
                calories: caloriesByDate[key],
                isToday: calendar.isDate(date, inSameDayAs: today)
            )
        }
    }

    private var weightRange: (min: Double, max: Double) {
        let values = days.compactMap { $0.weight }
        guard !values.isEmpty else { return (0, 1) }
        return ((values.min() ?? 0) - 1, (values.max() ?? 1) + 1)
    }

    private var caloriesMax: Double {
        let values = days.compactMap { $0.calories }.map(Double.init)
        return max(values.max() ?? 2000, 1) * 1.1
    }

    var body: some View {
        GeometryReader { geo in
            let dayLabelHeight: CGFloat = 12
            let chartHeight = geo.size.height - dayLabelHeight
            let barWidth = (geo.size.width - CGFloat(days.count - 1) * 3) / CGFloat(max(days.count, 1))

            VStack(spacing: 0) {
                ZStack(alignment: .bottom) {
                    if data.resolvedChartType == "line" {
                        lineOverlay(chartHeight: chartHeight, barWidth: barWidth)
                    } else {
                        barRow(chartHeight: chartHeight, barWidth: barWidth)
                    }
                }
                .frame(height: chartHeight)

                HStack(spacing: 3) {
                    ForEach(days, id: \.key) { day in
                        Text(day.label)
                            .font(BrandTokens.font(8, .medium))
                            .foregroundStyle(day.isToday ? .primary : .secondary)
                            .frame(width: barWidth)
                    }
                }
                .frame(height: dayLabelHeight)
            }
        }
    }

    @ViewBuilder
    private func barRow(chartHeight: CGFloat, barWidth: CGFloat) -> some View {
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(days, id: \.key) { day in
                ZStack(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.gray.opacity(0.08)).frame(width: barWidth, height: chartHeight)
                    HStack(alignment: .bottom, spacing: 1) {
                        if showWeight, let weight = day.weight {
                            let h = max(4, chartHeight * (weight - weightRange.min) / (weightRange.max - weightRange.min))
                            RoundedRectangle(cornerRadius: 2)
                                .fill(day.isToday ? Color.purple : Color.purple.opacity(0.5))
                                .frame(width: showCalories ? barWidth / 2 : barWidth, height: h)
                        }
                        if showCalories, let calories = day.calories, calories > 0 {
                            let h = max(4, chartHeight * Double(calories) / caloriesMax)
                            RoundedRectangle(cornerRadius: 2)
                                .fill(day.isToday ? WidgetTheme.amber : WidgetTheme.amber.opacity(0.5))
                                .frame(width: showWeight ? barWidth / 2 : barWidth, height: h)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func lineOverlay(chartHeight: CGFloat, barWidth: CGFloat) -> some View {
        ZStack {
            if showWeight {
                trendLine(
                    points: days.enumerated().compactMap { index, day in
                        day.weight.map { (index, ($0 - weightRange.min) / (weightRange.max - weightRange.min)) }
                    },
                    barWidth: barWidth,
                    chartHeight: chartHeight,
                    color: .purple
                )
            }
            if showCalories {
                trendLine(
                    points: days.enumerated().compactMap { index, day in
                        day.calories.flatMap { $0 > 0 ? (index, Double($0) / caloriesMax) : nil }
                    },
                    barWidth: barWidth,
                    chartHeight: chartHeight,
                    color: WidgetTheme.amber
                )
            }
        }
    }

    @ViewBuilder
    private func trendLine(points: [(Int, Double)], barWidth: CGFloat, chartHeight: CGFloat, color: Color) -> some View {
        Path { path in
            for (offset, point) in points.enumerated() {
                let x = CGFloat(point.0) * (barWidth + 3) + barWidth / 2
                let y = chartHeight - chartHeight * point.1
                if offset == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
            }
        }
        .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

        ForEach(points, id: \.0) { point in
            let x = CGFloat(point.0) * (barWidth + 3) + barWidth / 2
            let y = chartHeight - chartHeight * point.1
            Circle().fill(color).frame(width: 6, height: 6).position(x: x, y: y)
        }
    }
}

// MARK: - Small shared pieces

private struct ProgressCapsule: View {
    let progress: Double
    let tint: Color
    var height: CGFloat = 6
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(tint.opacity(scheme == .dark ? 0.22 : 0.14)).frame(height: height)
                Capsule().fill(tint).frame(width: max(0, geo.size.width * progress), height: height)
            }
        }
        .frame(height: height)
    }
}

private struct MiniMetric: View {
    let icon: String
    let value: String
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundStyle(color)
            Text(value).font(BrandTokens.font(11, .semibold))
        }
    }
}
