//
//  WidgetProvider.swift
//  SymplyEcosystemWidget
//
//  TimelineProvider that drives the widget: a fast cached snapshot for previews
//  and a live fetch (with a ~30 min refresh cadence) for the real timeline.
//

import WidgetKit
import SwiftUI

struct MiraEntry: TimelineEntry {
    let date: Date
    let content: WidgetContent
    /// True when WidgetKit is rendering a gallery preview / redacted placeholder
    /// rather than the user's real data. Brands render illustrative sample content
    /// in this case so the widget picker actually shows what each size looks like.
    var isPlaceholder: Bool = false
}

struct MiraProvider: TimelineProvider {
    func placeholder(in context: Context) -> MiraEntry {
        MiraEntry(date: Date(), content: WidgetSamples.content, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (MiraEntry) -> Void) {
        if context.isPreview {
            completion(MiraEntry(date: Date(), content: WidgetSamples.content, isPlaceholder: true))
            return
        }
        // Instant render from cache; the timeline refresh brings live data.
        completion(MiraEntry(date: Date(), content: WidgetDataService.cachedContent()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MiraEntry>) -> Void) {
        Task {
            let content = await WidgetDataService.load()
            let entry = MiraEntry(date: Date(), content: content)
            // Refresh roughly every 30 minutes; the app also nudges the widget
            // (WidgetCenter.reloadAllTimelines) whenever it loads a fresh insight.
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - Sample content (previews, placeholder, gallery)

enum WidgetSamples {
    static let insight = HomeInsightData(
        greeting: "Good morning",
        title: "2 tasks this week",
        message: "2 tasks are coming up this week, starting with \u{201C}Return Amazon gift edit\u{201D} in 2 days.",
        tone: "calm",
        icon: "calendar",
        dueLabel: "Due in 2 days",
        dueDate: nil,
        cta: InsightCta(label: "Review tasks", route: "/tasks", params: nil),
        attentionCount: 2,
        chips: [
            InsightChip(icon: "card", label: "Electricity bill", dueLabel: "in 3 days"),
            InsightChip(icon: "trash", label: "Recycling", dueLabel: "tomorrow"),
        ],
        generatedAt: nil
    )

    static let tasks: [WidgetTask] = {
        let now = Date()
        func iso(_ offsetDays: Int) -> String {
            let d = Calendar.current.date(byAdding: .day, value: offsetDays, to: now) ?? now
            let f = ISO8601DateFormatter()
            return f.string(from: d)
        }
        return [
            WidgetTask(id: "1", title: "Return Amazon gift edit", nextDueDate: iso(2), prioritySeverity: "high", systemCategory: nil, isActive: true),
            WidgetTask(id: "2", title: "Replace furnace filter", nextDueDate: iso(-1), prioritySeverity: "urgent", systemCategory: "hvac", isActive: true),
            WidgetTask(id: "3", title: "Pay water bill", nextDueDate: iso(4), prioritySeverity: "medium", systemCategory: nil, isActive: true),
        ]
    }()

    static let content = WidgetContent(insight: insight, tasks: tasks, isLoggedOut: false, isStale: false)
}
