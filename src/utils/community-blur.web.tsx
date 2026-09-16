import React from 'react';
import { View, type ViewProps } from 'react-native';

type BlurProps = ViewProps & {
  blurType?: string;
  blurAmount?: number;
  reducedTransparencyFallbackColor?: string;
};

/** CSS-backed Web fallback for the native community blur module. */
export function BlurView({ style, reducedTransparencyFallbackColor, ...props }: BlurProps) {
  return (
    <View
      {...props}
      style={[
        { backgroundColor: reducedTransparencyFallbackColor ?? 'rgba(245, 245, 245, 0.86)' },
        style,
      ]}
    />
  );
}

export function VibrancyView(props: BlurProps) {
  return <BlurView {...props} />;
}
