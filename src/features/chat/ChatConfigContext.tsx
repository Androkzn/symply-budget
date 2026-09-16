/**
 * Provides the active {@link ChatConfig} to the shared chat screens/hooks. The
 * navigator wraps its stack in this provider; screens call {@link useChatConfig}
 * to get their app's API client, store, route segment, etc.
 */
import React, { createContext, useContext } from 'react';

import type { ChatConfig } from './ChatConfig';

const ChatConfigContext = createContext<ChatConfig | null>(null);

export function ChatConfigProvider({
  config,
  children,
}: {
  config: ChatConfig;
  children: React.ReactNode;
}) {
  return <ChatConfigContext.Provider value={config}>{children}</ChatConfigContext.Provider>;
}

export function useChatConfig(): ChatConfig {
  const config = useContext(ChatConfigContext);
  if (!config) {
    throw new Error('useChatConfig must be used within a ChatConfigProvider (ChatNavigator).');
  }
  return config;
}
