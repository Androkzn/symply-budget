//
//  WidgetModels.swift
//  SymplyEcosystemWidget
//
//  Codable models for the Home Screen widget. These mirror the backend
//  `GET /households/:id/aihousekeeper/home-insight` (the dynamic "Mira" brief)
//  and `GET /households/:id/tasks/watch` (the bare task array) payloads.
//
//  Home-insight JSON is camelCase and matches these property names directly, so
//  it decodes with a plain JSONDecoder. The task feed is snake_case and decodes
//  with `.convertFromSnakeCase` (see WidgetDataService).
//

import Foundation

// MARK: - Home Insight (Mira brief)

/// Envelope returned by the home-insight endpoint: `{ "insight": { ... } }`.
struct HomeInsightEnvelope: Codable {
    let insight: HomeInsightData
}

/// A single deep-link action. `route` is an expo-router path (e.g. "/tasks").
struct InsightCta: Codable, Hashable {
    let label: String
    let route: String
    let params: [String: String]?
}

/// A compact secondary signal rendered as a chip.
struct InsightChip: Codable, Hashable {
    let icon: String
    let label: String
    let dueLabel: String?
}

/// The fully server-composed Mira insight. The widget renders these fields
/// verbatim — all copy, tone and routing decisions live on the backend.
struct HomeInsightData: Codable, Hashable {
    let greeting: String
    let title: String
    let message: String
    /// One of: urgent | attention | info | calm | celebrate. Kept as a raw
    /// string so an unknown value degrades gracefully instead of failing decode.
    let tone: String
    /// Ionicons name for the headline accent icon.
    let icon: String
    let dueLabel: String?
    let dueDate: String?
    let cta: InsightCta?
    let attentionCount: Int
    let chips: [InsightChip]
    let generatedAt: String?
}

// MARK: - Tasks (watch feed)

/// Minimal decode of the `tasks/watch` element — only the fields the widget
/// needs to surface urgent work. Extra JSON keys are ignored.
struct WidgetTask: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let nextDueDate: String?
    let prioritySeverity: String?
    let systemCategory: String?
    let isActive: Bool?

    /// Parsed due date (tolerates fractional seconds and date-only strings).
    var dueDate: Date? {
        guard let raw = nextDueDate else { return nil }
        return WidgetDate.parse(raw)
    }

    /// Higher = more urgent. Used only for tie-breaking between same-day tasks.
    var priorityRank: Int {
        switch prioritySeverity {
        case "critical": return 5
        case "urgent": return 4
        case "high": return 3
        case "medium": return 2
        case "low": return 1
        default: return 0
        }
    }
}

// MARK: - Tolerant ISO-8601 date parsing

enum WidgetDate {
    /// Parse an ISO-8601 date string tolerating fractional seconds and bare
    /// `YYYY-MM-DD` values. Mirrors the Watch's `parseWatchDate` so due dates
    /// never silently drop out.
    static func parse(_ string: String) -> Date? {
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: string) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: string) { return date }

        let dateOnly = DateFormatter()
        dateOnly.locale = Locale(identifier: "en_US_POSIX")
        dateOnly.timeZone = TimeZone(identifier: "UTC")
        dateOnly.dateFormat = "yyyy-MM-dd"
        if let day = dateOnly.date(from: string) {
            return Calendar(identifier: .gregorian).date(byAdding: .hour, value: 12, to: day) ?? day
        }
        return nil
    }
}
