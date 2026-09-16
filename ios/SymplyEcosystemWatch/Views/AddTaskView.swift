//
//  AddTaskView.swift
//  SymplyEcosystemWatch
//
//  Voice-first "add a task" capture for Apple Watch.
//
//  Uses watchOS native dictation (an auto-focused TextField opens the system
//  input screen with the mic as the primary mode) and posts the raw text to
//  POST /households/:id/tasks/quick. The backend AI enrichment resolves the
//  title, due date, priority, subtasks and assignee — same lane as the phone's
//  fast capture — so the Watch stays thin.
//

import SwiftUI

struct AddTaskView: View {

    /// Called after a task is successfully created so the caller can refresh
    /// the task list.
    var onCreated: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var state: CaptureState = .input
    @State private var errorMessage: String?
    @FocusState private var fieldFocused: Bool

    enum CaptureState {
        case input
        case creating
        case done
        case error
    }

    var body: some View {
        NavigationStack {
            Group {
                switch state {
                case .input:
                    inputView
                case .creating:
                    creatingView
                case .done:
                    doneView
                case .error:
                    errorView
                }
            }
            .navigationTitle("Add Task")
            .navigationBarTitleDisplayMode(.inline)
        }
        .accessibilityIdentifier("add-task-screen")
    }

    // MARK: - States

    private var inputView: some View {
        VStack(spacing: 12) {
            // Tapping the field opens the watch input screen; Dictation (mic)
            // is the primary mode. Auto-focused so it appears immediately.
            TextField("Speak your task", text: $text, axis: .vertical)
                .focused($fieldFocused)
                .submitLabel(.done)
                .accessibilityIdentifier("add-task-field")

            Button(action: submit) {
                Label("Add Task", systemImage: "mic.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("add-task-submit")

            Text("We'll figure out the details for you.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 4)
        .onAppear {
            // Present the dictation/input screen right away.
            Task {
                try? await Task.sleep(nanoseconds: 350_000_000)
                fieldFocused = true
            }
        }
    }

    private var creatingView: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("Adding task…")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var doneView: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 44))
                .foregroundColor(.green)
            Text("Task added")
                .font(.headline)
            Text("Mira is filling in the details…")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("add-task-done")
    }

    private var errorView: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundColor(.orange)
            Text(errorMessage ?? "Couldn't add task")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button("Try Again") {
                state = .input
                errorMessage = nil
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    // MARK: - Actions

    private func submit() {
        let toSend = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !toSend.isEmpty else { return }

        fieldFocused = false
        state = .creating

        Task {
            do {
                try await WatchAPIClient.shared.createQuickTask(text: toSend)
                await MainActor.run {
                    state = .done
                }
                onCreated()
                // Give the user a beat to read the confirmation, then close.
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                await MainActor.run { dismiss() }
            } catch {
                await MainActor.run {
                    errorMessage = (error as? APIError)?.errorDescription
                        ?? error.localizedDescription
                    state = .error
                }
            }
        }
    }
}

#Preview {
    AddTaskView()
}
