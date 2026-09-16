//
//  WatchAPIClient.swift
//  SymplyEcosystemWatch
//
//  Direct API client for calling backend when iPhone is unreachable
//

import Foundation

/// API client for direct backend calls from Apple Watch
class WatchAPIClient {

    static let shared = WatchAPIClient()

    private let baseURL = "https://simple-house-api.a-tekhtelev.workers.dev"

    private init() {}

    // MARK: - API Methods

    /// Fetch upcoming tasks (due in next 7 days)
    func fetchUpcomingTasks(days: Int = 7) async throws -> [WatchTask] {
        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            throw APIError.notAuthenticated
        }

        let url = URL(string: "\(baseURL)/households/\(householdId)/tasks/watch?days=\(days)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.requestFailed(statusCode: httpResponse.statusCode)
        }

        let tasks = try JSONDecoder().decode([WatchTask].self, from: data)
        return tasks
    }

    /// Quick-create a task from a raw voice/dictated description.
    /// Mirrors the phone's fast-capture lane: POST the raw text and let the
    /// backend AI enrichment resolve title / due date / priority / subtasks.
    /// Returns immediately (201) with enrichment still pending.
    func createQuickTask(text: String) async throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIError.invalidResponse
        }

        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            throw APIError.notAuthenticated
        }

        let url = URL(string: "\(baseURL)/households/\(householdId)/tasks/quick")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["text": trimmed]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.requestFailed(statusCode: httpResponse.statusCode)
        }
    }

    /// Complete a task
    func completeTask(taskId: String, notes: String?) async throws {
        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            throw APIError.notAuthenticated
        }

        let url = URL(string: "\(baseURL)/households/\(householdId)/tasks/\(taskId)/complete")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["notes": notes ?? ""]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.requestFailed(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }

    /// Toggle subtask completion
    func toggleSubtask(taskId: String, subtaskId: String, isCompleted: Bool) async throws {
        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            throw APIError.notAuthenticated
        }

        let endpoint = isCompleted ? "complete" : "uncomplete"
        let url = URL(string: "\(baseURL)/households/\(householdId)/tasks/\(taskId)/subtasks/\(subtaskId)/\(endpoint)")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.requestFailed(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }

    /// Upload voice recording
    func uploadVoiceRecording(audioData: Data, taskId: String) async throws -> VoiceRecordingResult {
        guard let token = AppGroup.getAuthToken(),
              let householdId = AppGroup.getHouseholdId() else {
            throw APIError.notAuthenticated
        }

        let url = URL(string: "\(baseURL)/households/\(householdId)/voice-notes/upload")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        // Create multipart form data
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()

        // Add audio file
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"voice_\(Date().timeIntervalSince1970).m4a\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)

        // Add task_id field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"task_id\"\r\n\r\n".data(using: .utf8)!)
        body.append(taskId.data(using: .utf8)!)
        body.append("\r\n".data(using: .utf8)!)

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.requestFailed(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }

        let result = try JSONDecoder().decode(VoiceRecordingResult.self, from: data)
        return result
    }
}

// MARK: - API Error Types

enum APIError: LocalizedError {
    case notAuthenticated
    case invalidResponse
    case unauthorized
    case requestFailed(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Not signed in. Open SymplyEcosystem on your iPhone."
        case .invalidResponse:
            return "Invalid server response"
        case .unauthorized:
            return "Session expired. Open SymplyEcosystem on your iPhone to refresh."
        case .requestFailed(let statusCode):
            return "Request failed with status code: \(statusCode)"
        }
    }
}

// MARK: - Voice Recording Result

struct VoiceRecordingResult: Codable {
    let voiceNoteKey: String
    let durationSeconds: Double
    let fileSize: Int
    let transcription: String?

    enum CodingKeys: String, CodingKey {
        case voiceNoteKey = "voice_note_key"
        case durationSeconds = "duration_seconds"
        case fileSize = "file_size"
        case transcription
    }
}
