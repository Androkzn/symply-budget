import { useWindowDimensions, Platform } from 'react-native';

import { Layout } from '@theme';

export type DeviceType = 'phone' | 'tablet';
export type Orientation = 'portrait' | 'landscape';

interface DeviceInfo {
  deviceType: DeviceType;
  isTablet: boolean;
  isPhone: boolean;
  isIPad: boolean;
  orientation: Orientation;
  isLandscape: boolean;
  isPortrait: boolean;
  width: number;
  height: number;
  // iPad-specific layout helpers
  shouldUseSidebar: boolean;
  shouldUseSplitView: boolean;
  columns: number;
}

// iPad mini: 768x1024, iPad: 810x1080, iPad Air: 820x1180, iPad Pro 11": 834x1194, iPad Pro 12.9": 1024x1366
const TABLET_MIN_WIDTH = 600;
const SIDEBAR_MIN_WIDTH = Layout.sidebarBreakpoint;
const SPLIT_VIEW_MIN_WIDTH = Layout.splitViewBreakpoint;

export function useDeviceType(): DeviceInfo {
  const { width, height } = useWindowDimensions();

  const isLandscape = width > height;
  const isPortrait = !isLandscape;

  // Use the smaller dimension to determine device type (works regardless of orientation)
  const smallerDimension = Math.min(width, height);
  const isTablet = smallerDimension >= TABLET_MIN_WIDTH;
  const isPhone = !isTablet;
  const isIPad = Platform.OS === 'ios' && isTablet;

  const deviceType: DeviceType = isTablet ? 'tablet' : 'phone';
  const orientation: Orientation = isLandscape ? 'landscape' : 'portrait';

  // iPad-specific layout decisions based on current width/orientation.
  // Keep portrait layouts focused on content (tab bar), and prefer a
  // sidebar in wider/landscape contexts where it doesn't crowd content.
  const shouldUseSidebar = isTablet && (
    isLandscape
      ? width >= SIDEBAR_MIN_WIDTH
      : width >= SPLIT_VIEW_MIN_WIDTH
  );
  const shouldUseSplitView = isTablet && width >= SPLIT_VIEW_MIN_WIDTH;

  // Determine optimal column count for grid layouts
  let columns = 1;
  if (width >= 1200) {
    columns = 4;
  } else if (width >= 900) {
    columns = 3;
  } else if (width >= 600) {
    columns = 2;
  }

  return {
    deviceType,
    isTablet,
    isPhone,
    isIPad,
    orientation,
    isLandscape,
    isPortrait,
    width,
    height,
    shouldUseSidebar,
    shouldUseSplitView,
    columns,
  };
}
