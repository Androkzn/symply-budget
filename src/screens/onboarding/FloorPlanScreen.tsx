import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { floorPlansApi } from '@api/floor-plans';
import { AppBackground, AttachmentSourceSheet, SafeAreaView } from '@components/common';
import { IMAGE_OR_PDF_MIME_TYPES } from '@components/common/useAttachmentSources';
import { OnboardingStepHeader } from '@components/onboarding';
import { Button, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useMemberFacingAlert } from '@features/house/local/useMemberFacingAlert';
import { houseOnboardingProgress } from '@features/house/onboarding/aiSteps';
import { recordOnboardingStep } from '@features/house/onboarding/recordStep';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

export function FloorPlanScreen() {
  const navigation = useNavigation();
  const colors = useAppColors();
  const currentHousehold = useHouseholdStore(state => state.currentHousehold);
  const completeOnboarding = useAuthStore(state => state.completeOnboarding);
  const [uploading, setUploading] = useState(false);
  /**
   * The fix for the alert in the bug report.
   *
   * `Alert.alert('Upload Failed', error.message)` kept the body of a P4 refusal
   * and threw away its title, so "Adding a floor plan is not on this build yet"
   * was shown under a heading that reads as a crash. `useMemberFacingAlert`
   * renders the copy's OWN title and adds the "Add AI provider" button wherever
   * a key genuinely lifts the refusal — while a real failure (a 500, a dropped
   * connection) still gets the plain one-button alert and the fallback sentence.
   */
  const showError = useMemberFacingAlert();

  /**
   * "Upload Floor Plan" now asks WHERE first.
   *
   * It went straight to the photo library, which is the least likely place an
   * architect's plan lives: it arrives as a PDF or a scan by email, or sits in
   * the household's Drive folder. This is the first upload a new member ever
   * makes, so the source list being short here is the worst place for it to be
   * short.
   */
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);

  const handleUpload = () => {
    if (!currentHousehold) {
      Alert.alert('Error', 'Please create a home first');
      return;
    }
    setSourceSheetOpen(true);
  };

  const uploadPickedPlan = async (uri: string) => {
    if (!currentHousehold) return;

    try {

      setUploading(true);

      // Step 1: Get upload URL
      const { floor_plan_id, upload_url } = await floorPlansApi.getUploadUrl(
        currentHousehold.id,
        {
          filename: `floor-plan-${Date.now()}.jpg`,
          file_size: 0,
          content_type: 'image/jpeg',
          building_name: 'Main Floor Plan',
        },
      );

      // Step 2: Upload file to R2
      const response = await fetch(uri);
      const blob = await response.blob();
      await floorPlansApi.uploadFile(upload_url, blob);

      // Step 3: Confirm upload
      await floorPlansApi.confirmUpload(currentHousehold.id, floor_plan_id, {
        building_name: 'Main Floor Plan',
      });

      // Bookkeeping only — see `handleSkip`. Neither throwing NOR hanging may
      // reach the member: awaited here, a stalled call held the success alert
      // back for a full request timeout after the upload had already finished.
      recordOnboardingStep('floor_plan');
      recordOnboardingStep('complete');
      completeOnboarding();

      // Show success message
      Alert.alert(
        'Floor Plan Uploaded!',
        'Your floor plan has been uploaded successfully. You can add markers and annotations from the Floor Plans tab.',
        [{ text: 'Get Started', onPress: () => {} }],
      );
    } catch (error) {
      console.error('Upload error:', error);
      showError(error, 'Failed to upload floor plan');
    } finally {
      setUploading(false);
    }
  };

  /**
   * Finish setup without a floor plan.
   *
   * `completeOnboarding()` is the LAST thing here and it is not gated on the
   * server call. It used to be: an un-awaited rejection from
   * `updateOnboardingStep` threw out of this handler before the local flag was
   * set, and with no catch the tap did nothing at all. The member sits on
   * "Skip & Finish Setup" pressing it, and a relaunch drops them back at step
   * one — creating a second household each pass.
   *
   * That call is bookkeeping: `hasCompletedOnboarding` is client state, and the
   * server's copy is a convenience for a future sign-in on another device. It
   * has every reason to fail on a private-mode household — the device may not
   * be enrolled yet, and its `/state` reads 403 until an owner approves it — so
   * failing it must not strand the member in the wizard.
   *
   * **It is no longer AWAITED either, which is the rest of that same argument.**
   * Handling the rejection fixed a call that threw; it did nothing for a call
   * that HANGS, and this endpoint is the one most likely to. Measured on a
   * device: the flag went true 24s after the tap, with no busy state on the
   * button — `ENV.TIMEOUTS.API_REQUEST` is 30s and a 401 adds a refresh and a
   * retry on top. A member pressing a dead button for half a minute reports it
   * as "cannot skip", and they are right. See `recordOnboardingStep`.
   */
  const handleSkip = () => {
    recordOnboardingStep('complete');
    completeOnboarding();
  };

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView>
        {/* No forward chevron — this is the flow's last step, and "Skip &
            Finish Setup" below is the only thing on the far side of it. */}
        <OnboardingStepHeader
          testID="onboarding-floor-plan"
          {...houseOnboardingProgress('FloorPlan')}
          stepLabel="Floor Plan"
          onBack={() => navigation.goBack()}
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
              Add Your Floor Plan
            </Typography>
            <Typography
              variant="body"
              color={colors.textSecondary}
              align="center"
              style={styles.subtitle}
            >
              Visualize your home's layout and mark important maintenance
              locations
            </Typography>
          </View>

          <View style={styles.features}>
            <FeatureCard
              icon="resize"
              title="Visual Layout"
              description="See your home's floor plan at a glance"
            />
            <FeatureCard
              icon="location"
              title="Mark Locations"
              description="Pin tasks and issues to specific rooms"
            />
            <FeatureCard
              icon="image"
              title="Any Format"
              description="Upload photos, scans, or digital floor plans"
            />
          </View>

          <View style={styles.actions}>
            <GradientButton
              title={uploading ? 'Uploading...' : 'Upload Floor Plan'}
              variant="teal"
              onPress={handleUpload}
              disabled={uploading}
              fullWidth
            />
            <Button
              title="Skip & Finish Setup"
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
              You can add multiple floor plans later from the Floor Plans tab
            </Typography>
          </View>
        </ScrollView>
      </SafeAreaView>

      <AttachmentSourceSheet
        visible={sourceSheetOpen}
        onClose={() => setSourceSheetOpen(false)}
        title="Add your floor plan"
        help="A photo, a scan, or the PDF your architect sent."
        testIDPrefix="onboarding-floor-plan"
        rememberScope="floor-plan"
        mimeTypes={IMAGE_OR_PDF_MIME_TYPES}
        pickerOptions={{
          cropping: true,
          cropperToolbarTitle: 'Crop Floor Plan',
          compressImageQuality: 0.8,
          mediaType: 'photo',
          freeStyleCropEnabled: true,
        }}
        onPicked={([picked]) => {
          if (picked) void uploadPickedPlan(picked.uri);
        }}
      />
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
