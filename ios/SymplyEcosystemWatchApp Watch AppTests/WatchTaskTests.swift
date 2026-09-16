//
//  WatchTaskTests.swift
//  SymplyEcosystemWatchApp Watch AppTests
//

import Foundation
import Testing
@testable import SymplyEcosystemWatchApp_Watch_App

struct WatchTaskTests {

    private func makeTask(
        id: String = "task-1",
        nextDueDate: Date? = nil,
        isActive: Bool = true,
        systemCategory: String? = "hvac",
        prioritySeverity: String? = "medium",
        subtasks: [WatchSubtask] = []
    ) -> WatchTask {
        WatchTask(
            id: id,
            householdId: "household-1",
            title: "Test Task",
            systemCategory: systemCategory,
            nextDueDate: nextDueDate,
            prioritySeverity: prioritySeverity,
            isActive: isActive,
            subtasks: subtasks
        )
    }

    @Test func systemCategoryLabelFormatsUnderscores() {
        let task = makeTask(systemCategory: "crawl_space")
        #expect(task.systemCategoryLabel == "Crawl Space")
    }

    @Test func systemCategoryIconReturnsKnownEmoji() {
        let task = makeTask(systemCategory: "plumbing")
        #expect(task.systemCategoryIcon == "🚿")
    }

    @Test func systemCategoryIconDefaultsToHouse() {
        let task = makeTask(systemCategory: "unknown_category")
        #expect(task.systemCategoryIcon == "🏠")
    }

    @Test func isDueTodayWhenDueDateIsToday() {
        let task = makeTask(nextDueDate: Date())
        #expect(task.isDueToday == true)
    }

    @Test func isUpcomingWithinSevenDays() {
        let dueDate = Calendar.current.date(byAdding: .day, value: 3, to: Date())!
        let task = makeTask(nextDueDate: dueDate)
        #expect(task.isUpcoming == true)
    }

    @Test func isOverdueWhenPastDueAndActive() {
        let dueDate = Calendar.current.date(byAdding: .day, value: -2, to: Date())!
        let task = makeTask(nextDueDate: dueDate, isActive: true)
        #expect(task.isOverdue == true)
    }

    @Test func isNotOverdueWhenInactive() {
        let dueDate = Calendar.current.date(byAdding: .day, value: -2, to: Date())!
        let task = makeTask(nextDueDate: dueDate, isActive: false)
        #expect(task.isOverdue == false)
    }

    @Test func subtaskProgressCalculatesCorrectly() {
        let subtasks = [
            WatchSubtask(id: "s1", taskId: "task-1", title: "A", sortOrder: 1, isCompleted: true),
            WatchSubtask(id: "s2", taskId: "task-1", title: "B", sortOrder: 2, isCompleted: false),
        ]
        let task = makeTask(subtasks: subtasks)
        #expect(task.subtaskCount == 2)
        #expect(task.subtasksCompleted == 1)
        #expect(task.subtaskProgress == 0.5)
        #expect(task.allSubtasksCompleted == false)
    }

    @Test func allSubtasksCompletedWhenEverySubtaskDone() {
        let subtasks = [
            WatchSubtask(id: "s1", taskId: "task-1", title: "A", sortOrder: 1, isCompleted: true),
            WatchSubtask(id: "s2", taskId: "task-1", title: "B", sortOrder: 2, isCompleted: true),
        ]
        let task = makeTask(subtasks: subtasks)
        #expect(task.allSubtasksCompleted == true)
    }

    @Test func priorityColorMapsSeverity() {
        #expect(makeTask(prioritySeverity: "critical").priorityColor == "red")
        #expect(makeTask(prioritySeverity: "high").priorityColor == "orange")
        #expect(makeTask(prioritySeverity: "medium").priorityColor == "yellow")
        #expect(makeTask(prioritySeverity: "low").priorityColor == "blue")
        #expect(makeTask(prioritySeverity: nil).priorityColor == "gray")
    }

    @Test func decodesFromAPIJSON() throws {
        let json = """
        {
          "id": "abc-123",
          "household_id": "hh-1",
          "title": "Replace filter",
          "system_category": "hvac",
          "next_due_date": "2026-07-02T12:00:00Z",
          "priority_severity": "high",
          "is_active": true,
          "subtasks": []
        }
        """.data(using: .utf8)!

        let task = try JSONDecoder().decode(WatchTask.self, from: json)
        #expect(task.id == "abc-123")
        #expect(task.householdId == "hh-1")
        #expect(task.title == "Replace filter")
        #expect(task.systemCategory == "hvac")
        #expect(task.nextDueDate != nil)
        #expect(task.prioritySeverity == "high")
    }

    @Test func encodesAndDecodesRoundTrip() throws {
        let fixedDate = Calendar.current.date(
            from: DateComponents(year: 2026, month: 7, day: 2, hour: 12, minute: 0, second: 0)
        )!
        let original = makeTask(
            id: "round-trip",
            nextDueDate: fixedDate,
            subtasks: [
                WatchSubtask(id: "s1", taskId: "round-trip", title: "Step", sortOrder: 1),
            ]
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WatchTask.self, from: data)
        #expect(decoded.id == original.id)
        #expect(decoded.title == original.title)
        #expect(decoded.subtaskCount == original.subtaskCount)
        #expect(decoded.nextDueDate != nil)
    }
}
