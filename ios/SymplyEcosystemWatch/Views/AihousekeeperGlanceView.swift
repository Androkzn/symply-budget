//
//  AihousekeeperGlanceView.swift
//  SymplyEcosystemWatch
//
//  Aihousekeeper (Proactive Layer) glance view — plan §H7.
//
//  Displays today's briefing paragraph delivered from the iPhone via
//  WatchConnectivity (message + applicationContext) and cached in the
//  shared App Group so it renders even when the phone isn't reachable.
//

import SwiftUI

struct AihousekeeperGlanceView: View {

    @EnvironmentObject var connectivity: WatchConnectivityManager

    /// ISO date (YYYY-MM-DD) for "today" in the user's current calendar.
    private var todayIso: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private var isStale: Bool {
        guard let date = connectivity.aihousekeeperBriefingDate else { return false }
        return date != todayIso
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "sunrise.fill")
                        .foregroundColor(.orange)
                    Text("Aihousekeeper")
                        .font(.headline)
                    Spacer()
                }

                if let paragraph = connectivity.aihousekeeperBriefingParagraph {
                    if isStale, let date = connectivity.aihousekeeperBriefingDate {
                        Text("Last updated \(date)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    Text(paragraph)
                        .font(.footnote)
                        .foregroundColor(.primary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("briefing-content")
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No briefing yet")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                            .accessibilityIdentifier("briefing-empty-state")
                        Text("Open SymplyEcosystem on your iPhone to generate today's briefing.")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
        .accessibilityIdentifier("briefing-screen")
        .navigationTitle("Briefing")
    }
}

#Preview {
    AihousekeeperGlanceView()
        .environmentObject(WatchConnectivityManager.shared)
}
