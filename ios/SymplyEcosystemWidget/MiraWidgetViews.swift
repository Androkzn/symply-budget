//
//  MiraWidgetViews.swift
//  SymplyEcosystemWidget
//
//  SwiftUI for the small / medium / large families. The large widget is the
//  hero: the full dynamic Mira brief (avatar, greeting, headline, message, due
//  counter) plus the week's most urgent tasks. Small and medium are faithful,
//  progressively condensed versions.
//

import WidgetKit
import SwiftUI

// MARK: - Root entry view

struct MiraWidgetEntryView: View {
    var entry: MiraProvider.Entry
    @Environment(\.widgetFamily) private var family

    private var content: WidgetContent { entry.content }

    var body: some View {
        contentView
            .widgetURL(WidgetLink.primary(for: content))
            .widgetContainerBackground { ToneBackground(tone: content.insight?.tone ?? "calm") }
    }

    @ViewBuilder
    private var contentView: some View {
        if content.isLoggedOut {
            LoggedOutView()
        } else {
            switch family {
            case .systemSmall:
                SmallMiraView(content: content)
            case .systemMedium:
                MediumMiraView(content: content)
            default:
                LargeMiraView(content: content)
            }
        }
    }
}

// MARK: - Shared derived values

/// Effective, render-ready values for a widget, tolerant of a missing insight.
struct Brief {
    let content: WidgetContent
    var insight: HomeInsightData? { content.insight }
    var tone: String { insight?.tone ?? "calm" }
    var accent: Color { WidgetTheme.colors(for: tone).accent }

    var greeting: String { insight?.greeting ?? "Hello" }

    var title: String {
        if let t = insight?.title, !t.isEmpty { return t }
        let n = WidgetTasks.urgentCount(from: content.tasks)
        if n == 0 { return "All clear" }
        return n == 1 ? "1 task this week" : "\(n) tasks this week"
    }

    var message: String {
        if let m = insight?.message, !m.isEmpty { return m }
        if let first = WidgetTasks.urgent(from: content.tasks, limit: 1).first, let due = first.dueDate {
            return "\u{201C}\(first.title)\u{201D} is due \(WidgetDueLabel.short(for: due).lowercased())."
        }
        return "Everything's on track — nothing needs you right now."
    }

    var headlineIcon: String { Ionicon.symbol(insight?.icon) }
    var dueLabel: String? { insight?.dueLabel }
    var attentionCount: Int { insight?.attentionCount ?? WidgetTasks.urgentCount(from: content.tasks) }
    var ctaLabel: String { insight?.cta?.label ?? (content.tasks.isEmpty ? "Ask Mira" : "Review tasks") }
}

// MARK: - Small

struct SmallMiraView: View {
    let content: WidgetContent
    private var brief: Brief { Brief(content: content) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                MiraAvatar(size: 34, accent: brief.accent)
                Spacer()
                CountBadge(count: brief.attentionCount, accent: brief.accent)
            }

            Spacer(minLength: 2)

            HStack(spacing: 5) {
                Image(systemName: brief.headlineIcon)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(brief.accent)
                Text(brief.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
            }

            if let due = brief.dueLabel ?? topTaskDue {
                DuePill(label: due, accent: brief.accent, compact: true)
            } else {
                Text(brief.greeting)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
    }

    private var topTaskDue: String? {
        guard let t = WidgetTasks.urgent(from: content.tasks, limit: 1).first, let d = t.dueDate else { return nil }
        return WidgetDueLabel.short(for: d)
    }
}

// MARK: - Medium

struct MediumMiraView: View {
    let content: WidgetContent
    private var brief: Brief { Brief(content: content) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            MiraHeader(brief: brief)

            HStack(spacing: 5) {
                Image(systemName: brief.headlineIcon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(brief.accent)
                Text(brief.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.primary)
                    .lineLimit(1)
            }

            Text(brief.message)
                .font(.system(size: 13))
                .foregroundColor(.primary.opacity(0.85))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)

            if let task = WidgetTasks.urgent(from: content.tasks, limit: 1).first {
                TaskRow(task: task, dense: true)
            } else if let due = brief.dueLabel {
                DuePill(label: due, accent: brief.accent, compact: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
    }
}

// MARK: - Large

struct LargeMiraView: View {
    let content: WidgetContent
    private var brief: Brief { Brief(content: content) }

    private var tasks: [WidgetTask] { WidgetTasks.urgent(from: content.tasks, limit: 3) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MiraHeader(brief: brief)

            HStack(spacing: 6) {
                Image(systemName: brief.headlineIcon)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(brief.accent)
                Text(brief.title)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.primary)
                    .lineLimit(2)
            }

            Text(brief.message)
                .font(.system(size: 14))
                .foregroundColor(.primary.opacity(0.9))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            if let due = brief.dueLabel {
                DuePill(label: due, accent: brief.accent, compact: false)
            }

            Spacer(minLength: 2)

            if !tasks.isEmpty {
                Divider().opacity(0.5)
                Text(tasks.count == 1 ? "URGENT TASK" : "URGENT TASKS")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundColor(.secondary)
                    .tracking(0.6)
                VStack(spacing: 7) {
                    ForEach(tasks) { task in
                        Link(destination: WidgetLink.tasks) {
                            TaskRow(task: task, dense: false)
                        }
                    }
                }
            } else if let insight = content.insight, !insight.chips.isEmpty {
                Divider().opacity(0.5)
                ChipsRow(chips: insight.chips)
            }

            Spacer(minLength: 0)

            FooterRow(label: brief.ctaLabel, accent: brief.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
    }
}

// MARK: - Building blocks

struct MiraHeader: View {
    let brief: Brief

    var body: some View {
        // SymplyEcosystem wordmark on the leading edge, the Mira identity centered,
        // and the attention badge trailing. The Spacers center the Mira block in
        // the space between the two side elements.
        HStack(spacing: 8) {
            AppLogo(height: 18)
            Spacer(minLength: 6)
            HStack(spacing: 8) {
                MiraAvatar(size: 34, accent: brief.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Mira")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(brief.accent)
                    Text(brief.greeting)
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            CountBadge(count: brief.attentionCount, accent: brief.accent)
        }
    }
}

/// SymplyEcosystem horizontal wordmark (logo-horizontal.png). Sized by height; the
/// width scales with the image's aspect ratio.
struct AppLogo: View {
    var height: CGFloat = 18

    var body: some View {
        Image("AppLogo")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(height: height)
            .accessibilityLabel("SymplyEcosystem")
    }
}

struct MiraAvatar: View {
    let size: CGFloat
    let accent: Color

    var body: some View {
        Image("MiraAvatar")
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: size, height: size)
            .background(Color.white)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(accent.opacity(0.25), lineWidth: 1))
    }
}

struct CountBadge: View {
    let count: Int
    let accent: Color

    var body: some View {
        if count > 0 {
            Text(count > 9 ? "9+" : "\(count)")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.white)
                .frame(minWidth: 22, minHeight: 22)
                .padding(.horizontal, 5)
                .background(Capsule().fill(accent))
        } else {
            Image(systemName: "sparkles")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(accent)
        }
    }
}

struct DuePill: View {
    let label: String
    let accent: Color
    let compact: Bool

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "clock.fill")
                .font(.system(size: compact ? 9 : 11, weight: .semibold))
            Text(label)
                .font(.system(size: compact ? 11 : 12, weight: .semibold))
                .lineLimit(1)
        }
        .foregroundColor(accent)
        .padding(.horizontal, compact ? 8 : 10)
        .padding(.vertical, compact ? 3 : 5)
        .background(Capsule().fill(accent.opacity(0.15)))
    }
}

struct TaskRow: View {
    let task: WidgetTask
    let dense: Bool

    private var due: Date? { task.dueDate }
    private var overdue: Bool { due.map(WidgetDueLabel.isOverdue) ?? false }
    private var today: Bool { due.map(WidgetDueLabel.isToday) ?? false }

    private var dotColor: Color {
        if overdue { return WidgetTheme.urgentRed }
        if today { return WidgetTheme.amber }
        return WidgetTheme.mint
    }

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(dotColor)
                .frame(width: 7, height: 7)
            Text(task.title)
                .font(.system(size: dense ? 12 : 13, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(1)
            Spacer(minLength: 6)
            if let due {
                Text(WidgetDueLabel.short(for: due))
                    .font(.system(size: dense ? 11 : 11, weight: .semibold))
                    .foregroundColor(dotColor)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, dense ? 5 : 0)
        .padding(.horizontal, dense ? 9 : 0)
        .background(
            dense ? AnyView(RoundedRectangle(cornerRadius: 9).fill(dotColor.opacity(0.10))) : AnyView(Color.clear)
        )
    }
}

struct ChipsRow: View {
    let chips: [InsightChip]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(chips.prefix(3).enumerated()), id: \.offset) { _, chip in
                HStack(spacing: 6) {
                    Image(systemName: Ionicon.symbol(chip.icon))
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                    Text(chip.label)
                        .font(.system(size: 12))
                        .foregroundColor(.primary.opacity(0.85))
                        .lineLimit(1)
                    if let due = chip.dueLabel {
                        Text("· \(due)")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}

struct FooterRow: View {
    let label: String
    let accent: Color

    var body: some View {
        HStack {
            Spacer()
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(accent)
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(accent)
        }
    }
}

struct LoggedOutView: View {
    var body: some View {
        VStack(spacing: 8) {
            MiraAvatar(size: 40, accent: WidgetTheme.mint)
            Text("Sign in to SymplyEcosystem")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.primary)
                .multilineTextAlignment(.center)
            Text("Open the app to see your home at a glance.")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(14)
    }
}

// MARK: - Tone background + container helper

struct ToneBackground: View {
    let tone: String
    var body: some View {
        ZStack {
            Color("WidgetBackground")
            WidgetTheme.colors(for: tone).wash
        }
    }
}

extension View {
    /// Applies the widget container background on iOS 17+, and a plain
    /// background on earlier versions.
    @ViewBuilder
    func widgetContainerBackground<Background: View>(@ViewBuilder _ background: () -> Background) -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(for: .widget) { background() }
        } else {
            self.background(background())
        }
    }
}
