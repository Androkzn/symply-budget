//
//  KaizenWidgetDataTests.swift
//  SymplyEcosystemWidgetTests
//
//  Matrix: KAIZEN-WIDGET-013…017, 022
//  (documents/engineering/testing/matrices/kaizen.md)
//
//  Locks the `widget_kaizen_today` App Group contract written by
//  src/features/kaizen/services/kaizenWidgetSnapshot.ts. The widget shape differs
//  from the watch's: `streak` (not `current_streak`) and `next_habit` as an OBJECT
//  `{title, icon}` (not a string). `load(from:)` takes an injectable UserDefaults,
//  so these run headless with no App Group entitlement.
//

import Foundation
import Testing
@testable import SymplyEcosystemWidgetExtension

@Suite(.serialized)
struct KaizenWidgetDataTests {

    /// Isolated defaults suite — never touches the real App Group container.
    private static let suiteName = "com.symply.kaizen.widgettests"

    private func makeDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: Self.suiteName)!
        defaults.removePersistentDomain(forName: Self.suiteName)
        return defaults
    }

    private func write(_ json: String, to defaults: UserDefaults) {
        // Exactly how WidgetSyncModule.setSnapshot persists it.
        defaults.set(Data(json.utf8), forKey: KaizenWidgetData.todayKey)
    }

    private let validSnapshot = """
    { "done": 3, "total": 5, "streak": 12,
      "next_habit": { "title": "Meditate", "icon": "leaf-outline" } }
    """

    // MARK: - KAIZEN-WIDGET-013 — decode a valid snapshot

    @Test func loadDecodesValidSnapshot() {
        let defaults = makeDefaults()
        write(validSnapshot, to: defaults)

        let data = KaizenWidgetData.load(from: defaults)
        #expect(data != nil)
        #expect(data?.done == 3)
        #expect(data?.total == 5)
        #expect(data?.streak == 12)
        // next_habit → nextHabit via CodingKeys, decoded as a nested object.
        #expect(data?.nextHabit?.title == "Meditate")
        #expect(data?.nextHabit?.icon == "leaf-outline")
    }

    @Test func todayKeyMatchesTheProducerContract() {
        // The producer writes this exact literal — see KAIZEN_WIDGET_KEY.
        #expect(KaizenWidgetData.todayKey == "widget_kaizen_today")
    }

    // MARK: - KAIZEN-WIDGET-014 — missing key → nil → signed-out empty state

    @Test func loadReturnsNilWhenNoSnapshotWritten() {
        let defaults = makeDefaults()

        #expect(KaizenWidgetData.load(from: defaults) == nil)
    }

    @Test func loadReturnsNilWhenDefaultsAreUnavailable() {
        // WidgetStore.defaults is Optional; a nil container must not trap.
        #expect(KaizenWidgetData.load(from: nil) == nil)
    }

    // MARK: - KAIZEN-WIDGET-015 — malformed JSON → nil, no crash

    @Test func loadReturnsNilForMalformedJSON() {
        let defaults = makeDefaults()
        write("}{ not json", to: defaults)

        #expect(KaizenWidgetData.load(from: defaults) == nil)
    }

    @Test func loadReturnsNilWhenRequiredFieldsAreMissing() {
        let defaults = makeDefaults()
        // done/total/streak are non-optional — fail closed to the empty state.
        write(#"{ "done": 2 }"#, to: defaults)

        #expect(KaizenWidgetData.load(from: defaults) == nil)
    }

    // MARK: - KAIZEN-WIDGET-016 — optional icon

    @Test func decodesNextHabitWithoutIcon() {
        let defaults = makeDefaults()
        write(#"{ "done": 1, "total": 4, "streak": 2, "next_habit": { "title": "Read" } }"#,
              to: defaults)

        let data = KaizenWidgetData.load(from: defaults)
        #expect(data?.nextHabit?.title == "Read")
        #expect(data?.nextHabit?.icon == nil)
        // A nil icon must still yield a renderable SF Symbol, not an empty glyph.
        let fallbackSymbol: String = Ionicon.symbol(data?.nextHabit?.icon)
        #expect(!fallbackSymbol.isEmpty)
    }

    @Test func decodesNullNextHabitWhenEverythingIsDone() {
        let defaults = makeDefaults()
        write(#"{ "done": 5, "total": 5, "streak": 8, "next_habit": null }"#, to: defaults)

        let data = KaizenWidgetData.load(from: defaults)
        #expect(data != nil)
        #expect(data?.nextHabit == nil)
        #expect(data?.done == data?.total)
    }

    // MARK: - KAIZEN-WIDGET-017 — total == 0 is "empty", not "signed out"

    @Test func zeroTotalDecodesButSignalsTheEmptyDayBranch() {
        let defaults = makeDefaults()
        write(#"{ "done": 0, "total": 0, "streak": 0, "next_habit": null }"#, to: defaults)

        let data = KaizenWidgetData.load(from: defaults)
        // Non-nil with total == 0 → "No habits scheduled today". Distinct from a nil
        // decode, which means signed out. SymplyKaizenWidgetContent branches on both.
        #expect(data != nil)
        #expect(data?.total == 0)
    }

    // MARK: - Kaizen system icons resolve (producer ↔ Ionicon agreement)

    @Test func everyProducerSystemIconMapsToARealSymbol() {
        // SYSTEM_ICON values in kaizenWidgetSnapshot.ts, plus its default.
        let producerIcons = [
            "briefcase-outline", "book-outline", "help-circle-outline",
            "fitness-outline", "timer-outline", "checkmark-circle-outline",
        ]

        for icon in producerIcons {
            // "sparkles" is Ionicon's unknown-name fallback; a producer icon hitting
            // it means the two sides have drifted.
            #expect(Ionicon.symbol(icon) != "sparkles", "unmapped producer icon: \(icon)")
        }
    }

    // MARK: - KAIZEN-WIDGET-022 — brand-scoped App Group

    @Test func appGroupIdentifierStripsTheWidgetSuffix() {
        // `com.symply.kaizen.widget` → `group.com.symply.kaizen`, shared with the
        // phone and watch. A leaked `.widget` suffix means a permanently empty widget.
        #expect(WidgetStore.appGroup.hasPrefix("group."))
        #expect(!WidgetStore.appGroup.contains(".widget"))
    }

    // MARK: - Round trip against the producer's exact payload

    @Test func decodesTheProducersExactPayload() {
        let defaults = makeDefaults()
        // Byte-for-byte what `toWidgetSnapshot()` serialises for a mid-day state.
        write(#"{"done":1,"total":2,"streak":9,"next_habit":{"title":"Second","icon":"briefcase-outline"}}"#,
              to: defaults)

        let data = KaizenWidgetData.load(from: defaults)
        #expect(data?.done == 1)
        #expect(data?.total == 2)
        #expect(data?.streak == 9)
        #expect(data?.nextHabit?.title == "Second")
        let symbol: String = Ionicon.symbol(data?.nextHabit?.icon)
        #expect(symbol == "briefcase.fill")
    }
}
