import { useLocalSearchParams } from 'expo-router';

import { ChatNavigator, houseChatConfig } from '@features/chat';
import { isLanguageBrand, LanguageTutorScreen } from '@features/language';

export default function ChatTab() {
  const params = useLocalSearchParams();
  // Symply Language uses the chat slot for its AI tutor ("back-and-forth").
  if (isLanguageBrand()) {
    return <LanguageTutorScreen />;
  }
  return <ChatNavigator config={houseChatConfig} initialParams={params} />;
}
