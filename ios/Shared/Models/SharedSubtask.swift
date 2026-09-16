//
//  SharedSubtask.swift
//  SymplyEcosystem Shared
//
//  Subtask model shared between iOS app and Apple Watch
//

import Foundation

/// Subtask model for Apple Watch
struct WatchSubtask: Codable, Identifiable, Equatable {
    let id: String
    let taskId: String
    let title: String
    let description: String?
    let sortOrder: Int
    let isCompleted: Bool
    let completedAt: Date?
    let completedBy: String?

    /// CodingKeys for JSON serialization
    enum CodingKeys: String, CodingKey {
        case id
        case taskId = "task_id"
        case title
        case description
        case sortOrder = "sort_order"
        case isCompleted = "is_completed"
        case completedAt = "completed_at"
        case completedBy = "completed_by"
    }

    /// Initialize from API response
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        taskId = (try? container.decode(String.self, forKey: .taskId)) ?? ""
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        sortOrder = try container.decodeIfPresent(Int.self, forKey: .sortOrder) ?? 0
        isCompleted = try container.decodeIfPresent(Bool.self, forKey: .isCompleted) ?? false

        // Dates tolerate ISO-8601 with/without fractional seconds (see parseWatchDate).
        if let completedAtString = try container.decodeIfPresent(String.self, forKey: .completedAt) {
            completedAt = parseWatchDate(completedAtString)
        } else {
            completedAt = nil
        }

        completedBy = try container.decodeIfPresent(String.self, forKey: .completedBy)
    }

    /// Manual initialization
    init(
        id: String,
        taskId: String,
        title: String,
        description: String? = nil,
        sortOrder: Int,
        isCompleted: Bool = false,
        completedAt: Date? = nil,
        completedBy: String? = nil
    ) {
        self.id = id
        self.taskId = taskId
        self.title = title
        self.description = description
        self.sortOrder = sortOrder
        self.isCompleted = isCompleted
        self.completedAt = completedAt
        self.completedBy = completedBy
    }

    /// Encode to JSON
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        try container.encode(id, forKey: .id)
        try container.encode(taskId, forKey: .taskId)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encode(sortOrder, forKey: .sortOrder)
        try container.encode(isCompleted, forKey: .isCompleted)

        if let completedAt = completedAt {
            let dateFormatter = ISO8601DateFormatter()
            try container.encode(dateFormatter.string(from: completedAt), forKey: .completedAt)
        }

        try container.encodeIfPresent(completedBy, forKey: .completedBy)
    }
}
