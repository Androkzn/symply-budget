/**
 * House V2 local-first enrolment surface.
 *
 * Seven surfaces, no routing opinions of their own:
 *   - `HouseInviteScreen`        — the HUB: who is here, then invite / join /
 *                                  homes / devices
 *   - `HouseInviteCreateScreen`  — owner creates an invite and approves claims
 *   - `HouseJoinScreen`          — invitee scans or pastes an invite and claims it
 *   - `HousePropertiesScreen`    — the homes this device holds; create, rename,
 *                                  switch, leave
 *   - `HouseDevicesScreen`       — this home's devices, revoke and rename
 *   - `HouseDeviceSyncScreen`    — sync now, plus the three bodies on one surface
 *   - `HouseRecoverHomeScreen`   — this phone holds no key for the account's
 *                                  homes; drawn over the shell by the root layout
 *
 * The `*Body` exports are the same components without screen chrome, for any
 * surface that wants to compose them under its own header — which is what
 * `HouseDeviceSyncScreen` does, and why the `lf-*` test ids live on the bodies
 * rather than on the screens.
 */
export { default as HouseInviteScreen, HouseInviteScreen as HouseInviteHub } from './HouseInviteScreen';
export { default as HouseInviteCreateScreen, HouseInviteBody } from './HouseInviteCreateScreen';
export { default as HouseJoinScreen, HouseJoinBody } from './HouseJoinScreen';
export { default as HousePropertiesScreen, propertySubtitle } from './HousePropertiesScreen';
// Mounted BY `HousePropertiesScreen`; exported so a surface that lists homes
// without going through that screen can show the same drift.
export { HouseOtherHouseholdsCard } from './HouseOtherHouseholdsCard';
export { default as HouseDevicesScreen, HouseDevicesBody } from './HouseDevicesScreen';
export { default as HouseDeviceSyncScreen } from './HouseDeviceSyncScreen';
export { default as HouseSyncInventoryScreen } from './HouseSyncInventoryScreen';
// Deliberately NOT the door `app/_layout.tsx` uses — it imports the screen by
// deep path so the root layout does not evaluate every other enrolment screen
// at startup. Re-exported here for parity with its siblings.
export {
  HouseRecoverHomeScreen,
  useHouseRecoveryGate,
  type HouseRecoveryState,
} from './HouseRecoverHomeScreen';
export { HouseDeviceNameSheet } from './HouseDeviceNameSheet';
export {
  EnrolmentShell,
  NoticeCard,
  StatusLine,
  ValueRow,
  describeExpiry,
  gateNotice,
  useEnrolmentGate,
  type EnrolmentGate,
  type NoticeTone,
} from './enrolmentShared';
