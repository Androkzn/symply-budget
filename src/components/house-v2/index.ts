/**
 * House V2 local-first member-facing surface.
 *
 * The engine (sync, BR-044 conflict tracking, the H6 encrypted blob channel) is
 * deployed and green but had no UI — these are the components that give it one.
 * They are deliberately screen-agnostic: each takes an optional `householdId`
 * and owns no navigation, so a Settings screen, a task detail sheet and an
 * appliance form can all mount the same component.
 */
export { HouseSyncStatusCard, type HouseSyncStatusCardProps } from './HouseSyncStatusCard';
export { HouseConflictList, type HouseConflictListProps } from './HouseConflictList';
export {
  HouseAttachmentField,
  type HouseAttachmentFieldProps,
  type HouseAttachmentKind,
} from './HouseAttachmentField';
export {
  HouseBlobImage,
  type HouseBlobImageProps,
  type HouseBlobFetchPolicy,
} from './HouseBlobImage';
export {
  HousePhotoViewer,
  type HousePhotoViewerProps,
  type HousePhotoViewerItem,
} from './HousePhotoViewer';

export {
  houseBlobErrorCode,
  houseBlobErrorCopy,
  formatBlobBytes,
  type HouseBlobErrorCode,
  type HouseBlobErrorCopy,
} from './houseBlobErrorCopy';
export {
  formatSyncTime,
  houseSyncCopy,
  resolveHouseSyncState,
  type HouseSyncCopy,
  type HouseSyncCopyInput,
  type HouseSyncState,
} from './houseSyncCopy';
export {
  describeHouseConflict,
  houseConflictFieldLabel,
  houseConflictNoun,
  houseConflictSummary,
  type HouseConflictCopy,
} from './houseConflictCopy';
export { useHouseLedgerRevision } from './useHouseLedgerRevision';
export { isMeteredConnection } from './meteredConnection';
