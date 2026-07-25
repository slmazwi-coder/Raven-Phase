import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import colors from '@/constants/colors';
import { fetchGroups, type Group } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const C = colors.light;

function formatTime(date?: string) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function lastMessageText(group: Group): string {
  if (!group.lastMessage) return 'Tap to start chatting';
  const { content, contentType, mediaName } = group.lastMessage;
  if (contentType === 'image') return '📷 Photo';
  if (contentType === 'audio') return '🎤 Voice message';
  if (contentType === 'document') return `📄 ${mediaName || 'Document'}`;
  if (!content.trim()) return 'Media';
  if (group.isDirect) return content;
  const sender = group.lastMessage.senderName ?? '';
  return sender ? `${sender}: ${content}` : content;
}

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
}

function ChatRow({ group, onPress }: { group: Group; onPress: () => void }) {
  const time = formatTime(group.lastMessage?.createdAt);
  const hasUnread = (group.unreadCount ?? 0) > 0;
  const preview = lastMessageText(group);
  const online = group.isDirect && group.otherIsOnline;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.avatarWrap}>
        {group.avatar ? (
          <Image source={{ uri: group.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial}>{initials(group.name)}</Text>
          </View>
        )}
        {online ? <View style={styles.onlineDot} /> : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>{group.name}</Text>
          <Text style={[styles.rowTime, hasUnread && styles.rowTimeUnread]}>{time}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.rowPreview, hasUnread && styles.rowPreviewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {hasUnread ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{group.unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [query, setQuery] = useState('');

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['groups', token],
    queryFn: () => fetchGroups(token!),
    enabled: !!token,
  });

  const groups = data?.groups ?? [];

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, query]);

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Raven</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/group/create')} style={styles.headerBtn} hitSlop={12}>
            <Feather name="plus" size={20} color={C.text} />
          </Pressable>
          <Pressable onPress={() => router.push('/group/new-dm')} style={styles.headerBtn} hitSlop={12}>
            <Feather name="edit" size={20} color={C.text} />
          </Pressable>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Feather name="search" size={16} color={C.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search chats"
          placeholderTextColor={C.textTertiary}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={C.accent} />
          <Text style={styles.emptyText}>Could not load chats.</Text>
          <Pressable onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredGroups}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChatRow
              group={item}
              onPress={() => {
                Haptics.selectionAsync();
                router.push(`/group/${item.id}`);
              }}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={C.primary} />
          }
          contentContainerStyle={filteredGroups.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={() => (
            <View style={styles.center}>
              <Feather name="message-circle" size={48} color={C.textTertiary} />
              <Text style={styles.emptyTitle}>
                {query ? 'No chats found' : 'No chats yet'}
              </Text>
              <Text style={styles.emptyText}>
                {query
                  ? 'Try a different search.'
                  : 'Tap the + or pencil icon to start a new chat or group.'}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.surfaceElevated,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerBtn: {
    padding: 8,
    borderRadius: 22,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    marginHorizontal: 12,
    marginVertical: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    height: 42,
  },
  listContent: {
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: C.primary,
    borderRadius: C.radius,
  },
  retryText: {
    color: C.primaryForeground,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowPressed: {
    backgroundColor: C.surface,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: C.surface,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.primary,
    borderWidth: 2,
    borderColor: C.background,
  },
  rowBody: {
    flex: 1,
    marginLeft: 14,
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowName: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  rowTime: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textTertiary,
    marginLeft: 8,
  },
  rowTimeUnread: {
    color: C.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  rowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowPreview: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  rowPreviewUnread: {
    color: C.text,
    fontFamily: 'Inter_500Medium',
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    marginLeft: 8,
  },
  unreadText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: C.primaryForeground,
  },
});
