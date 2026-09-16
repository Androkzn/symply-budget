//
//  TaskDetailView.swift
//  SymplyEcosystemWatch
//
//  Task detail view with subtasks and actions
//

import SwiftUI

struct TaskDetailView: View {

    let task: WatchTask

    @EnvironmentObject var connectivity: WatchConnectivityManager
    @State private var showingCompletionSheet = false
    @State private var completionNotes = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Task header card
                VStack(alignment: .leading, spacing: 8) {
                    // Icon and title
                    HStack(alignment: .top, spacing: 8) {
                        if let icon = task.systemCategoryIcon {
                            Text(icon)
                                .font(.title2)
                        }

                        Text(task.title)
                            .font(.headline)
                            .lineLimit(3)
                    }

                    // Description
                    if let description = task.description {
                        Text(description)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(4)
                    }

                    Divider()

                    // Due date
                    if let dueDate = task.nextDueDate {
                        HStack {
                            Image(systemName: "calendar")
                                .font(.caption)
                            Text(task.dueDateFormatted ?? "")
                                .font(.caption)
                        }
                        .foregroundColor(task.isOverdue ? .red : .primary)
                    }

                    // Category
                    if let category = task.systemCategoryLabel {
                        HStack {
                            Image(systemName: "tag")
                                .font(.caption)
                            Text(category)
                                .font(.caption)
                        }
                        .foregroundColor(.secondary)
                    }
                }
                .padding(12)
                .background(Color.gray.opacity(0.2))
                .cornerRadius(10)

                // Subtasks section
                if !task.subtasks.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Subtasks")
                                .font(.headline)

                            Spacer()

                            Text("\(task.subtasksCompleted)/\(task.subtaskCount)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        ForEach(task.subtasks.sorted(by: { $0.sortOrder < $1.sortOrder })) { subtask in
                            SubtaskRowView(
                                subtask: subtask,
                                onToggle: {
                                    connectivity.toggleSubtask(
                                        taskId: task.id,
                                        subtaskId: subtask.id,
                                        isCompleted: !subtask.isCompleted
                                    )
                                }
                            )
                        }
                    }
                }

                // Actions
                VStack(spacing: 12) {
                    Button(action: { showingCompletionSheet = true }) {
                        Label("Complete Task", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .accessibilityIdentifier("complete-task-button")

                    NavigationLink(destination: VoiceInputView(taskId: task.id)) {
                        Label("Add Voice Note", systemImage: "mic.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("voice-note-button")
                }
                .padding(.top, 8)
            }
            .padding()
        }
        .accessibilityIdentifier("task-detail-screen")
        .navigationTitle(task.systemCategoryLabel ?? "Task")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingCompletionSheet) {
            TaskCompletionSheet(
                task: task,
                notes: $completionNotes,
                onComplete: {
                    connectivity.completeTask(taskId: task.id, notes: completionNotes.isEmpty ? nil : completionNotes)
                    showingCompletionSheet = false
                }
            )
        }
    }
}

// MARK: - Subtask Row

struct SubtaskRowView: View {

    let subtask: WatchSubtask
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 8) {
                Image(systemName: subtask.isCompleted ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(subtask.isCompleted ? .green : .gray)
                    .font(.body)

                VStack(alignment: .leading, spacing: 2) {
                    Text(subtask.title)
                        .font(.caption)
                        .strikethrough(subtask.isCompleted)
                        .foregroundColor(subtask.isCompleted ? .secondary : .primary)

                    if let description = subtask.description {
                        Text(description)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                }

                Spacer()
            }
            .padding(8)
            .background(Color.gray.opacity(0.2))
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("subtask-row-\(subtask.id)")
    }
}

#Preview {
    NavigationStack {
        TaskDetailView(task: WatchTask(
            id: "1",
            householdId: "h1",
            title: "Replace HVAC filter",
            description: "The air filter needs to be changed to maintain good air quality and system efficiency.",
            systemCategory: "hvac",
            frequency: "monthly",
            nextDueDate: Calendar.current.date(byAdding: .day, value: 2, to: Date()),
            prioritySeverity: "medium",
            subtasks: [
                WatchSubtask(
                    id: "s1",
                    taskId: "1",
                    title: "Turn off HVAC system",
                    description: "Use thermostat to turn off system",
                    sortOrder: 1,
                    isCompleted: true
                ),
                WatchSubtask(
                    id: "s2",
                    taskId: "1",
                    title: "Remove old filter",
                    description: "Located behind return vent in hallway",
                    sortOrder: 2,
                    isCompleted: false
                ),
                WatchSubtask(
                    id: "s3",
                    taskId: "1",
                    title: "Install new filter",
                    description: "Check arrow direction for airflow",
                    sortOrder: 3,
                    isCompleted: false
                )
            ]
        ))
        .environmentObject(WatchConnectivityManager.shared)
    }
}
