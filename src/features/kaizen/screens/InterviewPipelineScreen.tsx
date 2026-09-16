import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import { BrandButton } from '@features/kaizen/brand';
import { InterviewIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import {
  useInvalidateKaizenInterviewPipeline,
  useKaizenInterviewPipeline,
} from '@features/kaizen/hooks/useKaizenInterviewPipeline';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { useAuthStore } from '@stores/authStore';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

export function InterviewPipelineScreen() {
  const colors = useAppColors();  const { white, pillBackground } = useAppColors();
  const rowIcon = useBrandIconState(false);
  const userId = useAuthStore(state => state.user?.id);
  const { data: pipeline = [] } = useKaizenInterviewPipeline();
  const invalidatePipeline = useInvalidateKaizenInterviewPipeline();
  const upsertPipelineItem = useKaizenStore(state => state.upsertPipelineItem);
  const movePipelineStage = useKaizenStore(state => state.movePipelineStage);
  const deletePipelineItem = useKaizenStore(state => state.deletePipelineItem);
  const invalidateAfterMutation = async () => {
    if (userId) {
      await invalidatePipeline(userId);
    }
  };
  const [title, setTitle] = useState('');
  const stageColor = (stage: string) => {
    if (stage === 'applied') return colors.primary;
    if (stage === 'interviewing') return colors.warning;
    if (stage === 'follow-up') return colors.success;
    return colors.textSecondary;
  };
  return <KaizenScreen title="Interview pipeline" subtitle="Track opportunities and their next stage.">
    <Section title="Add opportunity"><View style={{ gap: 12, padding: 16 }}><TextInput value={title} onChangeText={setTitle} placeholder="Company or role" placeholderTextColor={colors.textSecondary} style={{ borderBottomWidth: 1, borderColor: colors.borderColor, color: colors.textPrimary, fontSize: 16, paddingVertical: 10 }} /><BrandButton title="Add to pipeline" disabled={!title.trim()} icon={<InterviewIcon size={20} color={white} />} onPress={() => { if (!title.trim()) return; void upsertPipelineItem({ title: title.trim(), stage: 'saved' }).then(async () => { setTitle(''); await invalidateAfterMutation(); }).catch(() => undefined); }} /></View></Section>
    <Section title="Opportunities">{pipeline.length ? pipeline.map(item => <View key={item.id} style={[kaizenStyles.row, { alignItems: 'flex-start', borderBottomColor: colors.borderColor }]}><View style={{ paddingTop: 2 }}><InterviewIcon size={22} state={rowIcon} /></View><View style={kaizenStyles.rowText}><Text style={{ color: colors.textPrimary, fontWeight: '500' }}>{item.title}</Text><View style={[kaizenStyles.badge, { alignSelf: 'flex-start', backgroundColor: pillBackground, marginTop: 6 }]}><Text style={[kaizenStyles.badgeText, { color: stageColor(item.stage) }]}>{item.stage}</Text></View></View><View style={{ gap: 6 }}><Button title="Advance" variant="ghost" onPress={() => void movePipelineStage(item.id, item.stage === 'saved' ? 'applied' : item.stage === 'applied' ? 'interviewing' : 'follow-up').then(() => invalidateAfterMutation()).catch(() => undefined)} /><Button title="Remove" variant="ghost" onPress={() => void deletePipelineItem(item.id).then(() => invalidateAfterMutation()).catch(() => undefined)} /></View></View>) : <EmptyState>Add an opportunity to begin.</EmptyState>}</Section>
  </KaizenScreen>;
}
