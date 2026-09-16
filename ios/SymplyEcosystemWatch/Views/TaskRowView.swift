//
//  TaskRowView.swift
//  SymplyEcosystemWatch
//
//  Individual task row component
//

import SwiftUI

struct TaskRowView: View {

    let task: WatchTask

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Title with icon
            HStack(alignment: .top, spacing: 6) {
                if let icon = task.systemCategoryIcon {
                    Text(icon)
                        .font(.body)
                }

                Text(task.title)
                    .font(.headline)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Due date and subtask progress
            HStack(spacing: 8) {
                // Due date
                if let formattedDate = task.dueDateFormatted {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar")
                            .font(.caption2)
                        Text(formattedDate)
                            .font(.caption2)
                    }
                    .foregroundColor(task.isOverdue ? .red : .secondary)
                }

                Spacer()

                // Subtask progress
                if task.subtaskCount > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle")
                            .font(.caption2)
                        Text("\(task.subtasksCompleted)/\(task.subtaskCount)")
                            .font(.caption2)
                    }
                    .foregroundColor(.blue)
                }
            }

            // Priority indicator (if high or critical)
            if let severity = task.prioritySeverity,
               ["critical", "urgent", "high"].contains(severity) {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.caption2)
                    Text(severity.capitalized)
                        .font(.caption2)
                        .textCase(.uppercase)
                }
                .foregroundColor(severity == "critical" || severity == "urgent" ? .red : .orange)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    List {
        TaskRowView(task: WatchTask(
            id: "1",
            householdId: "h1",
            title: "Replace HVAC filter",
            description: "Change the air filter",
            systemCategory: "hvac",
            frequency: "monthly",
            nextDueDate: Calendar.current.date(byAdding: .day, value: 2, to: Date()),
            prioritySeverity: "medium",
            subtasks: [
                WatchSubtask(
                    id: "s1",
                    taskId: "1",
                    title: "Turn off system",
                    sortOrder: 1,
                    isCompleted: true
                ),
                WatchSubtask(
                    id: "s2",
                    taskId: "1",
                    title: "Remove old filter",
                    sortOrder: 2,
                    isCompleted: false
                )
            ]
        ))

        TaskRowView(task: WatchTask(
            id: "2",
            householdId: "h1",
            title: "Clean gutters",
            systemCategory: "gutters",
            nextDueDate: Calendar.current.date(byAdding: .day, value: -1, to: Date()),
            prioritySeverity: "critical"
        ))
    }
}
