import React, { useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import type { Finding } from '@api/reports';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { IconSize, useAppColors } from '@theme';
import type { AppColors } from '@theme';
import { getSystemCategoryIcon } from '@utils/categoryIcons';

import { SeverityBadge } from './SeverityBadge';


interface FindingCardProps {
  finding: Finding;
  onPress?: () => void;
}

const SYSTEM_CATEGORY_LABELS: Record<string, string> = {
  // Core Systems
  hvac: 'HVAC',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  gas: 'Gas',
  appliances: 'Appliances',
  // Structure
  roof: 'Roof',
  foundation: 'Foundation',
  exterior: 'Exterior',
  interior: 'Interior',
  windows_doors: 'Windows & Doors',
  flooring: 'Flooring',
  painting: 'Painting',
  siding: 'Siding',
  gutters: 'Gutters',
  fencing: 'Fencing',
  deck_patio: 'Deck/Patio',
  garage_door: 'Garage Door',
  chimney: 'Chimney/Fireplace',
  attic: 'Attic',
  basement: 'Basement',
  garage: 'Garage',
  insulation: 'Insulation',
  structure: 'Structure',
  // Water & Drainage
  drainage: 'Drainage',
  septic: 'Septic',
  pool_spa: 'Pool/Spa',
  irrigation: 'Irrigation',
  // Outdoor
  landscaping: 'Landscaping',
  snow_removal: 'Snow Removal',
  // Services
  safety: 'Safety',
  security: 'Security',
  pest_control: 'Pest Control',
  cleaning: 'Cleaning',
  inspection: 'Inspection',
  // Utilities & Tech
  phone_internet: 'Phone/Internet',
  solar: 'Solar',
  smart_home: 'Smart Home',
  // Other
  other: 'Other',
};

export function FindingCard({ finding, onPress }: FindingCardProps) {  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const iconName = getSystemCategoryIcon(finding.system_category);
  const categoryLabel =
    SYSTEM_CATEGORY_LABELS[finding.system_category] || finding.system_category;

  const content = (
    <Card variant="outlined" style={styles.card}>
      <View style={styles.header}>
        <View style={styles.categoryContainer}>
          <View
            style={[styles.iconContainer, { backgroundColor: colors.backgroundSecondary }]}
          >
            <Icon name={iconName} size={IconSize.sm} color={colors.textPrimary} />
          </View>
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            weight="medium"
          >
            {categoryLabel}
          </Typography>
        </View>
        <SeverityBadge severity={finding.severity} />
      </View>

      <Typography variant="headline" weight="semibold" style={styles.title}>
        {finding.title}
      </Typography>

      {finding.plain_language_summary ? (
        <Typography
          variant="subheadline"
          color={colors.textSecondary}
          numberOfLines={3}
          style={styles.summary}
        >
          {finding.plain_language_summary}
        </Typography>
      ) : (
        <Typography
          variant="subheadline"
          color={colors.textSecondary}
          numberOfLines={3}
          style={styles.summary}
        >
          {finding.description}
        </Typography>
      )}

      {finding.evidence_page_numbers && finding.evidence_page_numbers.length > 0 && (
        <View style={styles.evidence}>
          <Typography variant="caption1" color={colors.textTertiary}>
            Evidence: Page {finding.evidence_page_numbers.join(', ')}
          </Typography>
        </View>
      )}

      {finding.ai_confidence !== null && finding.ai_confidence < 0.8 && (
        <View style={[styles.confidenceWarning, { backgroundColor: colors.warning + '1A' }]}>
          <Typography variant="caption2" color={colors.warning}>
            AI confidence: {Math.round(finding.ai_confidence * 100)}%
          </Typography>
        </View>
      )}
    </Card>
  );

  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>;
  }

  return content;
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    card: {
      padding: 16,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    categoryContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconContainer: {
      width: 28,
      height: 28,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    title: {
      marginBottom: 8,
    },
    summary: {
      lineHeight: 20,
    },
    evidence: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    confidenceWarning: {
      marginTop: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      alignSelf: 'flex-start',
    },
  });
