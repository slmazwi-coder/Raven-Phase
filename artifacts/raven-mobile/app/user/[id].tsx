import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import colors from '@/constants/colors';
import { createDirectGroup, fetchMemberById, type MemberProfile } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatLastSeen } from '@/lib/format';

const C = colors.light;

function Avatar({ member, size = 120 }: { member?: MemberProfile; size?: number }) {
  const initials = (member?.fullName ?? '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={[styles.avatarWrap, { width: size, height: size, borderRadius: size / 2 }]}>
      {member?.avatar ? (
        <Image
          source={{ uri: member.avatar }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
        />
      ) : (
        <Text style={[styles.avatarInitials, { fontSize: size * 0.36 }]}>{initials || '?'}</Text>
      )}
    </View>
  );
}

export default function UserProfileScreen() {
  const { id: memberId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, member: me } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['member', memberId, token],
    queryFn: () => fetchMemberById(token!, memberId!),
    enabled: !!memberId && !!token,
    refetchInterval: 15_000,
  });

  const member = data?.member;
  const isMe = member?.id === me?.id;

  const createDm = useMutation({
    mutationFn: () => createDirectGroup(token!, memberId!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/group/${res.group.id}`);
    },
    onError: (e: any) => {
      Alert.alert('Could not start chat', e?.message ?? 'Please try again');
    },
  });

  const topPadding = Platform.OS === 'web' ? 24 : insets.top;

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={C.text} />
          </Pressable>
          <View style={{ width: 30 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      </View>
    );
  }

  if (isError || !member) {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={C.text} />
          </Pressable>
          <View style={{ width: 30 }} />
        </View>
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={C.accent} />
          <Text style={styles.errorText}>Could not load profile.</Text>
          <Pressable onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const presenceText = member.isOnline
    ? 'online'
    : member.lastSeenAt
      ? formatLastSeen(member.lastSeenAt)
      : 'offline';

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{member.fullName}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Avatar member={member} size={120} />
          <Text style={styles.name}>{member.fullName}</Text>
          <Text style={styles.presence}>
            {member.isOnline ? <Text style={styles.onlineDot}>● </Text> : null}
            {presenceText}
          </Text>
        </View>

        <View style={styles.section}>
          {member.role ? (
            <View style={styles.row}>
              <Feather name="shield" size={18} color={C.textSecondary} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Role</Text>
                <Text style={styles.rowValue}>{member.role}</Text>
              </View>
            </View>
          ) : null}

          {member.status ? (
            <View style={styles.row}>
              <Feather name="activity" size={18} color={C.textSecondary} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Status</Text>
                <Text style={styles.rowValue}>{member.status}</Text>
              </View>
            </View>
          ) : null}

          {member.cellNumber ? (
            <View style={styles.row}>
              <Feather name="phone" size={18} color={C.textSecondary} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Phone</Text>
                <Text style={styles.rowValue}>{member.cellNumber}</Text>
              </View>
            </View>
          ) : null}

          {member.createdAt ? (
            <View style={styles.row}>
              <Feather name="calendar" size={18} color={C.textSecondary} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Joined</Text>
                <Text style={styles.rowValue}>
                  {new Date(member.createdAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {!isMe ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            onPress={() => createDm.mutate()}
            disabled={createDm.isPending}
            style={({ pressed }) => [
              styles.messageBtn,
              pressed && styles.messageBtnPressed,
            ]}
          >
            {createDm.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="message-circle" size={20} color="#fff" />
                <Text style={styles.messageBtnText}>Message</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}
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
  content: {
    padding: 24,
    alignItems: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarWrap: {
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 16,
  },
  avatarInitials: {
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  name: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    textAlign: 'center',
  },
  presence: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
    marginTop: 6,
  },
  onlineDot: {
    color: '#22C55E',
  },
  section: {
    width: '100%',
    backgroundColor: C.surface,
    borderRadius: C.radius,
    padding: 16,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowValue: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: C.text,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  messageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 54,
    backgroundColor: C.primary,
    borderRadius: C.radius,
  },
  messageBtnPressed: { opacity: 0.85 },
  messageBtnText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
});
