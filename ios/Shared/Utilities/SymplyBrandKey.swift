//
//  SymplyBrandKey.swift
//  SymplyEcosystem Shared
//
//  Runtime brand content key for the shared Widget / Watch kit. Derived from
//  THIS target's bundle ID (same suffix stripping as AppGroup) so routing never
//  depends on stale DesignTokens.generated.swift bake artifacts.
//

import Foundation

enum SymplyBrandKey {
    /// Stable per-app content key: house, budget, kaizen, language, health.
    /// `com.symply.budget.widget` → `budget`; `com.symply.house` → `house`.
    static let appKey: String = {
        let bundleId = Bundle.main.bundleIdentifier ?? "com.symply.house"
        let base = bundleId
            .replacingOccurrences(of: ".watchkitapp.watchkitextension", with: "")
            .replacingOccurrences(of: ".watchkitapp", with: "")
            .replacingOccurrences(of: ".widget", with: "")
        if base.hasPrefix("com.symply.") {
            return String(base.dropFirst("com.symply.".count))
        }
        return "house"
    }()
}
