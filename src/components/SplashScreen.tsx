import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Animated,
  Dimensions,
  View,
  ImageBackground,
  useColorScheme,
} from 'react-native';

import { brandId } from '@brand';
import { brandAssets, getLogoSplashForScheme } from '@brand/assets';
import { useAppStore } from '@stores/appStore';
import { getAppColors, Layout, ZIndex } from '@theme';

const splashLight = brandAssets.splashLight;
const splashDark = brandAssets.splashDark;

const { width, height } = Dimensions.get('window');

interface SplashScreenProps {
  onFinish: () => void;
  duration?: number;
  canFinish?: boolean;
}

const LOGO_DELAY_MS = 400;
const FADE_OUT_MS = 400;
const ENTRANCE_MS = 600;
const springEnter = { friction: 8, tension: 40 } as const;
const startTranslateY = 50;

export function SplashScreen({ onFinish, duration = 2500, canFinish = true }: SplashScreenProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const accentScheme = useAppStore((s) => s.accentScheme);
  const scrim = getAppColors(isDark ? 'dark' : 'light').mediaOverlayScrim;
  const splashBg = isDark ? splashDark : splashLight;
  const logoSplash = getLogoSplashForScheme(brandId, accentScheme);

  const containerFadeAnim = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.5)).current;
  const logoTranslateY = useRef(new Animated.Value(startTranslateY)).current;
  const [animationComplete, setAnimationComplete] = useState(false);

  useEffect(() => {
    const logoDelay = setTimeout(() => {
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: ENTRANCE_MS,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          ...springEnter,
          useNativeDriver: true,
        }),
        Animated.timing(logoTranslateY, {
          toValue: 0,
          duration: ENTRANCE_MS,
          useNativeDriver: true,
        }),
      ]).start();
    }, LOGO_DELAY_MS);

    const readyTimer = setTimeout(() => {
      setAnimationComplete(true);
    }, duration);

    return () => {
      clearTimeout(logoDelay);
      clearTimeout(readyTimer);
    };
  }, [logoOpacity, logoScale, logoTranslateY, duration]);

  useEffect(() => {
    if (animationComplete && canFinish) {
      Animated.timing(containerFadeAnim, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: true,
      }).start(() => {
        onFinish();
      });
    }
  }, [animationComplete, canFinish, containerFadeAnim, onFinish]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: containerFadeAnim,
        },
      ]}
    >
      <ImageBackground source={splashBg} style={styles.background} resizeMode="cover">
        <View style={[styles.overlay, { backgroundColor: scrim }]} />
        <View style={styles.content}>
          <Animated.Image
            source={logoSplash}
            style={[
              styles.logoSplash,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }, { translateY: logoTranslateY }],
              },
            ]}
            resizeMode="contain"
          />
        </View>
      </ImageBackground>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: ZIndex.splash,
  },
  background: {
    flex: 1,
    width,
    height,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoSplash: {
    width: width * Layout.splashLogoWidthFraction,
    height: width * Layout.splashLogoWidthFraction,
    maxWidth: Layout.splashLogoMax,
    maxHeight: Layout.splashLogoMax,
  },
});
