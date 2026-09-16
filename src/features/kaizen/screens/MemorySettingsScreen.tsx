import { Text, View } from 'react-native';

import { Button } from '@components/ui';
import { useKaizenMemories } from '@features/kaizen/hooks/useKaizenMemories';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

export function MemorySettingsScreen() {
  const colors = useAppColors();  const appColors = useAppColors();
  const { data: memories = [] } = useKaizenMemories();
  const approveMemory = useKaizenStore(state => state.approveMemory);
  const archiveMemory = useKaizenStore(state => state.archiveMemory);
  return (
    <KaizenScreen title="Memory" subtitle="Control the facts Kaizen can use in coach context.">
      <Section title="Saved memories">
        {memories.length ? (
          memories.map(memory => (
            <View
              key={memory.id}
              style={[
                kaizenStyles.row,
                { alignItems: 'flex-start', borderBottomColor: colors.borderColor },
              ]}
            >
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary }}>{memory.fact}</Text>
                <View
                  style={[
                    kaizenStyles.badge,
                    {
                      alignSelf: 'flex-start',
                      marginTop: 6,
                      backgroundColor: memory.is_approved
                        ? appColors.surfaceSelected
                        : appColors.pillBackground,
                    },
                  ]}
                >
                  <Text
                    style={[
                      kaizenStyles.badgeText,
                      {
                        color: memory.is_approved
                          ? colors.primary
                          : colors.textSecondary,
                      },
                    ]}
                  >
                    {memory.is_approved ? 'Approved' : 'Needs approval'}
                  </Text>
                </View>
              </View>
              <View style={{ gap: 6 }}>
                {!memory.is_approved ? (
                  <Button
                    title="Approve"
                    variant="ghost"
                    onPress={() => void approveMemory(memory.fact)}
                  />
                ) : null}
                <Button
                  title="Archive"
                  variant="ghost"
                  onPress={() => void archiveMemory(memory.id)}
                />
              </View>
            </View>
          ))
        ) : (
          <EmptyState>No memories saved yet.</EmptyState>
        )}
      </Section>
    </KaizenScreen>
  );
}
