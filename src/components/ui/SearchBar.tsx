import React from 'react';
import {
  StyleSheet,
  View,
  TextInput,
  TouchableOpacity,
  Platform,
} from 'react-native';

import { Icon } from '@components/ui/Icon';
import {
  ButtonMetrics,
  CornerRadius,
  IconSize,
  LegacyTextVariant,
  Spacing,
  useAppColors,
} from '@theme';

import { Typography } from './Typography';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onMicPress?: () => void;
  showMic?: boolean;
  isListening?: boolean;
  micError?: string | null;
  testID?: string;
  inputTestID?: string;
  micTestID?: string;
}

const hitSlop = { top: Spacing.smd, bottom: Spacing.smd, left: Spacing.smd, right: Spacing.smd };

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onMicPress,
  showMic = true,
  isListening = false,
  micError,
  testID,
  inputTestID = 'search-bar-input',
  micTestID = 'search-bar-mic',
}: SearchBarProps) {
  const colors = useAppColors();
  return (
    <View>
      <View
        testID={testID}
        style={[
          styles.container,
          {
            backgroundColor: colors.backgroundSecondary,
            borderColor: isListening ? colors.primary : colors.borderColor,
          },
        ]}
      >
        <Icon
          name="search"
          size={IconSize.md}
          color={colors.textTertiary}
          style={styles.searchIcon}
        />
        <TextInput
          testID={inputTestID}
          style={[styles.input, { color: colors.textPrimary }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {showMic && (
          <TouchableOpacity
            testID={micTestID}
            style={styles.micButton}
            onPress={onMicPress}
            hitSlop={hitSlop}
          >
            <Icon
              name={isListening ? 'stop-circle' : 'mic-outline'}
              size={IconSize.md}
              color={isListening ? colors.primary : colors.textTertiary}
            />
          </TouchableOpacity>
        )}
      </View>
      {isListening && (
        <Typography variant="caption2" color={colors.primary} style={styles.hint}>
          Listening… tap to stop
        </Typography>
      )}
      {!!micError && !isListening && (
        <Typography variant="caption2" color={colors.error} style={styles.hint}>
          {micError}
        </Typography>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.smd + Spacing.xs,
    height: ButtonMetrics.minTapTarget,
  },
  searchIcon: {
    marginRight: Spacing.smd,
  },
  input: {
    flex: 1,
    fontSize: LegacyTextVariant.callout.size,
    lineHeight: LegacyTextVariant.callout.lineHeight,
    paddingVertical: Platform.OS === 'ios' ? Spacing.smd : Spacing.sm,
  },
  micButton: {
    marginLeft: Spacing.smd,
    padding: Spacing.xs,
  },
  hint: {
    marginTop: Spacing.xs,
    marginLeft: Spacing.smd,
  },
});
