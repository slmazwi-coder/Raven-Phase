import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
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

function GroupCard({ group, onPress }: { group: Group; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardAvatar}>
        <Feather name="users" size={20} color={C.primary} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.cardRole}>{group.roleInGroup}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={C.textTertiary} />
    </Pressable>
  );
}

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['groups', token],
    queryFn: () => fetchGroups(token!),
    enabled: !!token,
  });

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;

  function handlePress(group: Group) {
    Haptics.selectionAsync();
    router.push(`/group/${group.id}`);
  }

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Raven</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/group/new-dm')}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
            hitSlop={12}
          >
            <Feather name="message-circle" size={22} color={C.primary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/group/create')}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
            hitSlop={12}
          >
            <Feather name="plus" size={22} color={C.primary} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={C.accent} />
          <Text style={styles.emptyText}>Could not load groups.</Text>
          <Pressable onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data?.groups ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <GroupCard group={item} onPress={() => handlePress(item)} />
          )}
          scrollEnabled={!!(data?.groups?.length)}
          contentContainerStyle={
            !data?.groups?.length ? styles.emptyContainer : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={C.primary}
            />
          }
          ListEmptyComponent={() => (
            <View style={styles.center}>
              <Feather name="message-square" size={48} color={C.textTertiary} />
              <Text style={styles.emptyTitle}>No groups yet</Text>
              <Text style={styles.emptyText}>
                Create a group or start a direct chat.
              </Text>
              <View style={styles.emptyActions}>
                <Pressable
                  onPress={() => router.push('/group/new-dm')}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.actionBtnSecondary,
                    pressed && styles.actionBtnPressed,
                  ]}
                >
                  <Feather name="message-circle" size={16} color={C.primary} />
                  <Text style={styles.actionBtnSecondaryText}>New chat</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push('/group/create')}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    pressed && styles.actionBtnPressed,
                  ]}
                >
                  <Feather name="plus" size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>Create group</Text>
                </Pressable>
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    letterSpacing: 1,
  },
  headerBtn: {
    padding: 6,
    borderRadius: 22,
    backgroundColor: C.surface,
  },
  headerBtnPressed: {
    opacity: 0.7,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: C.primary,
    borderRadius: C.radius,
  },
  actionBtnSecondary: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.primary,
  },
  actionBtnPressed: {
    opacity: 0.8,
  },
  actionBtnText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  actionBtnSecondaryText: {
    color: C.primary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: C.radius,
    padding: 14,
    gap: 12,
  },
  cardPressed: {
    opacity: 0.75,
  },
  cardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  cardRole: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
    textTransform: 'capitalize',
  },
  separator: {
    height: 10,
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
});
