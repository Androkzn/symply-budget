//
//  HealthWidgetDataTests.swift
//  SymplyEcosystemWidgetTests
//
//  Locks the WIDENED `widget_health_today` App Group contract (12 fields, up
//  from 6 — weight, weight_trend, nutrition, nutrition_trend, workouts and
//  preferences, each gated to `nil` by its `show_*` toggle server-side). The
//  basic sign-in gate + minimal 6-field payload is already covered by
//  `HealthWidgetGateTests` in WidgetSignInGateTests.swift; this file covers
//  the six NEW fields and the layout-preference defaults.
//
//  `load(from:)` takes an injectable UserDefaults, so these run headless with
//  no App Group entitlement (same pattern as KaizenWidgetDataTests).
//

import Foundation
import Testing
@testable import SymplyEcosystemWidgetExtension

@Suite(.serialized)
struct HealthWidgetDataTests {

    private static let suiteName = "com.symply.health.widgetdatatests"

    private func makeDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: Self.suiteName)!
        defaults.removePersistentDomain(forName: Self.suiteName)
        return defaults
    }

    private func signIn(_ d: UserDefaults) { d.set("hh-1", forKey: WidgetStore.householdIdKey) }

    private func write(_ json: String, to defaults: UserDefaults) {
        defaults.set(Data(json.utf8), forKey: HealthWidgetData.todayKey)
    }

    /// Byte-for-byte what `toHealthWidgetPayload()` serialises for a member with
    /// every domain switched on (mirrors `factsFromWidgetSnapshot`'s output shape
    /// in `healthWidgetStorage.ts`).
    private let fullJSON = #"""
    {
      "steps": 7240, "steps_goal": 10000,
      "water_ml": 1200, "water_goal_ml": 2000,
      "move_pct": 0.68,
      "next_reminder": { "title": "Evening walk", "at": "2026-07-13T18:30:00Z" },
      "weight": { "value": 70.5, "unit": "kg", "date": "2026-07-13" },
      "weight_trend": {
        "unit": "kg",
        "entries": [{ "date": "2026-07-13", "weight": 70.5 }],
        "avg_this_week": 70.8, "avg_last_week": 71.2,
        "starting_weight_kg": 80, "starting_weight_date": "2026-01-01",
        "progress_from_start": -9.5, "progress_percentage": -11.9
      },
      "nutrition": {
        "calories": 1450, "proteins": 90, "carbohydrates": 140, "fats": 50,
        "goal_calories": 2000, "protein_target": 120, "carbs_target": 250, "fats_target": 65
      },
      "nutrition_trend": {
        "entries": [{ "date": "2026-07-13", "calories": 1800 }],
        "avg_this_week": 1750, "avg_last_week": 1900
      },
      "workouts": { "count": 1, "minutes": 20, "calories": 150, "goal_minutes": 30 },
      "preferences": {
        "small_widget_metric": "calories", "small_widget_style": "compact",
        "medium_widget_layout": "dual", "medium_primary_metric": "steps",
        "medium_secondary_metric": "water", "medium_show_all_metrics": false,
        "chart_type": "line", "chart_metric": "both"
      }
    }
    """#

    // MARK: - Full decode

    @Test func decodesEveryNewDomainFromTheProducersExactPayload() {
        let d = makeDefaults(); signIn(d)
        write(fullJSON, to: d)

        let data = HealthWidgetData.load(from: d)
        #expect(data != nil)

        #expect(data?.weight?.value == 70.5)
        #expect(data?.weight?.unit == "kg")

        #expect(data?.weightTrend?.entries.count == 1)
        #expect(data?.weightTrend?.entries.first?.weight == 70.5)
        #expect(data?.weightTrend?.avgThisWeek == 70.8)
        #expect(data?.weightTrend?.avgLastWeek == 71.2)
        #expect(data?.weightTrend?.startingWeightKg == 80)
        #expect(data?.weightTrend?.progressFromStart == -9.5)
        #expect(data?.weightTrend?.progressPercentage == -11.9)

        #expect(data?.nutrition?.calories == 1450)
        #expect(data?.nutrition?.proteinTarget == 120)
        #expect(data?.nutrition?.carbsTarget == 250)
        #expect(data?.nutrition?.fatsTarget == 65)

        #expect(data?.nutritionTrend?.entries.first?.calories == 1800)
        #expect(data?.nutritionTrend?.avgThisWeek == 1750)

        #expect(data?.workouts?.minutes == 20)
        #expect(data?.workouts?.goalMinutes == 30)

        #expect(data?.preferences?.smallWidgetStyle == "compact")
        #expect(data?.preferences?.mediumWidgetLayout == "dual")
        #expect(data?.preferences?.mediumSecondaryMetric == "water")
        #expect(data?.preferences?.mediumShowAllMetrics == false)
        #expect(data?.preferences?.chartType == "line")
        #expect(data?.preferences?.chartMetric == "both")
    }

    // MARK: - Toggle-gated domains decode as nil, not a decode failure

    @Test func aHiddenDomainDecodesAsNilNotAsAMissingWidget() {
        // show_weight=false / show_nutrition=false / show_workouts=false server-side
        // means these keys arrive as explicit JSON `null`, not omitted — the whole
        // payload must still decode.
        let d = makeDefaults(); signIn(d)
        write(
            #"""
            { "steps": 7240, "steps_goal": 10000, "water_ml": 1200, "water_goal_ml": 2000,
              "move_pct": 0.5, "next_reminder": null,
              "weight": null, "weight_trend": null,
              "nutrition": null, "nutrition_trend": null,
              "workouts": null, "preferences": null }
            """#,
            to: d
        )

        let data = HealthWidgetData.load(from: d)
        #expect(data != nil)
        #expect(data?.steps == 7240)
        #expect(data?.weight == nil)
        #expect(data?.weightTrend == nil)
        #expect(data?.nutrition == nil)
        #expect(data?.nutritionTrend == nil)
        #expect(data?.workouts == nil)
        #expect(data?.preferences == nil)
    }

    // MARK: - A minimal (pre-widening) payload still decodes

    @Test func aLegacySixFieldPayloadStillDecodes() {
        // A cached payload written before this change (or a lightweight local
        // publish, e.g. HealthHomeScreen's steps/water effect) omits the six new
        // keys entirely rather than nulling them — both must decode identically.
        let d = makeDefaults(); signIn(d)
        write(
            #"{"steps":7240,"steps_goal":10000,"water_ml":1200,"water_goal_ml":2000,"move_pct":0.5,"next_reminder":null}"#,
            to: d
        )

        let data = HealthWidgetData.load(from: d)
        #expect(data != nil)
        #expect(data?.steps == 7240)
        #expect(data?.weight == nil)
        #expect(data?.preferences == nil)
    }

    // MARK: - Preference defaults when preferences is nil

    @Test func resolvedPreferencesFallBackToStandardWhenNil() {
        let data = HealthWidgetData(
            steps: nil, stepsGoal: nil, waterMl: nil, waterGoalMl: nil, movePct: nil,
            nextReminder: nil, weight: nil, weightTrend: nil, nutrition: nil,
            nutritionTrend: nil, workouts: nil, preferences: nil
        )
        #expect(data.resolvedSmallStyle == "standard")
        #expect(data.resolvedMediumLayout == "standard")
        #expect(data.resolvedMediumShowAll == true)
        #expect(data.resolvedChartType == "bar")
        #expect(data.resolvedChartMetric == "weight")
    }

    // MARK: - Sample is fully populated for the widget gallery

    @Test func sampleIncludesEveryDomainForThePreviewGallery() {
        let sample = HealthWidgetData.sample
        #expect(sample.weight != nil)
        #expect(sample.weightTrend != nil)
        #expect(sample.nutrition != nil)
        #expect(sample.nutritionTrend != nil)
        #expect(sample.workouts != nil)
        #expect(sample.preferences != nil)
    }
}
