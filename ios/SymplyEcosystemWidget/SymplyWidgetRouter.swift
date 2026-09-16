//
//  SymplyWidgetRouter.swift
//  SymplyEcosystemWidget
//
//  ONE shared widget target serves all 5 Symply apps. This router renders the
//  ACTIVE brand's content — selected by `SymplyBrandKey.appKey` (derived at runtime
//  from this extension's bundle ID, same rules as AppGroup). Each per-app content view loads its own
//  App-Group snapshot (via its `load()`) and shows `SymplyEmptyState` when signed
//  out / no data, so every brand shares the same shell + conventions but differs in
//  functionality.
//
//  Wiring: in SymplyEcosystemWidgetBundle.swift, render `SymplyWidgetEntryView(entry:)`
//  instead of `MiraWidgetEntryView(entry:)`. The `entry` (MiraEntry) still drives
//  the timeline refresh cadence from MiraProvider; content is (re)loaded per brand.
//

import WidgetKit
import SwiftUI

/// Per-brand widget gallery name + description (shown in the widget picker).
enum SymplyWidgetInfo {
    static var displayName: String {
        switch SymplyBrandKey.appKey {
        case "budget": return "Budget — at a glance"
        case "kaizen": return "Kaizen — today"
        case "language": return "Language — today"
        case "health": return "Health — today"
        default: return "Mira — Home at a glance"
        }
    }
    static var description: String {
        switch SymplyBrandKey.appKey {
        case "budget": return "This month's budget and your next bill."
        case "kaizen": return "Today's habits and your current streak."
        case "language": return "Your streak, XP, and next lesson."
        case "health": return "Your activity, water, and next reminder."
        default: return "Your daily Mira brief plus the week's most urgent home tasks."
        }
    }
}

struct SymplyWidgetEntryView: View {
    /// Kept for a drop-in swap with `MiraWidgetEntryView` and to carry the
    /// provider's refresh timestamp; per-brand content loads its own snapshot.
    var entry: MiraEntry

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        brandContent
            // REQUIRED on iOS 17+ (strictly enforced on iOS 26): every widget must
            // adopt the container-background API or the system replaces its body with
            // the "Please adopt containerBackground API" placeholder. Applied here at
            // the single shared entry point so all 5 brands satisfy it. Paints the same
            // brand surface `SymplyCard` uses, edge to edge (contentMarginsDisabled).
            .widgetContainerBackground { BrandTokens.background(scheme) }
    }

    @ViewBuilder
    private var brandContent: some View {
        // In the widget gallery / placeholder, WidgetKit has no App-Group data to
        // load, so each brand renders illustrative sample content instead of its
        // signed-out empty state — the picker then shows what every size looks like.
        let preview = entry.isPlaceholder
        switch SymplyBrandKey.appKey {
        case "budget":
            SymplyBudgetWidgetContent(summary: preview ? .sample : BudgetSummary.load())
        case "kaizen":
            SymplyKaizenWidgetContent(data: preview ? .sample : KaizenWidgetData.load())
        case "language":
            SymplyLanguageWidgetContent(data: preview ? .sample : LanguageWidgetData.load())
        case "health":
            SymplyHealthWidgetContent(data: preview ? .sample : HealthWidgetData.load())
        default: // house (and any future brand) → the reference implementation
            SymplyHouseWidgetContent(entry: preview ? .sample : SymplyHouseWidgetEntry.load())
        }
    }
}
