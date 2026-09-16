//
//  WatchSubtaskTests.swift
//  SymplyEcosystemWatchApp Watch AppTests
//

import Foundation
import Testing
@testable import SymplyEcosystemWatchApp_Watch_App

struct WatchSubtaskTests {

    @Test func decodesFromAPIJSON() throws {
        let json = """
        {
          "id": "sub-1",
          "task_id": "task-1",
          "title": "Turn off system",
          "sort_order": 1,
          "is_completed": true,
          "completed_at": "2026-07-01T10:00:00Z"
        }
        """.data(using: .utf8)!

        let subtask = try JSONDecoder().decode(WatchSubtask.self, from: json)
        #expect(subtask.id == "sub-1")
        #expect(subtask.taskId == "task-1")
        #expect(subtask.title == "Turn off system")
        #expect(subtask.sortOrder == 1)
        #expect(subtask.isCompleted == true)
        #expect(subtask.completedAt != nil)
    }

    @Test func encodesAndDecodesRoundTrip() throws {
        let original = WatchSubtask(
            id: "sub-2",
            taskId: "task-2",
            title: "Install filter",
            description: "Check airflow arrow",
            sortOrder: 2,
            isCompleted: false
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WatchSubtask.self, from: data)
        #expect(decoded == original)
    }
}
