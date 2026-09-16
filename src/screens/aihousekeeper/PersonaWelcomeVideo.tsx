import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';

type PersonaVideoSource = number | { uri: string };

type Props = {
  source: PersonaVideoSource;
  style?: StyleProp<ViewStyle>;
  muted?: boolean;
};

/** Welcome persona clip — expo-video (expo-av removed for Expo SDK 57). */
export function PersonaWelcomeVideo({ source, style, muted = true }: Props) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = muted;
    p.play();
  });

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  return (
    <VideoView
      player={player}
      style={style}
      contentFit="contain"
      nativeControls={false}
    />
  );
}
