//
//  SharedTask.swift
//  SymplyEcosystem Shared
//
//  Task model shared between iOS app and Apple Watch
//

import Foundation

/// Minimal decode of the main API's `{ id, display_name }` assignee object, so
/// `WatchTask` can accept either a scalar user-id string or that object.
private struct AssignedUserRef: Decodable {
    let id: String
}

/// Parse an ISO-8601 date string tolerating fractional seconds and bare
/// `YYYY-MM-DD` date-only values. The default `ISO8601DateFormatter` rejects
/// both fractional seconds and date-only strings, which previously caused due
/// dates to silently drop out (hiding tasks from the date filters).
func parseWatchDate(_ string: String) -> Date? {
    let withFractional = ISO8601DateFormatter()
    withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFractional.date(from: string) { return date }

    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let date = plain.date(from: string) { return date }

    // Date-only fallback (YYYY-MM-DD) → anchor at noon UTC.
    let dateOnly = DateFormatter()
    dateOnly.locale = Locale(identifier: "en_US_POSIX")
    dateOnly.timeZone = TimeZone(identifier: "UTC")
    dateOnly.dateFormat = "yyyy-MM-dd"
    if let day = dateOnly.date(from: string) {
        return Calendar(identifier: .gregorian).date(byAdding: .hour, value: 12, to: day) ?? day
    }
    return nil
}

/// Task model for Apple Watch
struct WatchTask: Codable, Identifiable, Equatable {
    let id: String
    let householdId: String
    let spaceId: String?
    let title: String
    let description: String?
    let systemCategory: String?
    let frequency: String?
    let nextDueDate: Date?
    let lastCompletedAt: Date?
    let prioritySeverity: String?
    let assignedTo: String?
    let isActive: Bool
    let subtasks: [WatchSubtask]

    /// CodingKeys for JSON serialization
    enum CodingKeys: String, CodingKey {
        case id
        case householdId = "household_id"
        case spaceId = "space_id"
        case title
        case description
        case systemCategory = "system_category"
        case frequency
        case nextDueDate = "next_due_date"
        case lastCompletedAt = "last_completed_at"
        case prioritySeverity = "priority_severity"
        case assignedTo = "assigned_to"
        case isActive = "is_active"
        case subtasks
    }

    /// Initialize from API response
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        // `household_id` may be absent in some payloads. The Watch already knows
        // its household via the App Group, so tolerate a missing value rather
        // than failing to decode the whole list.
        householdId = (try? container.decode(String.self, forKey: .householdId)) ?? ""
        spaceId = try container.decodeIfPresent(String.self, forKey: .spaceId)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        systemCategory = try container.decodeIfPresent(String.self, forKey: .systemCategory)
        frequency = try container.decodeIfPresent(String.self, forKey: .frequency)
        prioritySeverity = try container.decodeIfPresent(String.self, forKey: .prioritySeverity)
        // `assigned_to` may be a scalar user-id string (Watch feed) OR an
        // { id, display_name } object (main API) OR null. Accept any of them.
        if let assignedString = try? container.decode(String.self, forKey: .assignedTo) {
            assignedTo = assignedString
        } else if let assignedUser = try? container.decode(AssignedUserRef.self, forKey: .assignedTo) {
            assignedTo = assignedUser.id
        } else {
            assignedTo = nil
        }
        isActive = try container.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        subtasks = try container.decodeIfPresent([WatchSubtask].self, forKey: .subtasks) ?? []

        // Dates are tolerant of ISO-8601 with/without fractional seconds and of
        // date-only (`YYYY-MM-DD`) values (e.g. next_due_date).
        if let nextDueDateString = try container.decodeIfPresent(String.self, forKey: .nextDueDate) {
            nextDueDate = parseWatchDate(nextDueDateString)
        } else {
            nextDueDate = nil
        }

        if let lastCompletedAtString = try container.decodeIfPresent(String.self, forKey: .lastCompletedAt) {
            lastCompletedAt = parseWatchDate(lastCompletedAtString)
        } else {
            lastCompletedAt = nil
        }
    }

    /// Manual initialization
    init(
        id: String,
        householdId: String,
        spaceId: String? = nil,
        title: String,
        description: String? = nil,
        systemCategory: String? = nil,
        frequency: String? = nil,
        nextDueDate: Date? = nil,
        lastCompletedAt: Date? = nil,
        prioritySeverity: String? = nil,
        assignedTo: String? = nil,
        isActive: Bool = true,
        subtasks: [WatchSubtask] = []
    ) {
        self.id = id
        self.householdId = householdId
        self.spaceId = spaceId
        self.title = title
        self.description = description
        self.systemCategory = systemCategory
        self.frequency = frequency
        self.nextDueDate = nextDueDate
        self.lastCompletedAt = lastCompletedAt
        self.prioritySeverity = prioritySeverity
        self.assignedTo = assignedTo
        self.isActive = isActive
        self.subtasks = subtasks
    }

    /// Encode to JSON
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        try container.encode(id, forKey: .id)
        try container.encode(householdId, forKey: .householdId)
        try container.encodeIfPresent(spaceId, forKey: .spaceId)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(systemCategory, forKey: .systemCategory)
        try container.encodeIfPresent(frequency, forKey: .frequency)
        try container.encodeIfPresent(prioritySeverity, forKey: .prioritySeverity)
        try container.encodeIfPresent(assignedTo, forKey: .assignedTo)
        try container.encode(isActive, forKey: .isActive)
        try container.encode(subtasks, forKey: .subtasks)

        let dateFormatter = ISO8601DateFormatter()

        if let nextDueDate = nextDueDate {
            try container.encode(dateFormatter.string(from: nextDueDate), forKey: .nextDueDate)
        }

        if let lastCompletedAt = lastCompletedAt {
            try container.encode(dateFormatter.string(from: lastCompletedAt), forKey: .lastCompletedAt)
        }
    }

    // MARK: - Computed Properties

    /// Human-readable system category label
    var systemCategoryLabel: String? {
        systemCategory?.replacingOccurrences(of: "_", with: " ").capitalized
    }

    /// System category icon emoji
    var systemCategoryIcon: String? {
        guard let category = systemCategory else { return nil }

        let icons: [String: String] = [
            "hvac": "❄️",
            "plumbing": "🚿",
            "electrical": "⚡",
            "gas": "🔥",
            "appliances": "🍳",
            "roof": "🏠",
            "foundation": "🏗️",
            "walls": "🧱",
            "windows": "🪟",
            "doors": "🚪",
            "flooring": "📐",
            "painting": "🎨",
            "landscaping": "🌳",
            "gutters": "🌧️",
            "deck": "🪵",
            "fence": "🪵",
            "driveway": "🚗",
            "garage": "🚙",
            "security": "🔒",
            "pool": "🏊",
            "septic": "💧",
            "well": "🚰",
            "fireplace": "🔥",
            "chimney": "🏠",
            "attic": "📦",
            "basement": "⬇️",
            "crawl_space": "🕳️",
            "insulation": "🧊",
            "ventilation": "💨"
        ]

        return icons[category] ?? "🏠"
    }

    /// Whether task is due today
    var isDueToday: Bool {
        guard let dueDate = nextDueDate else { return false }
        return Calendar.current.isDateInToday(dueDate)
    }

    /// Whether task is upcoming (within next 7 days)
    var isUpcoming: Bool {
        guard let dueDate = nextDueDate else { return false }
        let now = Date()
        let sevenDaysFromNow = Calendar.current.date(byAdding: .day, value: 7, to: now)!
        return dueDate > now && dueDate <= sevenDaysFromNow
    }

    /// Whether task is overdue
    var isOverdue: Bool {
        guard let dueDate = nextDueDate else { return false }
        return dueDate < Date() && isActive
    }

    /// Number of subtasks
    var subtaskCount: Int {
        subtasks.count
    }

    /// Number of completed subtasks
    var subtasksCompleted: Int {
        subtasks.filter { $0.isCompleted }.count
    }

    /// Subtask completion progress (0.0 to 1.0)
    var subtaskProgress: Double {
        guard subtaskCount > 0 else { return 0.0 }
        return Double(subtasksCompleted) / Double(subtaskCount)
    }

    /// Whether all subtasks are completed
    var allSubtasksCompleted: Bool {
        guard !subtasks.isEmpty else { return false }
        return subtasksCompleted == subtaskCount
    }

    /// Priority color for UI display
    var priorityColor: String {
        switch prioritySeverity {
        case "critical", "urgent":
            return "red"
        case "high":
            return "orange"
        case "medium":
            return "yellow"
        case "low":
            return "blue"
        default:
            return "gray"
        }
    }

    /// Formatted due date string (relative)
    var dueDateFormatted: String? {
        guard let dueDate = nextDueDate else { return nil }

        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: dueDate, relativeTo: Date())
    }
}
