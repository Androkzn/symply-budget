import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { Avatar, Spacing, TypographyTokens, useAppColors } from '@theme';

import { Typography } from './Typography';

interface StarRatingProps {
  /** Rating value (1-5) */
  rating: number | null;
  /** Size of stars in pixels */
  size?: number;
  /** Whether to show review count */
  showReviewCount?: boolean;
  /** Number of reviews (optional) */
  reviewCount?: number;
  /** Maximum number of stars */
  maxStars?: number;
}

/**
 * Reusable star rating display component
 * Uses primary teal color for filled stars
 */
export function StarRating({
  rating,
  size = TypographyTokens.bodySmall.size,
  showReviewCount = false,
  reviewCount = 0,
  maxStars = 5,
}: StarRatingProps) {
  const { theme } = useTheme();
  const colors = useAppColors();

  if (rating === null || rating === undefined) return null;

  const fullStars = Math.floor(rating);
  const hasHalfStar = rating - fullStars >= 0.5;

  return (
    <View style={styles.container}>
      <View style={styles.starsContainer}>
        {Array.from({ length: maxStars }, (_, index) => {
          const starNumber = index + 1;
          const isFilled = starNumber <= fullStars;
          const isHalf = !isFilled && starNumber === fullStars + 1 && hasHalfStar;

          return (
            <Icon
              key={starNumber}
              name={isFilled ? 'star' : isHalf ? 'star-half' : 'star-outline'}
              size={size}
              color={isFilled || isHalf ? theme.pastel.teal : colors.textTertiary}
            />
          );
        })}
      </View>
      {showReviewCount && reviewCount > 0 && (
        <Typography
          variant="caption2"
          color={colors.textSecondary}
          style={styles.reviewCount}
        >
          ({reviewCount})
        </Typography>
      )}
    </View>
  );
}

interface StarPickerProps {
  /** Current rating value */
  rating: number | null;
  /** Callback when rating changes */
  onChange: (rating: number | null) => void;
  /** Size of stars in pixels */
  size?: number;
  /** Maximum number of stars */
  maxStars?: number;
  /** Whether the picker is disabled */
  disabled?: boolean;
}

/**
 * Interactive star picker for selecting ratings
 * Uses primary teal color for filled stars
 */
export function StarPicker({
  rating,
  onChange,
  size = Avatar.inlineSize,
  maxStars = 5,
  disabled = false,
}: StarPickerProps) {
  const { theme } = useTheme();
  const colors = useAppColors();

  return (
    <View style={styles.pickerContainer}>
      {Array.from({ length: maxStars }, (_, index) => {
        const starNumber = index + 1;
        const isFilled = starNumber <= (rating || 0);

        return (
          <TouchableOpacity
            key={starNumber}
            onPress={() => !disabled && onChange(rating === starNumber ? null : starNumber)}
            disabled={disabled}
            style={styles.starButton}
            activeOpacity={0.7}
          >
            <Icon
              name={isFilled ? 'star' : 'star-outline'}
              size={size}
              color={isFilled ? theme.pastel.teal : colors.textTertiary}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

interface FavoriteStarProps {
  /** Whether the item is favorited */
  isFavorite: boolean;
  /** Callback when favorite is toggled */
  onToggle?: () => void;
  /** Size of the star */
  size?: number;
  /** Whether the star is interactive */
  interactive?: boolean;
}

/**
 * Favorite star indicator/toggle
 * Uses primary teal color when favorited
 */
export function FavoriteStar({
  isFavorite,
  onToggle,
  size = Spacing.xl,
  interactive = true,
}: FavoriteStarProps) {
  const { theme } = useTheme();
  const colors = useAppColors();

  const starContent = (
    <Icon
      name={isFavorite ? 'star' : 'star-outline'}
      size={size}
      color={isFavorite ? theme.pastel.teal : colors.textTertiary}
    />
  );

  if (interactive && onToggle) {
    return (
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
        {starContent}
      </TouchableOpacity>
    );
  }

  return starContent;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  starsContainer: {
    flexDirection: 'row',
  },
  reviewCount: {
    marginLeft: Spacing.xs,
  },
  pickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  starButton: {
    padding: Spacing.xs,
  },
});
