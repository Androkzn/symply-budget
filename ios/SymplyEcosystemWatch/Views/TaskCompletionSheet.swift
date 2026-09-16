//
//  TaskCompletionSheet.swift
//  SymplyEcosystemWatch
//
//  Sheet for completing a task with optional notes
//

import SwiftUI

struct TaskCompletionSheet: View {

    let task: WatchTask
    @Binding var notes: String
    let onComplete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var showingConfirmation = false

    var body: some View {
        VStack(spacing: 16) {
            // Header
            VStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 40))
                    .foregroundColor(.green)

                Text("Complete Task?")
                    .font(.headline)

                Text(task.title)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .padding(.top)

            Divider()

            // Notes input
            VStack(alignment: .leading, spacing: 8) {
                Text("Notes (optional)")
                    .font(.caption)
                    .foregroundColor(.secondary)

                TextField("Add notes...", text: $notes, axis: .vertical)
                    .lineLimit(3...5)
            }

            // Action buttons
            VStack(spacing: 12) {
                Button(action: {
                    showingConfirmation = true
                }) {
                    Text("Complete")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .accessibilityIdentifier("confirm-complete-button")

                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("cancel-complete-button")
            }
            .padding(.bottom)
        }
        .padding()
        .accessibilityIdentifier("task-completion-sheet")
        .alert("Confirm Completion", isPresented: $showingConfirmation) {
            Button("Complete", role: .destructive) {
                onComplete()
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Mark this task as complete?")
        }
    }
}

#Preview {
    TaskCompletionSheet(
        task: WatchTask(
            id: "1",
            householdId: "h1",
            title: "Replace HVAC filter",
            systemCategory: "hvac"
        ),
        notes: .constant(""),
        onComplete: {
            print("Task completed")
        }
    )
}
