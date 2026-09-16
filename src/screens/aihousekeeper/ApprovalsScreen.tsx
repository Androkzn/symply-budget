/**
 * ApprovalsScreen — plan §B19 / §C3 / §C5.
 *
 * Lists pending HIGH_WRITE tool invocations from `/aihousekeeper/approvals` and lets
 * the user approve (executes the mutation server-side) or cancel. Mirrors
 * the TrustLedger pattern for consistency.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CommonActions, useNavigation } from "expo-router/react-navigation";
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { AIToolPending } from '@/types/aihousekeeper';
import { aihousekeeperApi } from '@api/aihousekeeper';
import { gardenPlansApi } from '@api/garden-plans';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, EmptyState, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useGardenPlanStore } from '@stores/gardenPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

/**
 * Map a stable backend error code to user-friendly copy. Mirrors
 * `friendlyErrorMessage()` in backend/garden-site-plan-image-service.ts.
 * Falls back to the raw code (still safer than dumping JSON).
 */
function friendlyApprovalError(code: string): string {
  switch (code) {
    case 'garden_plan_openai_unavailable':
    case 'openai_not_configured':
      return 'Image generation is not configured on the server. You can add a plan image manually from the Gardening tab.';
    case 'garden_plan_rate_limited':
    case 'openai_image_rate_limited':
      return "You've hit today's image generation limit for this household. Try again tomorrow.";
    case 'openai_image_timeout':
      return 'Image generation took too long. Please try again in a moment.';
    case 'openai_image_content_policy':
      return 'The description was blocked by the safety filter. Re-word the prompt and try again.';
    case 'openai_image_unauthorized':
      return 'Image generation credentials are invalid. Please contact support.';
    case 'openai_image_invalid_prompt':
      return 'Image generation rejected the prompt. Make it more concrete and try again.';
    case 'openai_image_no_data':
      return 'Image generation returned no image. Please try again.';
    case 'invalid_plan_context':
      return 'The selected area is not a valid outdoor plan type.';
    case 'missing_diagram_prompt':
      return 'No description was provided for the plan.';
    default:
      if (code.startsWith('floor_plan_insert_failed')) {
        return 'The plan was generated but could not be saved. Please try again.';
      }
      if (code.startsWith('openai_image_failed')) {
        return 'Could not generate the plan image. Please try again later.';
      }
      return code;
  }
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/**
 * Human-friendly summary of a parked tool invocation. Pulls fields out of
 * `input_json` per tool type. Falls back to raw tool name if the input
 * doesn't have the expected shape.
 */
function summarize(row: AIToolPending): { title: string; subtitle: string } {
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(row.input_json);
  } catch {
    // keep empty input; subtitle will be generic
  }
  switch (row.tool_name) {
    case 'assign_task_to_member': {
      const taskTitle = (input.task_title as string | undefined) ?? 'a task';
      const reason = (input.reason as string | undefined) ?? '';
      return {
        title: `Assign "${taskTitle}"`,
        subtitle: reason,
      };
    }
    case 'send_sms_to_contractor': {
      const body = (input.body as string | undefined) ?? '';
      return {
        title: 'Send SMS to contractor',
        subtitle: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      };
    }
    case 'send_email_to_contractor': {
      const subject = (input.subject as string | undefined) ?? '(no subject)';
      const body = (input.body as string | undefined) ?? '';
      return {
        title: `Email contractor: ${subject}`,
        subtitle: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      };
    }
    case 'request_quotes_from_saved_contractors': {
      const scope = (input.scope as string | undefined) ?? 'a project';
      const count =
        (input.contractor_ids as string[] | undefined)?.length ?? 0;
      return {
        title: `Request quotes (${count} contractor${count === 1 ? '' : 's'})`,
        subtitle: scope,
      };
    }
    case 'create_garden_site_plan': {
      const area = (input.area_label as string | undefined) ?? 'Yard plan';
      const ctx = (input.plan_type as string | undefined) ?? 'garden';
      return {
        title: 'Create AI garden site plan',
        subtitle: `${area} (${ctx.replace(/_/g, ' ')})`,
      };
    }
    case 'classify_and_save_attachment': {
      const kind = (input.kind as string | undefined) ?? 'file';
      const fileName = (input.file_name as string | undefined) ?? 'attachment';
      const metadata = (input.metadata as Record<string, unknown> | undefined) ?? {};
      const kindLabel =
        kind === 'floor_plan' ? 'floor plan' :
        kind === 'report' ? 'report' :
        kind === 'receipt' ? 'receipt' :
        kind === 'quote' ? 'quote' :
        kind === 'photo' ? 'photo' :
        kind === 'note' ? 'note' :
        kind;
      const parts: string[] = [];
      if (kind === 'floor_plan') {
        const label = metadata.floor_label as string | undefined;
        const building = metadata.building_name as string | undefined;
        if (label) parts.push(label);
        if (building) parts.push(building);
      } else if (kind === 'report') {
        const inspector = metadata.inspector_name as string | undefined;
        const date = metadata.inspection_date as string | undefined;
        if (inspector) parts.push(inspector);
        if (date) parts.push(date);
      } else if (kind === 'receipt') {
        const billType = metadata.bill_type as string | undefined;
        const provider = metadata.provider as string | undefined;
        if (billType) parts.push(billType);
        if (provider) parts.push(provider);
      }
      return {
        title: `File ${kindLabel}: ${fileName}`,
        subtitle: parts.length > 0 ? parts.join(' · ') : 'Route to the matching record',
      };
    }
    default:
      return {
        title: row.tool_name,
        subtitle: 'Unknown tool — raw JSON in audit log',
      };
  }
}

export function ApprovalsScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const queryClient = useQueryClient();
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);
  const hid = currentHousehold?.id ?? null;
  const { name: personaName } = useAihousekeeperPersona();

  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const approvalsQuery = useQuery({
    queryKey: ['aihousekeeper', 'approvals', hid],
    queryFn: () => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.listApprovals(hid, { status: 'pending', limit: 50 });
    },
    enabled: !!hid,
  });

  const approveMutation = useMutation({
    mutationFn: (approvalId: string) => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.approveApproval(hid, approvalId);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'approvals', hid] });
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'ledger', hid] });
    },
    onSuccess: (res) => {
      const status = res.approval?.status ?? 'approved';
      if (status === 'failed') {
        const rawErr =
          res.execution && !res.execution.ok
            ? res.execution.error
            : 'Execution failed';
        Alert.alert(
          `${personaName} couldn\u2019t complete that`,
          friendlyApprovalError(rawErr)
        );
        return;
      }
      if (res.execution?.ok !== true) return;

      const result = res.execution.result as {
        garden_plan_id?: string;
        area_label?: string;
        queued?: boolean;
      };

      // Async path: garden-plan generation was queued. The placeholder
      // garden_plans row already exists in 'generating' status; refresh the
      // store so it shows up in the Gardening tab while OpenAI runs.
      if (res.execution.queued === true || result.queued === true) {
        if (hid) {
          void gardenPlansApi
            .list(hid)
            .then((data) => {
              useGardenPlanStore.getState().setGardenPlans(data.garden_plans);
            })
            .catch(() => {
              // non-fatal; user can pull-to-refresh in Gardening
            });
        }
        const areaLabel = result.area_label ?? 'Your garden plan';
        Alert.alert(
          `${personaName} is generating your plan`,
          `${areaLabel} usually takes 15\u201330 seconds. We'll notify you when it's ready.`
        );
        return;
      }

      // Synchronous path (e.g. legacy deployments still returning the row).
      if (typeof result.garden_plan_id === 'string' && hid) {
        const gardenPlanId = result.garden_plan_id;
        const areaLabel = result.area_label ?? 'Yard plan';
        void gardenPlansApi
          .list(hid)
          .then((data) => {
            useGardenPlanStore.getState().setGardenPlans(data.garden_plans);
          })
          .catch(() => {
            // non-fatal; user can pull-to-refresh in Gardening
          });
        Alert.alert(
          'Plan ready',
          `${areaLabel} was saved under Gardening site plans.`,
          [
            { text: 'OK', style: 'cancel' },
            {
              text: 'View plan',
              onPress: () => {
                navigation.dispatch(
                  CommonActions.navigate({
                    name: 'Main',
                    params: {
                      screen: 'Gardening',
                      params: {
                        screen: 'GardenPlanViewer',
                        params: { gardenPlanId },
                      },
                    },
                  })
                );
              },
            },
          ]
        );
      }
    },
    onError: (err: Error) => {
      Alert.alert('Approval failed', friendlyApprovalError(err.message));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (approvalId: string) => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.cancelApproval(hid, approvalId);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'approvals', hid] });
    },
  });

  const headerBack = (
    <ScreenHeader
      title={`${personaName} approvals`}
      showBackButton
      onBackPress={() => navigation.goBack()}
    />
  );

  const handleApprove = (row: AIToolPending) => {
    const { title } = summarize(row);
    Alert.alert(`Approve: ${title}`, `${personaName} will run this action now.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: () => {
          setPendingActionId(row.id);
          approveMutation.mutate(row.id, {
            onSettled: () => setPendingActionId(null),
          });
        },
      },
    ]);
  };

  const handleCancel = (row: AIToolPending) => {
    setPendingActionId(row.id);
    cancelMutation.mutate(row.id, {
      onSettled: () => setPendingActionId(null),
    });
  };

  if (!hid) {
    return (
      <AppBackground opacity={0.5} testID="aihousekeeper-approvals-screen">
        {headerBack}
        <EmptyState
          icon="home"
          title="Select a household"
          description={`Pick a household to see ${personaName}'s pending approvals.`}
        />
      </AppBackground>
    );
  }

  if (approvalsQuery.isLoading) {
    return (
      <AppBackground opacity={0.5} testID="aihousekeeper-approvals-screen">
        {headerBack}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (approvalsQuery.isError) {
    return (
      <AppBackground opacity={0.5} testID="aihousekeeper-approvals-screen">
        {headerBack}
        <View style={styles.centered}>
          <Typography variant="headline" weight="semibold">
            Couldn't load approvals
          </Typography>
          <Pressable
            onPress={() => approvalsQuery.refetch()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Typography variant="body" weight="semibold" color={colors.white}>
              Retry
            </Typography>
          </Pressable>
        </View>
      </AppBackground>
    );
  }

  const approvals = approvalsQuery.data?.approvals ?? [];

  if (approvals.length === 0) {
    return (
      <AppBackground opacity={0.5} testID="aihousekeeper-approvals-screen">
        {headerBack}
        <EmptyState
          icon="checkmark-circle"
          title="All caught up"
          description={`${personaName} has no pending actions awaiting your approval.`}
        />
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5} testID="aihousekeeper-approvals-screen">
      {headerBack}
      <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: containerPadding },
        ]}>
        <AdaptiveContainer maxWidth={isTablet ? 720 : undefined}>
          {approvals.map((row) => {
            const { title, subtitle } = summarize(row);
            const isBusy = pendingActionId === row.id;
            return (
              <Card key={row.id} style={styles.card}>
                <Typography variant="subheadline" weight="semibold">
                  {title}
                </Typography>
                {subtitle ? (
                  <Typography
                    variant="caption1"
                    color={colors.textSecondary}
                    style={styles.subtitle}
                  >
                    {subtitle}
                  </Typography>
                ) : null}
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  style={styles.meta}
                >
                  Created {formatCreatedAt(row.created_at)} · Expires{' '}
                  {new Date(row.expires_at).toLocaleDateString()}
                </Typography>
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => handleCancel(row)}
                    disabled={isBusy}
                    style={({ pressed }) => [
                      styles.btn,
                      styles.cancelBtn,
                      {
                        borderColor: colors.textSecondary,
                        opacity: pressed || isBusy ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Typography variant="body" weight="semibold">
                      Dismiss
                    </Typography>
                  </Pressable>
                  <Pressable
                    onPress={() => handleApprove(row)}
                    disabled={isBusy}
                    style={({ pressed }) => [
                      styles.btn,
                      styles.approveBtn,
                      {
                        backgroundColor: colors.primary,
                        opacity: pressed || isBusy ? 0.6 : 1,
                      },
                    ]}
                  >
                    {isBusy ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Typography
                        variant="body"
                        weight="semibold"
                        color={colors.white}
                      >
                        Approve
                      </Typography>
                    )}
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingVertical: 16, paddingBottom: 48 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  card: {
    marginBottom: 12,
    padding: 16,
  },
  subtitle: { marginTop: 4 },
  meta: { marginTop: 8 },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    justifyContent: 'flex-end',
  },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    borderWidth: 1,
  },
  approveBtn: {},
});

export default ApprovalsScreen;
