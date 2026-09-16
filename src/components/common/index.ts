export { screenScrollViewStyle, SCREEN_SCROLL_TEST_ID, screenScrollEndTestId } from './screenScrollStyle';
export { ScreenScrollEnd } from './ScreenScrollEnd';
export { SafeAreaView, useIPadSafeAreaInsets } from './SafeAreaView';
export { AppBackground } from './AppBackground';
export { ScreenFooterGlass } from './ScreenFooterGlass';
export { AuthWave } from './AuthWave';
export { GradientText } from './GradientText';
export { BrandWordmark } from './BrandWordmark';
export { AdaptiveModal } from './AdaptiveModal';
export { BackButton } from './BackButton';
export { BrandSymbol } from './BrandSymbol';
export { HeaderLogo } from './HeaderLogo';
export { ScreenHeader } from './ScreenHeader';
export { SheetHeader } from './SheetHeader';
export { OverlaySheetHeader } from './OverlaySheetHeader';
export { HeaderActionButton } from './HeaderActionButton';
export { SettingsGearButton } from './SettingsGearButton';
export { AppVersionFooter, formatBuildTime, type AppVersionFooterProps } from './AppVersionFooter';
// House-only: PropertySwitcher, PropertyBadge, Map* → `@components/common/house` (MOB-8).
// `AddressFields` is deliberately NOT re-exported here. It pulls
// `react-native-google-places-autocomplete` at module scope, and this barrel is
// imported by nearly every screen in the app — one address form would put the
// Places library in every screen's module graph. Import it by path:
// `@components/common/AddressFields`.
export { AIDisclaimerModal, hasAcceptedAIDisclaimer, resetAIDisclaimerAcceptance } from './AIDisclaimerModal';
export { ImageGallery, type GalleryImage } from './ImageGallery';
export { ScanImportSources, type ScanImportSourceKey } from './ScanImportSources';
// The four sources every upload surface offers — see `useAttachmentSources`.
export {
  useAttachmentSources,
  mimeFromName,
  IMAGE_MIME_TYPES,
  IMAGE_OR_PDF_MIME_TYPES,
  type PickedAttachment,
  type UseAttachmentSourcesOptions,
} from './useAttachmentSources';
export {
  AttachmentSourceSheet,
  type AttachmentSourceSheetProps,
} from './AttachmentSourceSheet';
export { ProcessingOverlay, type ProcessingOverlayProps } from './ProcessingOverlay';
export { FrequencyPickerSheet } from './FrequencyPickerSheet';
export { ErrorBoundary } from './ErrorBoundary';
export { PermissionCard, type PermissionCardProps, type PermissionCardCopy } from './PermissionCard';
export { TapOutsideWrapper } from './TapOutsideWrapper';
export { GrowingPlant } from './GrowingPlant';
export { NetworkBlockOverlay } from './NetworkBlockOverlay';
export { E2EVerifyBadge } from './E2EVerifyBadge';