//
//  TaskListView.swift
//  SymplyEcosystemWatch
//
//  Main task list view for Apple Watch
//

import SwiftUI

struct TaskListView: View {

    @EnvironmentObject var connectivity: WatchConnectivityManager

    @State private var selectedFilter: TaskFilter = .upcoming
    @State private var showingAddTask = false

    enum TaskFilter: String, CaseIterable, Identifiable {
        case upcoming = "Upcoming"
        case today = "Today"
        case overdue = "Overdue"
        case all = "All"

        var id: String { rawValue }
    }

    var filteredTasks: [WatchTask] {
        switch selectedFilter {
        case .upcoming:
            return connectivity.tasks.filter { $0.isUpcoming }
        case .today:
            return connectivity.tasks.filter { $0.isDueToday }
        case .overdue:
            return connectivity.tasks.filter { $0.isOverdue }
        case .all:
            return connectivity.tasks
        }
    }

    /// Chrome (filter picker + add button) only makes sense once we have a
    /// working, signed-in session showing content — hide it during loading and
    /// error states so it doesn't overlap the centered status views.
    private var isContentReady: Bool {
        !connectivity.isLoading && connectivity.errorMessage == nil
    }

    /// Only offer filtering when there is actually something to filter.
    private var showFilterPicker: Bool {
        isContentReady && !connectivity.tasks.isEmpty
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Filter picker — only when there are tasks to filter.
                if showFilterPicker {
                    Picker("Filter", selection: $selectedFilter) {
                        ForEach(TaskFilter.allCases) { filter in
                            Text(filter.rawValue).tag(filter)
                        }
                    }
                    .accessibilityIdentifier("task-filter-picker")
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                }

                // Task list
                if connectivity.isLoading {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Loading tasks...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = connectivity.errorMessage {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 40))
                            .foregroundColor(.orange)
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Try Again") {
                            connectivity.requestTaskSync()
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding()
                } else if filteredTasks.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "checkmark.circle")
                            .font(.system(size: 40))
                            .foregroundColor(.green)
                        Text("No \(selectedFilter.rawValue.lowercased()) tasks")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .accessibilityIdentifier("task-list-empty-state")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(filteredTasks) { task in
                            NavigationLink(destination: TaskDetailView(task: task)) {
                                TaskRowView(task: task)
                            }
                            .accessibilityIdentifier("task-row-\(task.id)")
                        }
                    }
                    .accessibilityIdentifier("task-list")
                }
            }
            .accessibilityIdentifier("task-list-screen")
            .navigationTitle("Tasks")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink(destination: AihousekeeperGlanceView()) {
                        Image(systemName: "sunrise.fill")
                            .foregroundColor(.orange)
                    }
                    .accessibilityLabel("Today's briefing")
                    .accessibilityIdentifier("briefing-button")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { connectivity.requestTaskSync() }) {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(connectivity.isLoading)
                    .accessibilityIdentifier("sync-button")
                }
                // Add-by-voice only when signed in and past loading/error —
                // otherwise the floating button overlaps the status views and
                // creating a task would fail anyway.
                if isContentReady {
                    ToolbarItemGroup(placement: .bottomBar) {
                        Button(action: { showingAddTask = true }) {
                            Label("Add Task", systemImage: "mic.fill")
                        }
                        .tint(.blue)
                        .accessibilityIdentifier("add-task-button")
                    }
                }
            }
            .sheet(isPresented: $showingAddTask) {
                AddTaskView {
                    // Refresh the list once the new (enrichment-pending) task lands.
                    connectivity.requestTaskSync()
                }
            }
        }
        .onAppear {
            // Request initial sync if cache is expired
            if AppGroup.isCacheExpired() {
                connectivity.requestTaskSync()
            }
        }
    }
}

#Preview {
    TaskListView()
        .environmentObject(WatchConnectivityManager.shared)
}
