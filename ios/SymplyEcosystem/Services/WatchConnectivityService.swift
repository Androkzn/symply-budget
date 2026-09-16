//
//  WatchConnectivityService.swift
//  SymplyEcosystem
//
//  Service for communicating with Apple Watch via WatchConnectivity framework
//

import Foundation
import WatchConnectivity

/// Service for handling communication between iOS app and Apple Watch
class WatchConnectivityService: NSObject, WCSessionDelegate {

    static let shared = WatchConnectivityService()

    private var session: WCSession?
    private let apiBaseURL = "https://simple-house-api.a-tekhtelev.workers.dev"

    private override init() {
        super.init()
    }

    /// Activate WatchConnectivity session
    func activate() {
        guard WCSession.isSupported() else {
            print("[WatchConnectivity] WatchConnectivity is not supported on this device")
            return
        }

        session = WCSession.default
        session?.delegate = self
        session?.activate()

        print("[WatchConnectivity] Session activated")

        // Sync initial data to watch
        syncAuthTokensToWatch()
    }

    // MARK: - Data Sync Methods

    /// Sync authentication tokens to watch via ApplicationContext
    func syncAuthTokensToWatch() {
        guard let session = session, session.activationState == .activated else {
            print("[WatchConnectivity] Session not activated, skipping auth sync")
            return
        }

        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            print("[WatchConnectivity] No auth tokens available to sync")
            return
        }

        let context: [String: Any] = [
            "auth_token": token,
            "household_id": householdId,
            "api_base_url": apiBaseURL
        ]

        do {
            try session.updateApplicationContext(context)
            print("[WatchConnectivity] Auth tokens synced to watch")
        } catch {
            print("[WatchConnectivity] Error syncing auth tokens: \(error)")
        }
    }

    /// Sync tasks to watch
    func syncTasksToWatch(_ tasks: [WatchTask]) {
        guard let session = session, session.activationState == .activated else {
            print("[WatchConnectivity] Session not activated, skipping task sync")
            return
        }

        // Cache tasks in App Group for offline access
        AppGroup.cacheTasks(tasks)

        // Send to watch if reachable
        if session.isReachable {
            do {
                let encoded = try JSONEncoder().encode(tasks)
                let message: [String: Any] = [
                    "type": "tasks_updated",
                    "tasks": encoded
                ]

                session.sendMessage(message, replyHandler: nil) { error in
                    print("[WatchConnectivity] Error sending tasks to watch: \(error)")
                }

                print("[WatchConnectivity] Tasks synced to watch (count: \(tasks.count))")
            } catch {
                print("[WatchConnectivity] Error encoding tasks: \(error)")
            }
        } else {
            print("[WatchConnectivity] Watch not reachable, tasks cached for later sync")
        }
    }

    /// Sync today's Aihousekeeper briefing to the Watch (plan §H7).
    ///
    /// Stores in the App Group so the Watch can read it even when the phone is
    /// not reachable, and pushes a `briefing_updated` message if the session is
    /// currently reachable.
    func syncBriefingToWatch(paragraph: String, date: String) {
        // Always cache; the Watch reads from AppGroup on launch.
        AppGroup.storeAihousekeeperBriefing(paragraph: paragraph, date: date)

        guard let session = session, session.activationState == .activated else {
            print("[WatchConnectivity] Session not activated, briefing cached only")
            return
        }

        // Also push into the applicationContext so the Watch receives it on
        // next wake even without an active message channel.
        var context = session.applicationContext
        context["aihousekeeper_briefing_paragraph"] = paragraph
        context["aihousekeeper_briefing_date"] = date
        do {
            try session.updateApplicationContext(context)
        } catch {
            print("[WatchConnectivity] Error updating briefing context: \(error)")
        }

        if session.isReachable {
            let message: [String: Any] = [
                "type": "briefing_updated",
                "paragraph": paragraph,
                "date": date
            ]
            session.sendMessage(message, replyHandler: nil) { error in
                print("[WatchConnectivity] Error sending briefing to watch: \(error)")
            }
            print("[WatchConnectivity] Briefing synced to watch (\(date))")
        } else {
            print("[WatchConnectivity] Watch not reachable; briefing cached + context updated")
        }
    }

    // MARK: - Message Handling

    /// Handle incoming messages from watch
    func session(_ session: WCSession, didReceiveMessage message: [String : Any], replyHandler: @escaping ([String : Any]) -> Void) {

        guard let type = message["type"] as? String else {
            replyHandler(["error": "Invalid message type"])
            return
        }

        print("[WatchConnectivity] Received message from watch: \(type)")

        switch type {
        case "sync_tasks":
            handleTaskSyncRequest(replyHandler: replyHandler)

        case "complete_task":
            handleTaskCompletion(message: message, replyHandler: replyHandler)

        case "complete_subtask":
            handleSubtaskCompletion(message: message, replyHandler: replyHandler)

        case "uncomplete_subtask":
            handleSubtaskUncomplete(message: message, replyHandler: replyHandler)

        case "voice_recording":
            handleVoiceRecording(message: message, replyHandler: replyHandler)

        default:
            replyHandler(["error": "Unknown message type: \(type)"])
        }
    }

    // MARK: - API Request Handlers

    private func handleTaskSyncRequest(replyHandler: @escaping ([String : Any]) -> Void) {
        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            replyHandler(["error": "Not authenticated"])
            return
        }

        let url = URL(string: "\(apiBaseURL)/households/\(householdId)/tasks/watch?days=7")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[WatchConnectivity] Error fetching tasks: \(error)")
                replyHandler(["error": error.localizedDescription])
                return
            }

            if let httpResponse = response as? HTTPURLResponse,
               !(200...299).contains(httpResponse.statusCode) {
                print("[WatchConnectivity] Task fetch failed: HTTP \(httpResponse.statusCode)")
                replyHandler(["error": httpResponse.statusCode == 401
                    ? "Authentication expired. Please sign in again."
                    : "Couldn't load tasks (\(httpResponse.statusCode))"])
                return
            }

            guard let data = data else {
                replyHandler(["error": "No data received"])
                return
            }

            do {
                let tasks = try JSONDecoder().decode([WatchTask].self, from: data)
                let encoded = try JSONEncoder().encode(tasks)

                // Cache tasks
                AppGroup.cacheTasks(tasks)

                replyHandler([
                    "success": true,
                    "tasks": encoded
                ])

                print("[WatchConnectivity] Sent \(tasks.count) tasks to watch")
            } catch {
                print("[WatchConnectivity] Error decoding tasks: \(error)")
                replyHandler(["error": "Failed to decode tasks"])
            }
        }.resume()
    }

    private func handleTaskCompletion(message: [String: Any], replyHandler: @escaping ([String : Any]) -> Void) {
        guard let taskId = message["taskId"] as? String else {
            replyHandler(["error": "Missing taskId"])
            return
        }

        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            replyHandler(["error": "Not authenticated"])
            return
        }

        let notes = message["notes"] as? String

        let url = URL(string: "\(apiBaseURL)/households/\(householdId)/tasks/\(taskId)/complete")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["notes": notes ?? ""]
        request.httpBody = try? JSONSerialization.jsonData(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[WatchConnectivity] Error completing task: \(error)")
                replyHandler(["error": error.localizedDescription])
                return
            }

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                replyHandler(["error": "Request failed"])
                return
            }

            replyHandler(["success": true])
            print("[WatchConnectivity] Task \(taskId) completed from watch")

            // Notify React Native (if needed)
            self.notifyReactNativeOfTaskCompletion(taskId: taskId)
        }.resume()
    }

    private func handleSubtaskCompletion(message: [String: Any], replyHandler: @escaping ([String : Any]) -> Void) {
        guard let taskId = message["taskId"] as? String,
              let subtaskId = message["subtaskId"] as? String else {
            replyHandler(["error": "Missing taskId or subtaskId"])
            return
        }

        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            replyHandler(["error": "Not authenticated"])
            return
        }

        let url = URL(string: "\(apiBaseURL)/households/\(householdId)/tasks/\(taskId)/subtasks/\(subtaskId)/complete")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[WatchConnectivity] Error completing subtask: \(error)")
                replyHandler(["error": error.localizedDescription])
                return
            }

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                replyHandler(["error": "Request failed"])
                return
            }

            replyHandler(["success": true])
            print("[WatchConnectivity] Subtask \(subtaskId) completed from watch")
        }.resume()
    }

    private func handleSubtaskUncomplete(message: [String: Any], replyHandler: @escaping ([String : Any]) -> Void) {
        guard let taskId = message["taskId"] as? String,
              let subtaskId = message["subtaskId"] as? String else {
            replyHandler(["error": "Missing taskId or subtaskId"])
            return
        }

        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            replyHandler(["error": "Not authenticated"])
            return
        }

        let url = URL(string: "\(apiBaseURL)/households/\(householdId)/tasks/\(taskId)/subtasks/\(subtaskId)/uncomplete")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[WatchConnectivity] Error uncompleting subtask: \(error)")
                replyHandler(["error": error.localizedDescription])
                return
            }

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                replyHandler(["error": "Request failed"])
                return
            }

            replyHandler(["success": true])
            print("[WatchConnectivity] Subtask \(subtaskId) uncompleted from watch")
        }.resume()
    }

    private func handleVoiceRecording(message: [String: Any], replyHandler: @escaping ([String : Any]) -> Void) {
        guard let audioData = message["audioData"] as? Data,
              let duration = message["duration"] as? Double,
              let taskId = message["taskId"] as? String else {
            replyHandler(["error": "Missing audio data, duration, or taskId"])
            return
        }

        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            replyHandler(["error": "Not authenticated"])
            return
        }

        // Upload voice note to backend
        let url = URL(string: "\(apiBaseURL)/households/\(householdId)/voice-notes/upload")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        // Create multipart form data
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"voice_\(Date().timeIntervalSince1970).m4a\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[WatchConnectivity] Error uploading voice note: \(error)")
                replyHandler(["error": error.localizedDescription])
                return
            }

            guard let data = data,
                  let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                replyHandler(["error": "Upload failed"])
                return
            }

            // Parse response for transcription
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                replyHandler([
                    "success": true,
                    "transcription": json["transcription"] as? String ?? "",
                    "voice_note_key": json["voice_note_key"] as? String ?? ""
                ])
            } else {
                replyHandler(["success": true])
            }

            print("[WatchConnectivity] Voice note uploaded for task \(taskId)")
        }.resume()
    }

    // MARK: - React Native Notifications

    private func notifyReactNativeOfTaskCompletion(taskId: String) {
        // This will be implemented when we add the React Native bridge
        // For now, just log
        print("[WatchConnectivity] Would notify React Native of task completion: \(taskId)")
    }

    // MARK: - WCSessionDelegate Methods

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error = error {
            print("[WatchConnectivity] Activation failed: \(error)")
        } else {
            print("[WatchConnectivity] Activation completed with state: \(activationState.rawValue)")

            // Sync auth tokens after activation
            if activationState == .activated {
                syncAuthTokensToWatch()
            }
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {
        print("[WatchConnectivity] Session became inactive")
    }

    func sessionDidDeactivate(_ session: WCSession) {
        print("[WatchConnectivity] Session deactivated")
        // Reactivate session
        session.activate()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        print("[WatchConnectivity] Watch reachability changed: \(session.isReachable)")
    }
}
