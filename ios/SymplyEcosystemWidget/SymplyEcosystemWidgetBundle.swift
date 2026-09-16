//
//  SymplyEcosystemWidgetBundle.swift
//  SymplyEcosystemWidget
//
//  Entry point for the SymplyEcosystem Home Screen widget. Exposes a single widget,
//  "Mira — Home at a glance", in small / medium / large sizes.
//

import WidgetKit
import SwiftUI

@main
struct SymplyEcosystemWidgetBundle: WidgetBundle {
    var body: some Widget {
        MiraHomeWidget()
    }
}

struct MiraHomeWidget: Widget {
    let kind = "MiraHomeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MiraProvider()) { entry in
            // Brand router — renders the active app's content (SymplyBrandKey.appKey).
            SymplyWidgetEntryView(entry: entry)
        }
        .configurationDisplayName(SymplyWidgetInfo.displayName)
        .description(SymplyWidgetInfo.description)
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
