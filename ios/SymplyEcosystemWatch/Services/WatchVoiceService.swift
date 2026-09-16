//
//  WatchVoiceService.swift
//  SymplyEcosystemWatch
//
//  Service for recording voice notes on Apple Watch
//

import Foundation
import AVFoundation
import Combine
import WatchConnectivity

/// Service for managing voice recording on Apple Watch
class WatchVoiceService: NSObject, ObservableObject {

    @Published var isRecording = false
    @Published var recordingDuration: TimeInterval = 0
    @Published var isUploading = false
    @Published var uploadProgress: Double = 0

    private var audioRecorder: AVAudioRecorder?
    private var recordingTimer: Timer?
    private var recordingStartTime: Date?

    // MARK: - Recording

    /// Request microphone permission
    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    /// Start recording
    func startRecording() async throws -> URL {
        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        try await audioSession.setCategory(.record, mode: .default)
        try await audioSession.setActive(true)

        // Create recording URL
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let audioFilename = documentsPath.appendingPathComponent("voice_\(Date().timeIntervalSince1970).m4a")

        // Configure recording settings (matching iPhone app)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 2,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            AVEncoderBitRateKey: 128000
        ]

        // Create and start recorder
        audioRecorder = try AVAudioRecorder(url: audioFilename, settings: settings)
        audioRecorder?.record()

        isRecording = true
        recordingDuration = 0
        recordingStartTime = Date()

        // Start timer
        startTimer()

        print("[WatchVoice] Recording started: \(audioFilename)")
        return audioFilename
    }

    /// Stop recording
    func stopRecording() async -> (url: URL, duration: TimeInterval)? {
        guard let recorder = audioRecorder else {
            return nil
        }

        recorder.stop()
        stopTimer()

        isRecording = false

        // Deactivate audio session
        try? await AVAudioSession.sharedInstance().setActive(false)

        let url = recorder.url
        let duration = recordingDuration

        print("[WatchVoice] Recording stopped. Duration: \(duration)s")
        return (url, duration)
    }

    /// Cancel recording
    func cancelRecording() async {
        guard let recorder = audioRecorder else {
            return
        }

        recorder.stop()
        recorder.deleteRecording()
        stopTimer()

        isRecording = false
        recordingDuration = 0

        try? await AVAudioSession.sharedInstance().setActive(false)

        print("[WatchVoice] Recording cancelled")
    }

    // MARK: - Upload

    /// Upload recording via iPhone (preferred method)
    func uploadViaPhone(url: URL, taskId: String) async throws -> VoiceRecordingResult {
        guard WCSession.isSupported() else {
            throw VoiceError.phoneNotReachable
        }

        let session = WCSession.default
        guard session.isReachable else {
            throw VoiceError.phoneNotReachable
        }

        isUploading = true
        uploadProgress = 0

        let audioData = try Data(contentsOf: url)
        let duration = recordingDuration

        return try await withCheckedThrowingContinuation { continuation in
            let message: [String: Any] = [
                "type": "voice_recording",
                "audioData": audioData,
                "duration": duration,
                "taskId": taskId
            ]

            session.sendMessage(message, replyHandler: { reply in
                DispatchQueue.main.async {
                    self.isUploading = false
                    self.uploadProgress = 1.0

                    if let error = reply["error"] as? String {
                        continuation.resume(throwing: VoiceError.uploadFailed(error))
                    } else {
                        let result = VoiceRecordingResult(
                            voiceNoteKey: reply["voice_note_key"] as? String ?? "",
                            durationSeconds: duration,
                            fileSize: audioData.count,
                            transcription: reply["transcription"] as? String
                        )
                        continuation.resume(returning: result)
                    }
                }
            }, errorHandler: { error in
                DispatchQueue.main.async {
                    self.isUploading = false
                    continuation.resume(throwing: error)
                }
            })
        }
    }

    /// Upload recording directly to backend (when iPhone not reachable)
    func uploadDirect(url: URL, taskId: String) async throws -> VoiceRecordingResult {
        isUploading = true
        uploadProgress = 0

        let audioData = try Data(contentsOf: url)
        let result = try await WatchAPIClient.shared.uploadVoiceRecording(audioData: audioData, taskId: taskId)

        isUploading = false
        uploadProgress = 1.0

        return result
    }

    /// Smart upload - try phone first, fallback to direct
    func uploadRecording(url: URL, taskId: String) async throws -> VoiceRecordingResult {
        if WCSession.isSupported() && WCSession.default.isReachable {
            // Try uploading via phone first
            do {
                return try await uploadViaPhone(url: url, taskId: taskId)
            } catch {
                print("[WatchVoice] Phone upload failed, trying direct: \(error)")
                // Fallback to direct upload
                return try await uploadDirect(url: url, taskId: taskId)
            }
        } else {
            // Phone not reachable, use direct upload
            return try await uploadDirect(url: url, taskId: taskId)
        }
    }

    // MARK: - Timer

    private func startTimer() {
        recordingTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self, let startTime = self.recordingStartTime else {
                return
            }
            DispatchQueue.main.async {
                self.recordingDuration = Date().timeIntervalSince(startTime)
            }
        }
    }

    private func stopTimer() {
        recordingTimer?.invalidate()
        recordingTimer = nil
        recordingStartTime = nil
    }

    // MARK: - Playback (optional)

    private var audioPlayer: AVAudioPlayer?

    /// Play recorded audio for preview
    func playRecording(url: URL) async throws {
        let audioSession = AVAudioSession.sharedInstance()
        try await audioSession.setCategory(.playback, mode: .default)
        try await audioSession.setActive(true)

        audioPlayer = try AVAudioPlayer(contentsOf: url)
        audioPlayer?.play()
    }

    /// Stop playback
    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
    }
}

// MARK: - Voice Errors

enum VoiceError: LocalizedError {
    case phoneNotReachable
    case recordingFailed
    case uploadFailed(String)
    case permissionDenied

    var errorDescription: String? {
        switch self {
        case .phoneNotReachable:
            return "iPhone not reachable"
        case .recordingFailed:
            return "Recording failed"
        case .uploadFailed(let message):
            return "Upload failed: \(message)"
        case .permissionDenied:
            return "Microphone permission denied"
        }
    }
}
