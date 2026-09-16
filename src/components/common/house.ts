/**
 * House-domain UI (property switcher, floor-plan map controls).
 *
 * Child brands should import from `@components/common/house` instead of the
 * shared `@components/common` barrel so they do not transitively depend on
 * House concepts (MOB-8).
 */
export { PropertySwitcher } from './PropertySwitcher';
export { PropertyBadge, usePropertyBadgeInfo } from './PropertyBadge';
export { MapOverlayControls } from './MapOverlayControls';
export { MapCompassControl } from './MapCompassControl';
