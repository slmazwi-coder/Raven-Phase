import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { fetchGroupMembers, removeGroupMember, type GroupMember } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const C = colors.light;

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  admin: { bg: `${C.primary}22`, text: C.primary },
  moderator: { bg: '#9B6FD422', text: '#9B6FD4' },
  member: { bg: C.surface, text: C.textSecondary },
};

function MemberRow({
  member: m,
  isAdmin,
  onPress,
  onRemove,
}: {
  member: GroupMember;
  isAdmin: boolean;
  onPress: () => void;
  onRemove?: () => void;
}) {
  const badge = ROLE_BADGE[m.roleInGroup] ?? ROLE_BADGE.member;
  const initials = m.fullName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowAvatar}>
        {m.avatar ? (
          <Image source={{ uri: m.avatar }} style={styles.rowAvatarImg} />
        ) : (
          <Text style={styles.rowInitials}>{initials || '?'}</Text>
        )}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {m.fullName}
        </Text>
        {m.cellNumber ? (
          <Text style={styles.rowPhone}>{m.cellNumber}</Text>
        ) : null}
      </View>
      {isAdmin && onRemove ? (
        <Pressable onPress={onRemove} style={styles.removeBtn} hitSlop={8}>
          <Feather name="user-minus" size={18} color={C.accent} />
        </Pressable>
      ) : (
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.text }]}>
            {m.roleInGroup}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function MembersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { token, member } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['group-members', groupId, token],
    queryFn: () => fetchGroupMembers(groupId!, token!),
    enabled: !!groupId && !!token,
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeGroupMember(groupId!, token!, memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['group-members', groupId] }),
    onError: (e: any) => Alert.alert('Could not remove member', e?.message ?? 'Please try again'),
  });

  const isAdmin = (data?.members ?? []).find((m) => m.id === member?.id)?.roleInGroup === 'admin';

  const handleRemove = (target: GroupMember) => {
    Alert.alert(
      'Remove member',
      `Remove ${target.fullName} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMutation.mutate(target.id),
        },
      ],
    );
  };

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Members</Text>
        <View style={{ width: 30 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={C.accent} />
          <Text style={styles.errorText}>Could not load members.</Text>
          <Pressable onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data?.members ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              isAdmin={isAdmin}
              onPress={() => router.push(`/user/${item.id}`)}
              onRemove={
                isAdmin && item.id !== member?.id
                  ? () => handleRemove(item)
                  : undefined
              }
            />
          )}
          scrollEnabled={!!(data?.members?.length)}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={() =>
            data?.members ? (
              <Text style={styles.count}>
                {data.members.length} member
                {data.members.length !== 1 ? 's' : ''}
              </Text>
            ) : null
          }
        />
      )}
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
  },
  backBtn: { padding: 4, width: 30 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: {
    color: C.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  retryBtn: {
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
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  count: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: C.radius,
    padding: 12,
    gap: 12,
  },
  rowPressed: { opacity: 0.7 },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rowAvatarImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  rowInitials: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: C.text,
  },
  rowPhone: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
  },
  removeBtn: { padding: 8, marginLeft: 8 },
  separator: { height: 8 },
});
