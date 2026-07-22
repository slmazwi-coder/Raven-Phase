import React from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';

const C = colors.light;

const ROLE_COLORS: Record<string, string> = {
  admin: C.primary,
  moderator: '#9B6FD4',
  member: C.textSecondary,
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { member, logout } = useAuth();

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 34 : insets.bottom;

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

  if (!member) return null;

  const roleColor = ROLE_COLORS[member.role] ?? C.textSecondary;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: topPadding, paddingBottom: bottomPadding + 16 },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      {/* Avatar */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Feather name="user" size={40} color={C.textSecondary} />
        </View>
        <View style={[styles.roleBadge, { backgroundColor: `${roleColor}22` }]}>
          <Text style={[styles.roleText, { color: roleColor }]}>
            {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
          </Text>
        </View>
      </View>

      {/* Info rows */}
      <View style={styles.section}>
        <View style={styles.infoRow}>
          <Feather name="key" size={16} color={C.textSecondary} />
          <View style={styles.infoBody}>
            <Text style={styles.infoLabel}>Member ID</Text>
            <Text style={styles.infoValue} numberOfLines={1}>
              {member.id}
            </Text>
          </View>
        </View>
      </View>

      {/* Sign out */}
      <View style={styles.section}>
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.dangerRow,
            pressed && styles.dangerRowPressed,
          ]}
        >
          <Feather name="log-out" size={18} color={C.accent} />
          <Text style={styles.dangerText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
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
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 14,
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
  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
  },
  roleText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: C.surface,
    borderRadius: C.radius,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  infoBody: {
    flex: 1,
    gap: 2,
  },
  infoLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.text,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  dangerRowPressed: {
    opacity: 0.6,
  },
  dangerText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: C.accent,
  },
});
