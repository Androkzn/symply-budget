//
//  WatchConnectivityManager.swift
//  SymplyEcosystemWatch
//
//  Watch-side connectivity manager for communicating with iPhone app
//

import Foundation
import WatchConnectivity
import Combine

/// Observable object managing communication between Apple Watch and iPhone
class WatchConnectivityManager: NSObject, ObservableObject {

    static let shared = WatchConnectivityManager()

    @Published var tasks: [WatchTask] = []
    @Published var isReachable = false
    @Published var isLoading = false
    @Published var errorMessage: String?

    /// Aihousekeeper — today's briefing paragraph (plan §H7).
    @Published var aihousekeeperBriefingParagraph: String?
    /// Aihousekeeper — date the briefing was generated for (YYYY-MM-DD).
    @Published var aihousekeeperBriefingDate: String?

    private var session: WCSession?

    private override init() {
        super.init()

        // One-time cleanup: wipe any fabricated data that an older UI-test build
        // could have persisted into the shared App Group. The Watch renders real
        // backend data only — never mock/sample content — in every environment.
        AppGroup.purgeLeakedTestDataIfNeeded()

        if WCSession.isSupported() {
            session = WCSession.default
            session?.delegate = self
            session?.activate()
        }

        // Load the last real snapshot cached from the backend so the UI has
        // something to show immediately; a fresh fetch replaces it on activation.
        loadCachedTasks()
        // Load cached Aihousekeeper briefing on init (plan §H7)
        loadCachedBriefing()
    }

    // MARK: - Task Sync

    /// Request fresh task data from iPhone
    func requestTaskSync() {
        guard let session = session else {
            print("[WatchConnectivity] Session not available, using direct API")
            fetchTasksDirectly()
            return
        }

        isLoading = true
        errorMessage = nil

        if session.isReachable {
            // Phone is reachable - request sync via message
            let message = ["type": "sync_tasks"]

            session.sendMessage(message, replyHandler: { [weak self] reply in
                DispatchQueue.main.async {
                    self?.handleTaskSyncReply(reply)
                }
            }, errorHandler: { [weak self] error in
                DispatchQueue.main.async {
                    // Message channel failed — try a direct API call before
                    // giving up so a flaky link doesn't strand the user.
                    print("[WatchConnectivity] Sync error, falling back to direct API: \(error)")
                    self?.fetchTasksDirectly()
                }
            })
        } else {
            // Phone not reachable - use direct API
            print("[WatchConnectivity] Phone not reachable, using direct API")
            fetchTasksDirectly()
        }
    }

    /// Fetch tasks straight from the backend (used when the phone is unreachable
    /// or the message channel fails). Keeps `isLoading` true for the duration and
    /// only surfaces an error when there is no cached data to fall back on.
    private func fetchTasksDirectly() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                let tasks = try await WatchAPIClient.shared.fetchUpcomingTasks()
                await MainActor.run {
                    self.tasks = tasks
                    self.cacheTasks()
                    self.isLoading = false
                    self.errorMessage = nil
                    print("[WatchConnectivity] Loaded \(tasks.count) tasks via direct API")
                }
            } catch {
                await MainActor.run {
                    print("[WatchConnectivity] Direct API error: \(error)")
                    self.loadCachedTasks()
                    self.isLoading = false
                    // Only nag with an error banner if we have nothing to show.
                    self.errorMessage = self.tasks.isEmpty
                        ? ((error as? APIError)?.errorDescription ?? "Couldn't load tasks")
                        : nil
                }
            }
        }
    }

    private func handleTaskSyncReply(_ reply: [String: Any]) {
        if let error = reply["error"] as? String {
            print("[WatchConnectivity] Sync reply error: \(error)")
            loadCachedTasks()
            isLoading = false
            errorMessage = tasks.isEmpty ? error : nil
            return
        }

        guard let tasksData = reply["tasks"] as? Data else {
            print("[WatchConnectivity] Invalid tasks data")
            loadCachedTasks()
            isLoading = false
            errorMessage = tasks.isEmpty ? "Invalid response" : nil
            return
        }

        do {
            let decoded = try JSONDecoder().decode([WatchTask].self, from: tasksData)
            self.tasks = decoded
            self.cacheTasks()
            self.isLoading = false
            self.errorMessage = nil
            print("[WatchConnectivity] Received \(decoded.count) tasks")
        } catch {
            print("[WatchConnectivity] Decode error: \(error)")
            loadCachedTasks()
            isLoading = false
            errorMessage = tasks.isEmpty ? "Failed to decode tasks" : nil
        }
    }

    // MARK: - Task Actions

    /// Complete a task
    func completeTask(taskId: String, notes: String?) {
        guard let session = session else {
            errorMessage = "Watch not connected"
            return
        }

        let message: [String: Any] = [
            "type": "complete_task",
            "taskId": taskId,
            "notes": notes ?? ""
        ]

        if session.isReachable {
            session.sendMessage(message, replyHandler: { [weak self] reply in
                DispatchQueue.main.async {
                    if let success = reply["success"] as? Bool, success {
                        print("[WatchConnectivity] Task completed successfully")
                        self?.refreshTasks()
                    } else if let error = reply["error"] as? String {
                        self?.errorMessage = error
                    }
                }
            }, errorHandler: { [weak self] error in
                DispatchQueue.main.async {
                    self?.errorMessage = "Failed to complete task"
                    print("[WatchConnectivity] Complete error: \(error)")
                }
            })
        } else {
            // Use direct API
            Task {
                do {
                    try await WatchAPIClient.shared.completeTask(taskId: taskId, notes: notes)
                    await MainActor.run {
                        print("[WatchConnectivity] Task completed via direct API")
                        self.refreshTasks()
                    }
                } catch {
                    await MainActor.run {
                        self.errorMessage = "Failed to complete task"
                        print("[WatchConnectivity] Direct complete error: \(error)")
                    }
                }
            }
        }
    }

    /// Toggle subtask completion
    func toggleSubtask(taskId: String, subtaskId: String, isCompleted: Bool) {
        guard let session = session else {
            errorMessage = "Watch not connected"
            return
        }

        let messageType = isCompleted ? "complete_subtask" : "uncomplete_subtask"
        let message: [String: Any] = [
            "type": messageType,
            "taskId": taskId,
            "subtaskId": subtaskId
        ]

        // Optimistic update
        if let taskIndex = tasks.firstIndex(where: { $0.id == taskId }),
           let subtaskIndex = tasks[taskIndex].subtasks.firstIndex(where: { $0.id == subtaskId }) {
            var updatedTask = tasks[taskIndex]
            var updatedSubtask = updatedTask.subtasks[subtaskIndex]
            updatedSubtask = WatchSubtask(
                id: updatedSubtask.id,
                taskId: updatedSubtask.taskId,
                title: updatedSubtask.title,
                description: updatedSubtask.description,
                sortOrder: updatedSubtask.sortOrder,
                isCompleted: isCompleted,
                completedAt: isCompleted ? Date() : nil,
                completedBy: nil
            )
            var subtasks = updatedTask.subtasks
            subtasks[subtaskIndex] = updatedSubtask
            updatedTask = WatchTask(
                id: updatedTask.id,
                householdId: updatedTask.householdId,
                spaceId: updatedTask.spaceId,
                title: updatedTask.title,
                description: updatedTask.description,
                systemCategory: updatedTask.systemCategory,
                frequency: updatedTask.frequency,
                nextDueDate: updatedTask.nextDueDate,
                lastCompletedAt: updatedTask.lastCompletedAt,
                prioritySeverity: updatedTask.prioritySeverity,
                assignedTo: updatedTask.assignedTo,
                isActive: updatedTask.isActive,
                subtasks: subtasks
            )
            tasks[taskIndex] = updatedTask
            cacheTasks()
        }

        if session.isReachable {
            session.sendMessage(message, replyHandler: { [weak self] reply in
                DispatchQueue.main.async {
                    if let success = reply["success"] as? Bool, success {
                        print("[WatchConnectivity] Subtask toggled successfully")
                    } else if let error = reply["error"] as? String {
                        self?.errorMessage = error
                        // Revert optimistic update
                        self?.refreshTasks()
                    }
                }
            }, errorHandler: { [weak self] error in
                DispatchQueue.main.async {
                    self?.errorMessage = "Failed to toggle subtask"
                    print("[WatchConnectivity] Toggle error: \(error)")
                    // Revert optimistic update
                    self?.refreshTasks()
                }
            })
        } else {
            // Use direct API
            Task {
                do {
                    try await WatchAPIClient.shared.toggleSubtask(taskId: taskId, subtaskId: subtaskId, isCompleted: isCompleted)
                    print("[WatchConnectivity] Subtask toggled via direct API")
                } catch {
                    await MainActor.run {
                        self.errorMessage = "Failed to toggle subtask"
                        print("[WatchConnectivity] Direct toggle error: \(error)")
                        // Revert optimistic update
                        self.refreshTasks()
                    }
                }
            }
        }
    }

    // MARK: - Cache Management

    private func cacheTasks() {
        AppGroup.cacheTasks(tasks)
    }

    private func loadCachedTasks() {
        if let cached = AppGroup.getCachedTasks() {
            tasks = cached
            print("[WatchConnectivity] Loaded \(cached.count) tasks from cache")
        }
    }

    /// Aihousekeeper — load the most recent briefing from the App Group (plan §H7).
    private func loadCachedBriefing() {
        if let latest = AppGroup.getAihousekeeperBriefingLatest() {
            aihousekeeperBriefingParagraph = latest.paragraph
            aihousekeeperBriefingDate = latest.date
            print("[WatchConnectivity] Loaded Aihousekeeper briefing from cache (\(latest.date))")
        }
    }

    private func refreshTasks() {
        requestTaskSync()
    }
}

// MARK: - WCSessionDelegate

extension WatchConnectivityManager: WCSessionDelegate {

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error = error {
            print("[WatchConnectivity] Activation failed: \(error)")
        } else {
            print("[WatchConnectivity] Activation completed: \(activationState.rawValue)")

            // Request initial sync
            if activationState == .activated {
                DispatchQueue.main.async {
                    self.requestTaskSync()
                }
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
            print("[WatchConnectivity] Reachability changed: \(session.isReachable)")
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String : Any]) {
        print("[WatchConnectivity] Received message: \(message)")

        guard let type = message["type"] as? String else {
            return
        }

        switch type {
        case "tasks_updated":
            if let tasksData = message["tasks"] as? Data {
                do {
                    let tasks = try JSONDecoder().decode([WatchTask].self, from: tasksData)
                    DispatchQueue.main.async {
                        self.tasks = tasks
                        self.cacheTasks()
                        print("[WatchConnectivity] Tasks updated from iPhone")
                    }
                } catch {
                    print("[WatchConnectivity] Error decoding tasks: \(error)")
                }
            }
        case "briefing_updated":
            if let paragraph = message["paragraph"] as? String,
               let date = message["date"] as? String {
                DispatchQueue.main.async {
                    self.aihousekeeperBriefingParagraph = paragraph
                    self.aihousekeeperBriefingDate = date
                    AppGroup.storeAihousekeeperBriefing(paragraph: paragraph, date: date)
                    print("[WatchConnectivity] Aihousekeeper briefing updated from iPhone (\(date))")
                }
            }
        default:
            break
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
        print("[WatchConnectivity] Received application context")

        // Update auth tokens if received
        if let token = applicationContext["auth_token"] as? String,
           let householdId = applicationContext["household_id"] as? String {
            AppGroup.defaults.set(token, forKey: AppGroup.authTokenKey)
            AppGroup.defaults.set(householdId, forKey: AppGroup.householdIdKey)
            print("[WatchConnectivity] Auth tokens updated")

            // Refresh tasks with new auth
            DispatchQueue.main.async {
                self.requestTaskSync()
            }
        }

        // Aihousekeeper — pick up briefing from applicationContext (plan §H7).
        if let paragraph = applicationContext["aihousekeeper_briefing_paragraph"] as? String,
           let date = applicationContext["aihousekeeper_briefing_date"] as? String {
            DispatchQueue.main.async {
                self.aihousekeeperBriefingParagraph = paragraph
                self.aihousekeeperBriefingDate = date
                AppGroup.storeAihousekeeperBriefing(paragraph: paragraph, date: date)
                print("[WatchConnectivity] Aihousekeeper briefing received via context (\(date))")
            }
        }
    }
}
