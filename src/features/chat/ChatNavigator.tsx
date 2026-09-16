/**
 * Shared household-chat navigator (rooms list → room → room settings). ONE
 * navigator for every app; it takes a {@link ChatConfig} and provides it to the
 * shared screens via {@link ChatConfigProvider}. House mounts it from the chat
 * tab; Budget from the `/budget-chat` route the FAB opens; future apps from
 * either.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import { navigateAfterInteractions } from '@services/nav-when-ready';

import type { ChatConfig } from './ChatConfig';
import { ChatConfigProvider } from './ChatConfigContext';
import { ChatRoomScreen } from './screens/ChatRoomScreen';
import { ChatRoomSettingsScreen } from './screens/ChatRoomSettingsScreen';
import { ChatRoomsListScreen } from './screens/ChatRoomsListScreen';
import type { ChatStackParamList } from './types';

const Stack = createNativeStackNavigator<ChatStackParamList>();

interface ChatNavigatorProps {
  config: ChatConfig;
  // Deep-link params forwarded from the expo-router route (e.g. push tap →
  // open a specific room).
  initialParams?: {
    screen?: string;
    roomId?: string;
    roomName?: string;
    navNonce?: string;
  };
}

function DeepLinkHandler({
  initialParams,
  children,
}: {
  initialParams?: ChatNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const roomId = initialParams?.roomId;
    if (!roomId) return;

    const key = `${roomId}:${initialParams?.navNonce || ''}`;
    if (handled.current === key) return;
    handled.current = key;

    navigateAfterInteractions(() =>
      navigation.navigate('ChatRoom', {
        roomId,
        roomName: initialParams?.roomName || 'Chat',
      })
    );
  }, [initialParams, navigation]);

  return <>{children}</>;
}

export function ChatNavigator({ config, initialParams }: ChatNavigatorProps) {
  return (
    <ChatConfigProvider config={config}>
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
        initialRouteName="ChatRoomsList"
      >
        <Stack.Screen name="ChatRoomsList">
          {() => (
            <DeepLinkHandler initialParams={initialParams}>
              <ChatRoomsListScreen />
            </DeepLinkHandler>
          )}
        </Stack.Screen>
        <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
        <Stack.Screen name="ChatRoomSettings" component={ChatRoomSettingsScreen} />
      </Stack.Navigator>
    </ChatConfigProvider>
  );
}

export default ChatNavigator;
