//
//  TaskFilterTests.swift
//  SymplyEcosystemWatchApp Watch AppTests
//

import Foundation
import Testing
@testable import SymplyEcosystemWatchApp_Watch_App

/// Mirrors TaskListView filtering logic for unit testing.
enum TaskFilterLogic {
    enum Filter: String, CaseIterable {
        case upcoming, today, overdue, all
    }

    static func filter(_ tasks: [WatchTask], by filter: Filter) -> [WatchTask] {
        switch filter {
        case .upcoming:
            return tasks.filter { $0.isUpcoming }
        case .today:
            return tasks.filter { $0.isDueToday }
        case .overdue:
            return tasks.filter { $0.isOverdue }
        case .all:
            return tasks
        }
    }
}

struct TaskFilterTests {

    private func makeTask(id: String, dueOffsetHours: Int) -> WatchTask {
        let dueDate = Calendar.current.date(byAdding: .hour, value: dueOffsetHours, to: Date())!
        return WatchTask(id: id, householdId: "h1", title: id, nextDueDate: dueDate)
    }

    @Test func upcomingFilterReturnsFutureTasksWithinSevenDays() {
        let tasks = [
            makeTask(id: "past", dueOffsetHours: -48),
            makeTask(id: "soon", dueOffsetHours: 48),
            makeTask(id: "later", dueOffsetHours: 24 * 10),
        ]
        let filtered = TaskFilterLogic.filter(tasks, by: .upcoming)
        #expect(filtered.count == 1)
        #expect(filtered.first?.id == "soon")
    }

    @Test func todayFilterReturnsTodayTasks() {
        let tasks = [
            makeTask(id: "today", dueOffsetHours: 2),
            makeTask(id: "tomorrow", dueOffsetHours: 30),
        ]
        let filtered = TaskFilterLogic.filter(tasks, by: .today)
        #expect(filtered.count == 1)
        #expect(filtered.first?.id == "today")
    }

    @Test func overdueFilterReturnsPastDueTasks() {
        let tasks = [
            makeTask(id: "overdue", dueOffsetHours: -48),
            makeTask(id: "today", dueOffsetHours: 2),
        ]
        let filtered = TaskFilterLogic.filter(tasks, by: .overdue)
        #expect(filtered.count == 1)
        #expect(filtered.first?.id == "overdue")
    }

    @Test func allFilterReturnsEveryTask() {
        let tasks = [
            makeTask(id: "a", dueOffsetHours: -48),
            makeTask(id: "b", dueOffsetHours: 2),
            makeTask(id: "c", dueOffsetHours: 72),
        ]
        let filtered = TaskFilterLogic.filter(tasks, by: .all)
        #expect(filtered.count == 3)
    }
}
