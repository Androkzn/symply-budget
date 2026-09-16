import React from 'react';
import { Text, View, type ViewStyle } from 'react-native';

type PdfProps = {
  source?: { uri?: string };
  style?: ViewStyle | ViewStyle[];
};

/** Web review fallback; the native PDF renderer remains the source of truth on iOS/Android. */
export default function PdfWebFallback({ source, style }: PdfProps) {
  return (
    <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, style]}>
      <Text>PDF preview is available in the native app.</Text>
      {source?.uri ? <Text selectable>{source.uri}</Text> : null}
    </View>
  );
}
