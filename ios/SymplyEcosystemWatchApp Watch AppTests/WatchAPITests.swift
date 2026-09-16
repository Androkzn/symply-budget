//
//  WatchAPITests.swift
//  SymplyEcosystemWatchApp Watch AppTests
//

import Foundation
import Testing
@testable import SymplyEcosystemWatchApp_Watch_App

struct WatchAPITests {

    @Test func apiErrorDescriptions() {
        #expect(APIError.notAuthenticated.errorDescription?.contains("signed in") == true)
        #expect(APIError.unauthorized.errorDescription?.contains("expired") == true)
        #expect(APIError.invalidResponse.errorDescription?.contains("Invalid") == true)
        #expect(APIError.requestFailed(statusCode: 500).errorDescription?.contains("500") == true)
    }

    @Test func createQuickTaskRejectsEmptyTextBeforeNetwork() async {
        // Blank / whitespace-only dictation must fail fast with a validation
        // error rather than posting an empty task to the backend.
        await #expect(throws: APIError.self) {
            try await WatchAPIClient.shared.createQuickTask(text: "   \n  ")
        }
    }

    @Test func voiceRecordingResultDecodesFromJSON() throws {
        let json = """
        {
          "voice_note_key": "notes/abc.m4a",
          "duration_seconds": 12.5,
          "file_size": 4096,
          "transcription": "Replace the filter"
        }
        """.data(using: .utf8)!

        let result = try JSONDecoder().decode(VoiceRecordingResult.self, from: json)
        #expect(result.voiceNoteKey == "notes/abc.m4a")
        #expect(result.durationSeconds == 12.5)
        #expect(result.fileSize == 4096)
        #expect(result.transcription == "Replace the filter")
    }
}
