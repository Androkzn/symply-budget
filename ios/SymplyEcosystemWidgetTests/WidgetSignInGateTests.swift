//
//  WidgetSignInGateTests.swift
//  SymplyEcosystemWidgetTests
//
//  Matrix: BUDGET-WIDGET-013…016, HEALTH-WIDGET-011 (the auth-gate defect, now fixed)
//  (documents/engineering/testing/matrices/budget.md · health.md)
//
//  Locks the CONSUMER side of the snapshot brands' App Group contract after the
//  "logged in but widget says Sign in" fix:
//
//    • `load(from:)` gates on a present `current_household_id` (WidgetStore.isSignedIn)
//      — NOT on `auth_token`, which the app deliberately never writes
//      (WidgetSyncModule.setAuth strips it). Requiring `auth_token` had pinned the
//      Budget + Health widgets to the empty state for every signed-in user.
//    • The gallery/preview `sample` is populated so the widget picker illustrates
//      each size instead of showing the signed-out empty state.
//
//  `load(from:)` takes an injectable UserDefaults, so these run headless with no
//  App Group entitlement (same pattern as KaizenWidgetDataTests).
//

import Foundation
import Testing
@testable import SymplyEcosystemWidgetExtension

// MARK: - Budget

@Suite(.serialized)
struct BudgetWidgetGateTests {

    private static let suiteName = "com.symply.budget.widgettests"

    private func makeDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: Self.suiteName)!
        defaults.removePersistentDomain(forName: Self.suiteName)
        return defaults
    }

    /// The exact snake_cased payload `BudgetHomeScreen` writes to the App Group.
    private let summaryJSON =
        #"{"remaining_cents":84200,"spent_cents":165800,"budget_cents":250000,"period_label":"July 2026"}"#

    private func signIn(_ d: UserDefaults) { d.set("hh-1", forKey: WidgetStore.householdIdKey) }
    private func writeSummary(_ d: UserDefaults) { d.set(Data(summaryJSON.utf8), forKey: BudgetSummary.appGroupKey) }

    // BUDGET-WIDGET-013 — signed in + snapshot → decodes the producer payload.
    @Test func loadDecodesWhenSignedInWithSnapshot() {
        let d = makeDefaults(); signIn(d); writeSummary(d)

        let s = BudgetSummary.load(from: d)
        #expect(s != nil)
        #expect(s?.remainingCents == 84_200)
        #expect(s?.spentCents == 165_800)
        #expect(s?.budgetCents == 250_000)
    }

    // BUDGET-WIDGET-014 — regression guard: a signed-in user whose App Group has NO
    // `auth_token` (the app never writes it) must still render. This is the exact bug.
    @Test func loadDoesNotRequireAuthToken() {
        let d = makeDefaults(); signIn(d); writeSummary(d)

        #expect(d.string(forKey: "auth_token") == nil, "the app must never write the product JWT")
        #expect(BudgetSummary.load(from: d) != nil)
    }

    // BUDGET-WIDGET-015 — signed out (no household) → nil → empty state, even if a
    // stale snapshot lingers.
    @Test func loadReturnsNilWhenSignedOut() {
        let d = makeDefaults(); writeSummary(d) // snapshot present, but no household id
        #expect(BudgetSummary.load(from: d) == nil)
    }

    @Test func loadReturnsNilWhenSignedInButNoSnapshot() {
        let d = makeDefaults(); signIn(d)
        #expect(BudgetSummary.load(from: d) == nil)
    }

    @Test func loadReturnsNilForMalformedJSON() {
        let d = makeDefaults(); signIn(d)
        d.set(Data("}{ not json".utf8), forKey: BudgetSummary.appGroupKey)
        #expect(BudgetSummary.load(from: d) == nil)
    }

    // BUDGET-WIDGET-016 — the gallery/preview sample is populated so the picker shows
    // a real layout, not the signed-out empty state.
    @Test func sampleIsPopulatedForPreviews() {
        let s = BudgetSummary.sample
        #expect(s.budgetCents > 0)
        #expect(s.spentCents > 0)
        #expect(s.nextBill != nil)
    }

    @Test func appGroupKeyMatchesProducerContract() {
        #expect(BudgetSummary.appGroupKey == "widget_budget_summary")
    }

    // BUDGET-WIDGET-017 — savings + trend decode from the producer's snake_case
    // payload and drive BudgetBrief's trend label/tint/icon.
    private let summaryWithSavingsJSON =
        #"{"remaining_cents":84200,"spent_cents":165800,"budget_cents":250000,"savings_cents":42000,"savings_prev_cents":31500}"#

    @Test func loadDecodesSavingsFields() {
        let d = makeDefaults(); signIn(d)
        d.set(Data(summaryWithSavingsJSON.utf8), forKey: BudgetSummary.appGroupKey)

        let s = BudgetSummary.load(from: d)
        #expect(s?.savingsCents == 42_000)
        #expect(s?.savingsPrevCents == 31_500)
    }

    @Test func savingsTrendLabelIsPositivePercentWhenUpVsLastMonth() {
        let brief = BudgetBrief(summary: BudgetSummary(
            remainingCents: 0, spentCents: 0, budgetCents: 0, currency: "USD", topCategory: nil, nextBill: nil,
            savingsCents: 4200, savingsPrevCents: 3150, projectedYearEndCents: nil, insightTone: nil, insightMessage: nil, insightEmoji: nil
        ))
        // (4200 - 3150) / 3150 = 33.3% → rounds to 33
        #expect(brief.savingsTrendLabel == "+33% vs last month")
        #expect(brief.savingsTrendUp == true)
        #expect(brief.savingsTrendIcon == "arrow.up.right")
    }

    @Test func savingsTrendLabelIsNegativePercentWhenDownVsLastMonth() {
        let brief = BudgetBrief(summary: BudgetSummary(
            remainingCents: 0, spentCents: 0, budgetCents: 0, currency: "USD", topCategory: nil, nextBill: nil,
            savingsCents: 2000, savingsPrevCents: 4000, projectedYearEndCents: nil, insightTone: nil, insightMessage: nil, insightEmoji: nil
        ))
        #expect(brief.savingsTrendLabel == "-50% vs last month")
        #expect(brief.savingsTrendUp == false)
        #expect(brief.savingsTrendIcon == "arrow.down.right")
    }

    // Regression: no prior-month figure must not render a directional arrow —
    // that would imply a trend the data doesn't actually support.
    @Test func savingsTrendIsNeutralWithNoPriorMonth() {
        let brief = BudgetBrief(summary: BudgetSummary(
            remainingCents: 0, spentCents: 0, budgetCents: 0, currency: "USD", topCategory: nil, nextBill: nil,
            savingsCents: 4200, savingsPrevCents: nil, projectedYearEndCents: nil, insightTone: nil, insightMessage: nil, insightEmoji: nil
        ))
        #expect(brief.savingsTrendLabel == nil)
        #expect(brief.savingsTrendIcon == "banknote.fill")
    }

    @Test func hasSavingsIsFalseWhenFieldAbsent() {
        let d = makeDefaults(); signIn(d); writeSummary(d) // legacy payload, no savings keys
        #expect(BudgetSummary.load(from: d)?.savingsCents == nil)
        let brief = BudgetBrief(summary: BudgetSummary.load(from: d)!)
        #expect(brief.hasSavings == false)
    }

    @Test func hasProjectionIsTrueOnlyWhenFieldPresent() {
        let withProjection = BudgetBrief(summary: BudgetSummary(
            remainingCents: 0, spentCents: 0, budgetCents: 0, currency: "USD", topCategory: nil, nextBill: nil,
            savingsCents: nil, savingsPrevCents: nil, projectedYearEndCents: 420_000, insightTone: nil, insightMessage: nil, insightEmoji: nil
        ))
        #expect(withProjection.hasProjection == true)
        #expect(withProjection.projectedYearEnd == "$4,200")

        let withoutProjection = BudgetBrief(summary: BudgetSummary(
            remainingCents: 0, spentCents: 0, budgetCents: 0, currency: "USD", topCategory: nil, nextBill: nil,
            savingsCents: nil, savingsPrevCents: nil, projectedYearEndCents: nil, insightTone: nil, insightMessage: nil, insightEmoji: nil
        ))
        #expect(withoutProjection.hasProjection == false)
    }

    // BUDGET-WIDGET-018 — AI insight decode + tone → tint mapping.
    @Test func loadDecodesInsightFields() {
        let d = makeDefaults(); signIn(d)
        let json = #"{"remaining_cents":0,"spent_cents":0,"budget_cents":0,"insight_tone":"celebrate","insight_message":"Nice work!","insight_emoji":"🎉"}"#
        d.set(Data(json.utf8), forKey: BudgetSummary.appGroupKey)

        let s = BudgetSummary.load(from: d)
        #expect(s?.insightTone == "celebrate")
        #expect(s?.insightMessage == "Nice work!")
        #expect(s?.insightEmoji == "🎉")
    }

    @Test func insightTintMapsWatchToneToAmber() {
        let brief = BudgetBrief(summary: BudgetSummary(
            remainingCents: 0, spentCents: 0, budgetCents: 0, currency: nil, topCategory: nil, nextBill: nil,
            savingsCents: nil, savingsPrevCents: nil, projectedYearEndCents: nil, insightTone: "watch", insightMessage: "Spending is running hot.", insightEmoji: nil
        ))
        #expect(brief.insightTint == WidgetTheme.amber)
    }

    @Test func insightMessageIsNilWhenEmptyString() {
        let brief = BudgetBrief(summary: BudgetSummary(
            remainingCents: 0, spentCents: 0, budgetCents: 0, currency: nil, topCategory: nil, nextBill: nil,
            savingsCents: nil, savingsPrevCents: nil, projectedYearEndCents: nil, insightTone: nil, insightMessage: "", insightEmoji: nil
        ))
        #expect(brief.insightMessage == nil)
    }
}

// MARK: - Health

@Suite(.serialized)
struct HealthWidgetGateTests {

    private static let suiteName = "com.symply.health.widgettests"

    private func makeDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: Self.suiteName)!
        defaults.removePersistentDomain(forName: Self.suiteName)
        return defaults
    }

    /// The snake_cased payload `HealthHomeScreen` writes.
    private let todayJSON =
        #"{"steps":7240,"steps_goal":10000,"water_ml":1200,"water_goal_ml":2000,"move_pct":68}"#

    private func signIn(_ d: UserDefaults) { d.set("hh-1", forKey: WidgetStore.householdIdKey) }

    // HEALTH-WIDGET-011 (fixed) — signed in + snapshot → decodes & renders.
    @Test func loadDecodesWhenSignedInWithSnapshot() {
        let d = makeDefaults(); signIn(d)
        d.set(Data(todayJSON.utf8), forKey: HealthWidgetData.todayKey)

        let h = HealthWidgetData.load(from: d)
        #expect(h != nil)
        #expect(h?.steps == 7_240)
        #expect(h?.waterMl == 1_200)
    }

    // HEALTH-WIDGET-011 (fixed) — regression guard: no `auth_token` must not block a
    // signed-in user (the app never writes the product JWT to the App Group).
    @Test func loadDoesNotRequireAuthToken() {
        let d = makeDefaults(); signIn(d)
        d.set(Data(todayJSON.utf8), forKey: HealthWidgetData.todayKey)

        #expect(d.string(forKey: "auth_token") == nil)
        #expect(HealthWidgetData.load(from: d) != nil)
    }

    // HEALTH-WIDGET-011 (fixed) — signed out → nil → empty state.
    @Test func loadReturnsNilWhenSignedOut() {
        let d = makeDefaults()
        d.set(Data(todayJSON.utf8), forKey: HealthWidgetData.todayKey)
        #expect(HealthWidgetData.load(from: d) == nil)
    }

    // HEALTH-WIDGET-009 — the producer may store the payload as a String; both decode.
    @Test func loadAcceptsStringEncodedJSON() {
        let d = makeDefaults(); signIn(d)
        d.set(todayJSON, forKey: HealthWidgetData.todayKey) // String, not Data
        #expect(HealthWidgetData.load(from: d)?.steps == 7_240)
    }

    // Preview sample is populated so the gallery illustrates the UI.
    @Test func sampleIsPopulatedForPreviews() {
        #expect(HealthWidgetData.sample.steps != nil)
        #expect(HealthWidgetData.sample.nextReminder != nil)
    }

    @Test func todayKeyMatchesProducerContract() {
        #expect(HealthWidgetData.todayKey == "widget_health_today")
    }
}

// MARK: - Preview samples & the signed-in helper
//
// Only Budget, Health and Kaizen content are compiled into this test target
// (see the SymplyEcosystemWidgetTests Sources phase). Language / House / Provider
// samples are exercised implicitly by the same `static let sample` idiom.

@Suite(.serialized)
struct WidgetSampleTests {

    // A gallery sample must be renderable content (non-empty), or the widget picker
    // falls back to the signed-out empty state it's meant to replace.
    @Test func kaizenSampleHasHabits() {
        #expect(KaizenWidgetData.sample.total > 0)
    }

    // isSignedIn keys off the household id only — never the (never-written) auth_token.
    @Test func isSignedInKeysOffHouseholdOnly() {
        let d = UserDefaults(suiteName: "com.symply.gate.widgettests")!
        d.removePersistentDomain(forName: "com.symply.gate.widgettests")
        #expect(WidgetStore.isSignedIn(in: d) == false)
        d.set("hh-1", forKey: WidgetStore.householdIdKey)
        #expect(WidgetStore.isSignedIn(in: d) == true)
    }
}
