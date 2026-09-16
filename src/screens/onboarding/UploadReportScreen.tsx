import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { reportsApi } from '@api/reports';
import { AppBackground, SafeAreaView } from '@components/common';
import { OnboardingStepHeader } from '@components/onboarding/OnboardingStepHeader';
import { Button, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useMemberFacingAlert } from '@features/house/local/useMemberFacingAlert';
import { houseOnboardingProgress } from '@features/house/onboarding/aiSteps';
import { recordOnboardingStep } from '@features/house/onboarding/recordStep';
import type { OnboardingStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

type UploadReportScreenNavigationProp = NativeStackNavigationProp<
  OnboardingStackParamList,
  'UploadReport'
>;

export function UploadReportScreen() {
  const navigation = useNavigation<UploadReportScreenNavigationProp>();
  const colors = useAppColors();
  const currentHousehold = useHouseholdStore(state => state.currentHousehold);
  const [uploading, setUploading] = useState(false);
  // A refusal that carries its own title and its own offer, rather than every
  // failure being flattened into "Upload Failed" + `error.message` — which put
  // a "not on this build yet" sentence under a crash-shaped heading.
  const showError = useMemberFacingAlert();

  const handleUpload = async () => {
    if (!currentHousehold) {
      Alert.alert('Error', 'Please create a home first');
      return;
    }

    try {
      // Pick document
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const file = result.assets[0];
      if (!file.uri) {
        throw new Error('No file selected');
      }

      setUploading(true);

      // Step 1: Get upload URL
      const { report_id, upload_url } = await reportsApi.getUploadUrl(
        currentHousehold.id,
        {
          filename: file.name,
          file_size: file.size || 0,
          content_type: 'application/pdf',
        },
      );

      // Step 2: Upload file to R2
      const response = await fetch(file.uri);
      const blob = await response.blob();
      await reportsApi.uploadFile(upload_url, blob);

      // Step 3: Confirm upload
      await reportsApi.confirmUpload(currentHousehold.id, report_id);

      // Bookkeeping, not a gate — the report is already uploaded and confirmed,
      // so neither losing it nor WAITING on it may reach the member. Awaited, a
      // stalled call held the success alert back for a full request timeout
      // after the upload had finished.
      recordOnboardingStep('report');

      // Show success message
      Alert.alert(
        'Report Uploaded!',
        "Your inspection report is being processed. This may take a few minutes. We'll notify you when it's ready!",
        [
          {
            text: 'Continue',
            onPress: () => navigation.navigate('GarbageSetup'),
          },
        ],
      );
    } catch (error) {
      console.error('Upload error:', error);
      showError(error, 'Failed to upload report');
    } finally {
      setUploading(false);
    }
  };

  const handleSkip = async () => {
    navigation.navigate('GarbageSetup');
  };

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView>
        <OnboardingStepHeader
          testID="onboarding-upload-report"
          {...houseOnboardingProgress('UploadReport')}
          stepLabel="Upload Report"
          onBack={() => navigation.goBack()}
          onForward={handleSkip}
          forwardDisabled={uploading}
        />
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Typography
              variant="largeTitle"
              weight="bold"
              align="center"
              color={colors.textPrimary}
            >
              Upload Your Inspection Report
            </Typography>
            <Typography
              variant="body"
              color={colors.textSecondary}
              align="center"
              style={styles.subtitle}
            >
              Upload your home inspection PDF to get AI-powered insights and
              maintenance recommendations
            </Typography>
          </View>

          <View style={styles.features}>
            <FeatureCard
              icon="search"
              title="AI Analysis"
              description="Automatically extract issues and recommendations"
            />
            <FeatureCard
              icon="hourglass"
              title="Processing Time"
              description="Takes 2-5 minutes. You'll receive a notification when ready"
            />
            <FeatureCard
              icon="document-text"
              title="Action Plan"
              description="Get prioritized tasks and cost estimates"
            />
          </View>

          <View style={styles.actions}>
            <GradientButton
              title={uploading ? 'Uploading...' : 'Upload Report (PDF)'}
              variant="teal"
              onPress={handleUpload}
              disabled={uploading}
              fullWidth
              testID="onboarding-upload-report-button"
            />
            <Button
              title="Skip for Now"
              variant="ghost"
              onPress={handleSkip}
              disabled={uploading}
              fullWidth
            />
          </View>

          <View style={styles.note}>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              align="center"
            >
              You can always upload reports later from the Reports tab
            </Typography>
          </View>
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}) {
  const colors = useAppColors();
  return (
    <View
      style={[
        styles.featureCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.borderColor,
          shadowColor: colors.black,
        },
      ]}
    >
      <View style={styles.featureIcon}>
        <Icon name={icon} size={24} color={colors.primary} />
      </View>
      <View style={styles.featureText}>
        <Typography
          variant="headline"
          weight="semibold"
          color={colors.textPrimary}
        >
          {title}
        </Typography>
        <Typography variant="subheadline" color={colors.textSecondary}>
          {description}
        </Typography>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    marginTop: 32,
    marginBottom: 32,
  },
  subtitle: {
    marginTop: 16,
    lineHeight: 22,
  },
  features: {
    gap: 16,
    marginBottom: 32,
  },
  featureCard: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(61, 189, 181, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  featureText: {
    flex: 1,
  },
  actions: {
    gap: 12,
  },
  note: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
