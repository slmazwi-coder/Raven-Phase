import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import colors from '@/constants/colors';
import {
  fetchMessages,
  fetchGroupMembers,
  fetchGroup,
  type ChatMessage,
} from '@/lib/api';
import { useGroupChat } from '@/lib/ws';
import { useAuth } from '@/context/AuthContext';
import { useSecurity } from '@/context/SecurityContext';

const C = colors.light;

interface BubbleProps {
  msg: ChatMessage;
  isMine: boolean;
  showSender: boolean;
}

function Bubble({ msg, isMine, showSender }: BubbleProps) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
      <View
        style={[
          styles.bubble,
          isMine ? styles.bubbleSent : styles.bubbleReceived,
        ]}
      >
        {showSender && !isMine ? (
          <Text style={styles.senderName}>{msg.senderName}</Text>
        ) : null}
        <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
          {msg.content}
        </Text>
        <Text
          style={[
            styles.bubbleTime,
            isMine ? styles.bubbleTimeMine : styles.bubbleTimeOther,
          ]}
        >
          {time}
        </Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { token, member } = useAuth();
  const { setActiveGroupId, lastEnforcement, clearLastEnforcement } = useSecurity();

  const [inputText, setInputText] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Register this chat as the active group for screenshot/recording reporting
  useEffect(() => {
    setActiveGroupId(groupId ?? null);
    return () => setActiveGroupId(null);
  }, [groupId, setActiveGroupId]);

  // React to enforcement actions returned by /incidents/report
  useEffect(() => {
    if (!lastEnforcement) return;

    const messages: Record<string, string> = {
      warn: 'Screenshot/recording detected. This incident has been logged.',
      mute: `You have been muted until ${lastEnforcement.mutedUntil ? new Date(lastEnforcement.mutedUntil).toLocaleString() : 'the expiry time'}`,
      remove: 'You have been removed from this group.',
      ban: 'You have been banned from Raven.',
    };

    Alert.alert('Security policy enforced', messages[lastEnforcement.action] ?? 'A security policy was enforced.');

    if (lastEnforcement.action === 'remove' || lastEnforcement.action === 'ban') {
      router.replace('/(tabs)');
    }

    clearLastEnforcement();
  }, [lastEnforcement, clearLastEnforcement, router]);

  // Load group detail
  const { data: groupData } = useQuery({
    queryKey: ['group', groupId, token],
    queryFn: () => fetchGroup(groupId!, token!),
    enabled: !!groupId && !!token,
  });

  // Load group members
  const { data: membersData } = useQuery({
    queryKey: ['group-members', groupId, token],
    queryFn: () => fetchGroupMembers(groupId!, token!),
    enabled: !!groupId && !!token,
  });

  // Load message history
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['messages', groupId, token],
    queryFn: () => fetchMessages(groupId!, token!),
    enabled: !!groupId && !!token,
  });

  // Real-time WebSocket
  const { messages: wsMessages, sendMessage, prependHistory } = useGroupChat(
    groupId ?? null,
    token,
  );

  // Merge history into WS state once loaded
  const historyMergedRef = useRef(false);
  useEffect(() => {
    if (historyData?.messages && !historyMergedRef.current) {
      historyMergedRef.current = true;
      // History is ascending; we want descending for inverted FlatList
      prependHistory([...historyData.messages].reverse());
    }
  }, [historyData, prependHistory]);

  const groupName = groupData?.group.name ?? 'Group';
  const memberCount = membersData?.members.length ?? 0;

  const handleSend = useCallback(() => {
    const content = inputText.trim();
    if (!content) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(content);
    setInputText('');
  }, [inputText, sendMessage]);

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Pressable
          style={styles.headerMeta}
          onPress={() => router.push(`/group/${groupId}/members`)}
        >
          <Text style={styles.headerName} numberOfLines={1}>
            {groupName}
          </Text>
          {memberCount > 0 ? (
            <Text style={styles.headerSub}>
              {memberCount} member{memberCount !== 1 ? 's' : ''}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => router.push(`/group/${groupId}/members`)}
          style={styles.membersBtn}
        >
          <Feather name="users" size={20} color={C.textSecondary} />
        </Pressable>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {historyLoading && wsMessages.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.primary} size="large" />
          </View>
        ) : (
          <FlatList
            data={wsMessages}
            keyExtractor={(item) => item.id}
            inverted
            renderItem={({ item, index }) => {
              const isMine = item.senderId === member?.id;
              const prevMsg = wsMessages[index + 1];
              const showSender =
                !isMine && (!prevMsg || prevMsg.senderId !== item.senderId);
              return (
                <Bubble msg={item} isMine={isMine} showSender={showSender} />
              );
            }}
            scrollEnabled={!!wsMessages.length}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={() => (
              <View style={styles.emptyChat}>
                <Feather
                  name="message-circle"
                  size={44}
                  color={C.textTertiary}
                />
                <Text style={styles.emptyChatText}>No messages yet</Text>
                <Text style={styles.emptyChatSub}>Be the first to say hi.</Text>
              </View>
            )}
          />
        )}

        {/* Input bar */}
        <View
          style={[styles.inputBar, { paddingBottom: bottomPadding + 8 }]}
        >
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            placeholder="Message…"
            placeholderTextColor={C.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            returnKeyType="default"
          />
          <Pressable
            onPress={handleSend}
            disabled={!inputText.trim()}
            style={({ pressed }) => [
              styles.sendBtn,
              !inputText.trim() && styles.sendBtnDisabled,
              pressed && styles.sendBtnPressed,
            ]}
          >
            <Feather name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  backBtn: { padding: 4 },
  headerMeta: { flex: 1 },
  headerName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  membersBtn: { padding: 6 },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: {
    padding: 12,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },

  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 3,
    paddingHorizontal: 4,
  },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 4,
  },
  bubbleSent: {
    backgroundColor: C.bubbleSent,
    borderBottomRightRadius: 4,
  },
  bubbleReceived: {
    backgroundColor: C.bubbleReceived,
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
    marginBottom: 2,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.bubbleReceivedText,
    lineHeight: 21,
  },
  bubbleTextMine: { color: C.bubbleSentText },
  bubbleTime: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.65)' },
  bubbleTimeOther: { color: C.textTertiary },

  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: 60,
  },
  emptyChatText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.textSecondary,
  },
  emptyChatSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textTertiary,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.background,
    gap: 10,
  },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: C.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: C.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: C.surface },
  sendBtnPressed: { opacity: 0.75 },
});
