//
//  TaskCountProvider.swift
//  SymplyEcosystemWatch
//
//  Complication data provider for displaying task count on watch faces
//

import ClockKit

class TaskCountProvider: NSObject, CLKComplicationDataSource {

    // MARK: - Timeline Configuration

    func getTimelineEndDate(for complication: CLKComplication, withHandler handler: @escaping (Date?) -> Void) {
        // Update complications every hour
        handler(Date().addingTimeInterval(3600))
    }

    func getPrivacyBehavior(for complication: CLKComplication, withHandler handler: @escaping (CLKComplicationPrivacyBehavior) -> Void) {
        // Show on lock screen
        handler(.showOnLockScreen)
    }

    // MARK: - Timeline Population

    func getCurrentTimelineEntry(for complication: CLKComplication, withHandler handler: @escaping (CLKComplicationTimelineEntry?) -> Void) {
        // Get current task count
        let tasks = AppGroup.getCachedTasks() ?? []
        let upcomingCount = tasks.filter { $0.isUpcoming || $0.isDueToday }.count

        guard let template = createTemplate(for: complication.family, taskCount: upcomingCount) else {
            handler(nil)
            return
        }

        let entry = CLKComplicationTimelineEntry(date: Date(), complicationTemplate: template)
        handler(entry)
    }

    func getTimelineEntries(for complication: CLKComplication, after date: Date, limit: Int, withHandler handler: @escaping ([CLKComplicationTimelineEntry]?) -> Void) {
        // No future timeline - update happens via app
        handler(nil)
    }

    // MARK: - Placeholder

    func getLocalizableSampleTemplate(for complication: CLKComplication, withHandler handler: @escaping (CLKComplicationTemplate?) -> Void) {
        handler(createTemplate(for: complication.family, taskCount: 3))
    }

    // MARK: - Template Creation

    private func createTemplate(for family: CLKComplicationFamily, taskCount: Int) -> CLKComplicationTemplate? {
        let countText = "\(taskCount)"
        let labelText = taskCount == 1 ? "Task" : "Tasks"

        switch family {
        case .circularSmall:
            let template = CLKComplicationTemplateCircularSmallStackText()
            template.line1TextProvider = CLKSimpleTextProvider(text: countText)
            template.line2TextProvider = CLKSimpleTextProvider(text: "")
            return template

        case .modularSmall:
            let template = CLKComplicationTemplateModularSmallStackText()
            template.line1TextProvider = CLKSimpleTextProvider(text: countText)
            template.line2TextProvider = CLKSimpleTextProvider(text: labelText)
            return template

        case .modularLarge:
            let template = CLKComplicationTemplateModularLargeStandardBody()
            template.headerTextProvider = CLKSimpleTextProvider(text: "SymplyEcosystem")
            template.body1TextProvider = CLKSimpleTextProvider(text: "\(countText) upcoming \(labelText.lowercased())")
            return template

        case .utilitarianSmall, .utilitarianSmallFlat:
            let template = CLKComplicationTemplateUtilitarianSmallFlat()
            template.textProvider = CLKSimpleTextProvider(text: "\(countText) \(labelText)")
            return template

        case .utilitarianLarge:
            let template = CLKComplicationTemplateUtilitarianLargeFlat()
            template.textProvider = CLKSimpleTextProvider(text: "SymplyEcosystem: \(countText) \(labelText)")
            return template

        case .graphicCorner:
            let template = CLKComplicationTemplateGraphicCornerStackText()
            template.outerTextProvider = CLKSimpleTextProvider(text: labelText)
            template.innerTextProvider = CLKSimpleTextProvider(text: countText)
            return template

        case .graphicCircular:
            let template = CLKComplicationTemplateGraphicCircularStackText()
            template.line1TextProvider = CLKSimpleTextProvider(text: countText)
            template.line2TextProvider = CLKSimpleTextProvider(text: labelText)
            return template

        case .graphicBezel:
            let circularTemplate = CLKComplicationTemplateGraphicCircularStackText()
            circularTemplate.line1TextProvider = CLKSimpleTextProvider(text: countText)
            circularTemplate.line2TextProvider = CLKSimpleTextProvider(text: labelText)

            let template = CLKComplicationTemplateGraphicBezelCircularText()
            template.circularTemplate = circularTemplate
            template.textProvider = CLKSimpleTextProvider(text: "SymplyEcosystem")
            return template

        case .graphicRectangular:
            let template = CLKComplicationTemplateGraphicRectangularStandardBody()
            template.headerTextProvider = CLKSimpleTextProvider(text: "SymplyEcosystem")
            template.body1TextProvider = CLKSimpleTextProvider(text: "\(countText) upcoming")
            template.body2TextProvider = CLKSimpleTextProvider(text: labelText.lowercased())
            return template

        case .graphicExtraLarge:
            let template = CLKComplicationTemplateGraphicExtraLargeCircularStackText()
            template.line1TextProvider = CLKSimpleTextProvider(text: countText)
            template.line2TextProvider = CLKSimpleTextProvider(text: labelText)
            return template

        @unknown default:
            return nil
        }
    }

    // MARK: - Complication Update

    /// Request complication update (call this when tasks change)
    static func requestUpdate() {
        let server = CLKComplicationServer.sharedInstance()

        if let complications = server.activeComplications {
            for complication in complications {
                server.reloadTimeline(for: complication)
            }
            print("[Complication] Requested update for \(complications.count) complications")
        }
    }
}
