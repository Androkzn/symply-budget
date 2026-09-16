//
//  KaizenTodayTests.swift
//  SymplyEcosystemWatchApp Watch AppTests
//
//  Matrix: KAIZEN-WATCH-007…015
//  (documents/engineering/testing/matrices/kaizen.md)
//
//  Locks the `watch_kaizen_today` App Group contract the phone producer
//  (src/features/kaizen/services/kaizenWidgetSnapshot.ts) writes. The watch shape
//  differs from the widget's: `current_streak` (not `streak`) and a bare string
//  `next_habit` (not an object). Decoding is the only thing standing between a
//  correct snapshot and a permanently empty watch face, so it is asserted directly.
//

import Foundation
import Testing
@testable import SymplyEcosystemWatchApp_Watch_App

@Suite(.serialized)
struct KaizenTodayTests {

    private func clearSnapshot() {
        AppGroup.defaults.removeObject(forKey: KaizenToday.storageKey)
        AppGroup.defaults.synchronize()
    }

    /// Write raw JSON under the contract key, exactly as the native module does
    /// (`defaults.set(Data(json.utf8), forKey:)`).
    private func writeSnapshot(_ json: String) {
        AppGroup.defaults.set(Data(json.utf8), forKey: KaizenToday.storageKey)
        AppGroup.defaults.synchronize()
    }

    private let validSnapshot = """
    { "done": 3, "total": 5, "current_streak": 12, "next_habit": "Meditate" }
    """

    // MARK: - KAIZEN-WATCH-007 — decode a valid snapshot

    @Test func loadDecodesValidSnapshot() {
        clearSnapshot()
        defer { clearSnapshot() }

        writeSnapshot(validSnapshot)

        let today = KaizenToday.load()
        #expect(today != nil)
        #expect(today?.done == 3)
        #expect(today?.total == 5)
        // snake_case → camelCase via CodingKeys; a rename on either side fails here.
        #expect(today?.currentStreak == 12)
        #expect(today?.nextHabit == "Meditate")
    }

    @Test func storageKeyMatchesTheProducerContract() {
        // The producer writes this exact literal — see KAIZEN_WATCH_KEY.
        #expect(KaizenToday.storageKey == "watch_kaizen_today")
    }

    // MARK: - KAIZEN-WATCH-008 — missing key → nil → empty state

    @Test func loadReturnsNilWhenNoSnapshotSynced() {
        clearSnapshot()
        defer { clearSnapshot() }

        #expect(KaizenToday.load() == nil)
    }

    // MARK: - KAIZEN-WATCH-009 — malformed JSON → nil, no crash

    @Test func loadReturnsNilForMalformedJSON() {
        clearSnapshot()
        defer { clearSnapshot() }

        writeSnapshot("not json at all")
        #expect(KaizenToday.load() == nil)
    }

    @Test func loadReturnsNilWhenRequiredFieldsAreMissing() {
        clearSnapshot()
        defer { clearSnapshot() }

        // `done`/`total`/`current_streak` are non-optional — a partial payload must
        // fail closed to the empty state rather than decode with garbage defaults.
        writeSnapshot(#"{ "done": 1 }"#)
        #expect(KaizenToday.load() == nil)
    }

    @Test func loadDecodesWhenOptionalNextHabitIsAbsent() {
        clearSnapshot()
        defer { clearSnapshot() }

        writeSnapshot(#"{ "done": 5, "total": 5, "current_streak": 3 }"#)

        let today = KaizenToday.load()
        #expect(today != nil)
        #expect(today?.nextHabit == nil)
    }

    @Test func loadDecodesExplicitNullNextHabit() {
        clearSnapshot()
        defer { clearSnapshot() }

        // The producer emits `null` (not omission) when everything is done.
        writeSnapshot(#"{ "done": 5, "total": 5, "current_streak": 3, "next_habit": null }"#)

        let today = KaizenToday.load()
        #expect(today != nil)
        #expect(today?.hasNextHabit == false)
    }

    // MARK: - KAIZEN-WATCH-010…013 — progressPercent

    @Test func progressPercentComputesFromDoneOverTotal() {
        let today = KaizenToday(done: 3, total: 5, currentStreak: 0, nextHabit: nil)
        #expect(today.progressPercent == 60)
    }

    /// KAIZEN-WATCH-011 — the `guard total > 0` branch. Without it this is a
    /// divide-by-zero producing `NaN`, and `Int(NaN)` traps at runtime — i.e. a
    /// crash on the watch face for any user with no habits configured.
    @Test func progressPercentIsZeroWhenTotalIsZero() {
        let today = KaizenToday(done: 0, total: 0, currentStreak: 0, nextHabit: nil)
        #expect(today.progressPercent == 0)
    }

    @Test func progressPercentRoundsToNearest() {
        #expect(KaizenToday(done: 1, total: 3, currentStreak: 0, nextHabit: nil).progressPercent == 33)
        #expect(KaizenToday(done: 2, total: 3, currentStreak: 0, nextHabit: nil).progressPercent == 67)
    }

    @Test func progressPercentIsOneHundredOnlyWhenFullyDone() {
        #expect(KaizenToday(done: 5, total: 5, currentStreak: 0, nextHabit: nil).progressPercent == 100)
        #expect(KaizenToday(done: 4, total: 5, currentStreak: 0, nextHabit: nil).progressPercent < 100)
    }

    // MARK: - KAIZEN-WATCH-014 — empty next_habit is "nothing left"

    @Test func emptyNextHabitCountsAsNothingLeft() {
        #expect(KaizenToday(done: 5, total: 5, currentStreak: 1, nextHabit: "").hasNextHabit == false)
        #expect(KaizenToday(done: 5, total: 5, currentStreak: 1, nextHabit: nil).hasNextHabit == false)
        #expect(KaizenToday(done: 2, total: 5, currentStreak: 1, nextHabit: "Read").hasNextHabit == true)
    }

    // MARK: - KAIZEN-WATCH-015 — brand-scoped App Group

    @Test func appGroupIdentifierStripsWatchSuffixes() {
        // The watch bundle id is `<brand>.watchkitapp[.watchkitextension]`; both
        // suffixes must be stripped so the watch reads the SAME container the phone
        // writes. A leaked suffix means a permanently empty face.
        #expect(AppGroup.identifier.hasPrefix("group."))
        #expect(!AppGroup.identifier.contains(".watchkitapp"))
        #expect(!AppGroup.identifier.contains(".watchkitextension"))
        #expect(!AppGroup.identifier.contains(".widget"))
    }

    // MARK: - Round trip against the producer's exact payload

    @Test func decodesTheProducersExactWidgetSiblingPayload() {
        clearSnapshot()
        defer { clearSnapshot() }

        // Byte-for-byte what `toWatchSnapshot()` serialises for a mid-day state.
        writeSnapshot(#"{"done":1,"total":2,"current_streak":9,"next_habit":"Second"}"#)

        let today = KaizenToday.load()
        #expect(today?.done == 1)
        #expect(today?.total == 2)
        #expect(today?.currentStreak == 9)
        #expect(today?.nextHabit == "Second")
        #expect(today?.progressPercent == 50)
    }
}
