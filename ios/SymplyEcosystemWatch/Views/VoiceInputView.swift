//
//  VoiceInputView.swift
//  SymplyEcosystemWatch
//
//  Voice recording interface for Apple Watch
//

import SwiftUI

struct VoiceInputView: View {

    let taskId: String

    @StateObject private var voiceService = WatchVoiceService()
    @State private var recordingState: RecordingState = .idle
    @State private var recordingURL: URL?
    @State private var transcript = ""
    @State private var errorMessage: String?

    @Environment(\.dismiss) private var dismiss

    enum RecordingState {
        case idle
        case requestingPermission
        case recording
        case recorded
        case uploading
        case complete
        case error
    }

    var body: some View {
        VStack(spacing: 16) {
            switch recordingState {
            case .idle:
                idleView

            case .requestingPermission:
                ProgressView("Requesting permission...")

            case .recording:
                recordingView

            case .recorded:
                recordedView

            case .uploading:
                uploadingView

            case .complete:
                completeView

            case .error:
                errorView
            }
        }
        .padding()
        .navigationTitle("Voice Note")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - State Views

    private var idleView: some View {
        VStack(spacing: 20) {
            Button(action: requestPermissionAndStart) {
                VStack(spacing: 12) {
                    Image(systemName: "mic.circle.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.red)

                    Text("Tap to Record")
                        .font(.headline)
                }
            }
            .buttonStyle(.plain)

            Text("Record a voice note for this task")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var recordingView: some View {
        VStack(spacing: 20) {
            // Waveform animation
            Image(systemName: "waveform")
                .font(.system(size: 50))
                .foregroundColor(.red)
                .symbolEffect(.variableColor.iterative.dimInactiveLayers, options: .repeating)

            // Timer
            Text(formatTime(voiceService.recordingDuration))
                .font(.title2)
                .monospacedDigit()
                .foregroundColor(.red)

            // Stop button
            Button(action: stopRecording) {
                Label("Stop Recording", systemImage: "stop.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)

            // Cancel button
            Button("Cancel") {
                cancelRecording()
            }
            .buttonStyle(.bordered)
            .font(.caption)
        }
    }

    private var recordedView: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 50))
                .foregroundColor(.green)

            Text("Recording saved")
                .font(.headline)

            Text(formatTime(voiceService.recordingDuration))
                .font(.caption)
                .foregroundColor(.secondary)

            VStack(spacing: 12) {
                Button(action: uploadRecording) {
                    Label("Upload Recording", systemImage: "icloud.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                HStack(spacing: 12) {
                    Button("Re-record") {
                        deleteRecording()
                        recordingState = .idle
                    }
                    .buttonStyle(.bordered)

                    Button("Cancel") {
                        deleteRecording()
                        dismiss()
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private var uploadingView: some View {
        VStack(spacing: 20) {
            ProgressView(value: voiceService.uploadProgress) {
                Text("Uploading...")
                    .font(.headline)
            }

            Text("\(Int(voiceService.uploadProgress * 100))%")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    private var completeView: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 50))
                .foregroundColor(.green)

            Text("Voice note uploaded!")
                .font(.headline)

            if !transcript.isEmpty {
                ScrollView {
                    Text(transcript)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding()
                        .background(Color.gray.opacity(0.2))
                        .cornerRadius(8)
                }
                .frame(maxHeight: 100)
            }

            Button("Done") {
                dismiss()
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private var errorView: some View {
        VStack(spacing: 20) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 50))
                .foregroundColor(.orange)

            Text("Error")
                .font(.headline)

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 12) {
                Button("Try Again") {
                    recordingState = .idle
                    errorMessage = nil
                }
                .buttonStyle(.borderedProminent)

                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // MARK: - Actions

    private func requestPermissionAndStart() {
        recordingState = .requestingPermission

        Task {
            let granted = await voiceService.requestPermission()

            if granted {
                startRecording()
            } else {
                await MainActor.run {
                    recordingState = .error
                    errorMessage = "Microphone permission denied"
                }
            }
        }
    }

    private func startRecording() {
        Task {
            do {
                let url = try await voiceService.startRecording()
                await MainActor.run {
                    recordingURL = url
                    recordingState = .recording
                }
            } catch {
                await MainActor.run {
                    recordingState = .error
                    errorMessage = "Failed to start recording: \(error.localizedDescription)"
                }
            }
        }
    }

    private func stopRecording() {
        Task {
            if let result = await voiceService.stopRecording() {
                await MainActor.run {
                    recordingURL = result.url
                    recordingState = .recorded
                }
            } else {
                await MainActor.run {
                    recordingState = .error
                    errorMessage = "Failed to save recording"
                }
            }
        }
    }

    private func cancelRecording() {
        Task {
            await voiceService.cancelRecording()
            await MainActor.run {
                recordingState = .idle
            }
        }
    }

    private func uploadRecording() {
        guard let url = recordingURL else {
            return
        }

        recordingState = .uploading

        Task {
            do {
                let result = try await voiceService.uploadRecording(url: url, taskId: taskId)

                await MainActor.run {
                    transcript = result.transcription ?? ""
                    recordingState = .complete
                }
            } catch {
                await MainActor.run {
                    recordingState = .error
                    errorMessage = "Upload failed: \(error.localizedDescription)"
                }
            }
        }
    }

    private func deleteRecording() {
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
            recordingURL = nil
        }
    }

    // MARK: - Helpers

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

#Preview {
    NavigationStack {
        VoiceInputView(taskId: "task123")
    }
}
