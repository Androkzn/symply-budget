//
//  SymplyEcosystemWatchApp.swift
//  SymplyEcosystemWatch
//
//  Main entry point for the Apple Watch app
//

import SwiftUI

@main
struct SymplyEcosystemWatchApp: App {

    @StateObject private var connectivity = WatchConnectivityManager.shared

    var body: some Scene {
        WindowGroup {
            rootView
                .environmentObject(connectivity)
        }
    }

    /// Brand router — House keeps its rich task app; other brands show their glance
    /// view. `SymplyBrandKey.appKey` is derived at runtime from the watch bundle ID.
    @ViewBuilder
    private var rootView: some View {
        switch SymplyBrandKey.appKey {
        case "budget":   SymplyBudgetWatchView()
        case "kaizen":   SymplyKaizenWatchView()
        case "language": SymplyLanguageWatchView()
        case "health":   SymplyHealthWatchView()
        default:         TaskListView()
        }
    }
}
