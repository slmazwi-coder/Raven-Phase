import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { fetchMember } from '@/lib/api';

const C = colors.light;

const ROLE_COLORS: Record<string, string> = {
  admin: C.primary,
  moderator: '#9B6FD4',
  member: C.textSecondary,
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { member, token, logout } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['member', token],
    queryFn: () => fetchMember(token!),
    enabled: !!token,
  });

  const profile = data?.member;
  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = insets.bottom;

  function handleLogout() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out of Raven?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ],
    );
  }

  const roleColor = ROLE_COLORS[member?.role ?? 'member'] ?? C.textSecondary;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: topPadding },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile & Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: bottomPadding + 24 },
        ]}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>
              {(profile?.fullName ?? member?.fullName ?? 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {profile?.fullName ?? member?.fullName ?? 'Raven User'}
          </Text>
          {profile?.cellNumber ? (
            <Text style={styles.phone}>{profile.cellNumber}</Text>
          ) : null}
          <View style={[styles.roleBadge, { backgroundColor: `${roleColor}22` }]}>
            <Text style={[styles.roleText, { color: roleColor }]}>
              {member?.role
                ? member.role.charAt(0).toUpperCase() + member.role.slice(1)
                : 'Member'}
            </Text>
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginVertical: 12 }} />
        ) : null}

        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <Row icon="user" label="Member ID" value={member?.id ?? ''} />
            <Divider />
            <Row icon="shield" label="Status" value={profile?.status ?? 'active'} />
          </View>
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.card}>
            <PressableRow icon="bell" label="Notifications" />
            <Divider />
            <PressableRow icon="lock" label="Privacy & Security" />
            <Divider />
            <PressableRow icon="help-circle" label="Help & Support" />
            <Divider />
            <PressableRow icon="info" label="About Raven" last />
          </View>
        </View>

        {/* Sign out */}
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.signOutBtn,
            pressed && styles.signOutBtnPressed,
          ]}
        >
          <Feather name="log-out" size={18} color={C.accent} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <Feather name={icon} size={18} color={C.textSecondary} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function PressableRow({
  icon,
  label,
  last,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  last?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Feather name={icon} size={18} color={C.textSecondary} />
      <Text style={styles.rowLabelFlex}>{label}</Text>
      <Feather name="chevron-right" size={18} color={C.textTertiary} />
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: C.text,
  },
  scroll: {
    paddingTop: 16,
  },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 40,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
  },
  name: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    maxWidth: '80%',
  },
  phone: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 2,
  },
  roleText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: C.radius,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  rowPressed: {
    backgroundColor: C.surfaceElevated,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.text,
  },
  rowLabelFlex: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.text,
  },
  rowValue: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginLeft: 46,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 14,
    backgroundColor: `${C.accent}10`,
    borderRadius: C.radius,
  },
  signOutBtnPressed: {
    opacity: 0.7,
  },
  signOutText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.accent,
  },
});
