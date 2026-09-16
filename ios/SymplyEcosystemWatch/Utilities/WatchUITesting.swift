//
//  WatchUITesting.swift
//  SymplyEcosystemWatch
//
//  The hardcoded UI-test mock-data harness that used to live here was removed.
//  It seeded fabricated tasks and an Aihousekeeper briefing into the shared App
//  Group under the SAME keys real data uses, so once the Watch was ever launched
//  with `-UITesting` that mock content stuck in the App Group and leaked into
//  real sessions (showing e.g. "Replace HVAC filter" / a week-stale briefing).
//
//  The Watch now renders REAL backend data only — in every environment — via
//  `WatchConnectivityManager` + `WatchAPIClient`. Any previously-persisted mock
//  data is wiped once by `AppGroup.purgeLeakedTestDataIfNeeded()`.
//
//  Intentionally left with no mock data.
//

import Foundation
