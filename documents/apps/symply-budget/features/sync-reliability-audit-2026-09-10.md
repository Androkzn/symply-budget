# Budget synchronization reliability audit — 2026-09-10

Scope: clean installation of an existing household member, foreground and background delivery, multiple households, key exchange, signed history checkpoints, delivery acknowledgement and truthful UI state. Financial data remains encrypted on the relay.

## Defects corrected

| Defect | Correction | Regression coverage |
|---|---|---|
| A newly registered device of an existing member never receives its household key automatically | Fully bootstrapped peers publish history and then wrap the current and retired household keys to authorized recipient devices; retries are scoped to device/public key/epoch | `peerRecovery.test.ts` |
| Mailbox HTTP adapter used the active household for another household’s fetch, deposit and acknowledgement | Bind each adapter to an explicit household, reject mismatched calls | `httpControlPlane.test.ts` |
| Malformed key envelope stops the search; sender claims trusted without roster validation; old epoch may replace current key | Isolate malformed packets, authenticate sender against active device/member roster and current epoch, prevent engine epoch downgrade | `hdkTransfer.test.ts` |
| Only owners can publish recovery history | Verify a signed checkpoint against the authenticated active member’s own active device; permit ordinary members; preserve owner-only legacy chunk uploads | Worker `checkpoint-authorization.test.ts` |
| Download can mix chunks from different latest generations | Pin all chunk reads to the manifest generation and validate returned generation/index | `checkpoint-generation.test.ts`, `newMemberBackfill.test.ts` |
| Concurrent publishers can overwrite the same generation | Reserve a generation atomically against its signed manifest; reject competing publisher with 409; new clients use separated generation numbers | Worker `checkpoint-generation.test.ts` |
| Incomplete local history can replace the household snapshot | Refuse publishing during bootstrap or when local vector does not cover the published snapshot; incomplete reservations do not evict complete history | checkpoint publication guards |
| Completing a previous household’s sync changes current household’s banner | Recheck active household on every status write | `orchestratorMultiHousehold.test.ts` |
| An account switch can continue the previous account’s transfer | Account-scoped single-flight, account checks between phases and before mailbox requests | orchestrator cancellation regression |
| Deferred or rejected messages and failed history download can still report success | Preserve incomplete/error state and do not advance successful-sync timestamp | orchestrator partial-delivery regression |
| Background notifications have no Budget sync handler | Define notification and periodic tasks before React starts; hydrate only existing authenticated local data; never mint a household on a wake | `backgroundTasks.test.ts`, `backgroundSync.test.ts` |
| Locked-screen wake cannot read credentials or live DB key after first unlock | Budget-only device-local `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`; migration does not discard readable credentials on write failure | secure token tests |
| Existing member sees an invitation-approval message | Show secure-access/history progress for the active household, separate actual invitation approval, offer optional backup when no recently active peer is known | enrollment banner tests |

## Platform and recovery limits

Background push and periodic scheduling are best effort: iOS decides when the process runs. Force-quit, no network, power restrictions, and the first unlock after restart can postpone delivery. Foreground reopening and subsequent wakes retry through the durable mailbox. A registered/active device is not proof that it is currently online; UI distinguishes recent activity from membership.

A clean installation needs a currently authorized peer holding complete history and the key, or a user-selected backup. Automatic transfer requires the corrected sender code on that peer. No backup restore was used. After verifying the transferred data and chart rendering, the user authorized a clean uninstall/reinstall on iPhone 13; iPhone 17 retains the complete source history.

The new background native modules were built and installed over existing Budget on iPhone 13 Pro and iPhone 17 Pro Max. This is an instrumented development binary pointed at the Production API, not an App Store release. On iPhone 13 the native task registration was observed in live logs. iPhone 17 initially blocked the debug connection because local-network access was denied. After access was enabled, both runtimes connected and the transfer completed.

## Verification record

- Client sync/background/status regression run: 11 suites, 114 tests passed.
- Shared sync core: 24 suites, 134 tests passed (2 suites / 3 tests skipped). The broader package run also exposed existing House scale-fixture composition errors and a load-sensitive scale timing assertion; these are outside this Budget correction.
- Backend regression run in main checkout: 5 suites, 40 tests passed; backend typecheck passed.
- Client typecheck and targeted lint passed before the final monitoring run (lint retains an existing `no-void` warning).
- Fleet staging and production deployment completed from main. Budget staging version `37ce6834-0090-4aac-8f4a-e16ea4b89be2`; production `ac7e1d60-97c1-47f8-8e05-ebed75d8af43`.
- Both device JS runtimes monitored separately. Production snapshot transferred from iPhone 17 to iPhone 13 at 21:29 UTC: key epoch 12 with eight retired epochs, 4 chunks, 616 rows. Both devices then had matching version vectors and all main table counts (including 330 expenses, 57 incomes, 30 recurring payments).
- Found a visible completion gap: bootstrap marker cleared before the outer sync batch flushed UI refresh. Added an explicit applying stage and awaited screen-cache refresh before completion; a regression keeps the marker set until that refresh resolves.
- Native periodic task test hook on iPhone 13 invoked the real registered callback and completed a sync cycle. This was a forced test, not evidence of iOS scheduling latency or a received production silent push.
- User requested a fresh uninstall/reinstall on iPhone 13 for end-to-end login validation. iPhone 17 retains the source data. Final clean-install validation is pending the user's sign-in.

## Chart and screen refresh follow-up

- The installed gifted-charts `Animated2DWithGradient` starts its height animation in a mount-only effect. A chart initially mounted with zero values therefore kept invisible bars after the ledger arrived, even though its totals and axes updated. Shared `AppBarChart` now renders heights directly from current props (`isAnimated={false}`), covering single, grouped, stacked, and diverging charts. Removed the insufficient tab-only remount workaround from `SavingsTrendChart`.
- Added ledger revision subscriptions to Wishes, Wish detail, Mortgage history, Mortgage statements, and Mortgage settings. Existing main Budget, Savings, Pension, and Mortgage views already observe their feature revisions.
- Chart/mortgage/wishes regression run: 27 suites, 257 tests passed. Banner follow-up: 9 tests passed. Client typecheck passed; targeted lint has no errors.
- At 21:39 UTC, physical iPhone 13 showed all January–September bars, including positive and negative values, and the category donut. Runtime inspection confirmed nine current chart points and animation disabled. Screenshot: `/tmp/budget-chart-fixed.png` (local verification artifact).
- Both monitored runtimes reported no new `author_key_unknown` diagnostic after loading the corrected code. Full clean-install flow still requires the user's next login.

- Clean reinstall completed on iPhone 13 at 21:39 UTC. On launch, iOS Keychain restored the old token; explicitly signed out on that phone to prepare an actual user login. Production endpoint verified again, both log monitors running. User login and the new bootstrap remain pending.

## Notification permission banner follow-up

Automatic post-login permission requests ran through the notification service, while the Home banner kept an isolated hook state read before the system sheet. Direct banner requests also waited for push-token registration before refreshing permission.

The service now publishes OS permission results immediately, before category setup/token work. Mounted permission hooks subscribe, reject stale earlier reads, and refresh on app activation (including returning from iOS Settings). Token registration does not block the granted UI. Budget Home shows “Notifications are enabled” with a confirmation icon for three seconds after a new grant, then hides the card; already-authorized launches do not replay confirmation. No notification permissions or production data are reset for this change.

Regression coverage: 64 tests across the permission hook, card and Budget tabs passed, including automatic grants, delayed registration, settings return, stale reads and timed confirmation.

- Permission follow-up typecheck passed; targeted lint has no errors. Updated JS verified on iPhone 13 (permission-event and timed-success modules loaded), and an already-granted launch had no permission banner. At the user’s request, signed out and performed another clean reinstall of iPhone 13 at 21:46 UTC to repeat the complete flow; iPhone 17 remains the source. Awaiting user interaction with the real system permission sheet and login.

## Background first-device recovery follow-up

- A key-less newcomer returned from sync before depositing anything, and device registration did not send a wake. Therefore a sleeping source peer had no event telling it to publish history and provide the key. Added an explicit authenticated household-scoped recovery wake in the waiting-key path, excluding the requesting device. Durable device/household markers limit successful requests to once per 15 minutes; failed HTTP requests retry after one minute.
- A manual Production wake at 21:48:45 UTC returned four accepted Expo tickets. iPhone 17 native logs recorded `EXTaskService` executing the registered push task at 21:48:49. This proves dispatch to the device, not completed sync. JS/network work was observable after foreground activation at 21:49:50, so completion while suspended was not yet proven.
- Bounded the connectivity preflight to 1.5 seconds: an absent NetInfo callback must not consume the full background window. Unknown connectivity proceeds to the real sync transport; explicit offline status still defers. Added timestamped stage diagnostics for background entry, connectivity and ledger readiness.
- Follow-up tests: four suites, 43 tests passed, including waiting-key wake, persisted throttling, network retry and an unresponsive connectivity callback. Both-background completion remains under physical-device validation; iOS scheduling and forced termination remain platform constraints.

### Physical both-background verification

At 21:54:20 UTC both Budget apps were moved behind iOS Settings. Authenticated opaque wakes were sent through the Production sync-wake endpoint. iPhone 17 entered its handler at 21:54:20.950 and completed its sync run in 2743 ms; iPhone 13 entered at 21:54:21.080 and completed the shared sync run in approximately 2611 ms. Both handlers returned with `changed=false` before Budget was brought foreground at 21:54:44. Timestamped JS stages and native task execution confirm background execution on both devices, independent of the debugger stream reconnecting. No new financial records were inserted for the test, so this verifies wake/transport/handler completion with already-matching data, not a new-record transfer or a fresh-key bootstrap while both devices sleep.

Typecheck and targeted lint passed (existing no-void warning). The explicit recovery wake and bounded connectivity preflight are loaded on both devices. Follow-up observation: repeated reinstall registrations retain multiple rows with the same physical receiver token, producing duplicate wakes; per-household sync single-flight coalesces execution, but server token deduplication is still a reliability improvement to address. OS delivery timing remains best effort.
