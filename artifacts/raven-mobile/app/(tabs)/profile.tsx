import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { fetchMember, updateProfile } from '@/lib/api';

const C = colors.light;

const ROLE_COLORS: Record<string, string> = {
  admin: C.primary,
  moderator: '#9B6FD4',
  member: C.textSecondary,
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { member, token, logout } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['member', token],
    queryFn: () => fetchMember(token!),
    enabled: !!token,
  });

  const profile = data?.member;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile?.fullName ?? '');
  const [saving, setSaving] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (body: { full_name?: string; avatar?: string }) =>
      updateProfile(token!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member', token] });
    },
  });

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

  async function pickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to photos to set a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      base64: false,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    const asset = result.assets[0];
    setSaving(true);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 512 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) {
        Alert.alert('Could not process image');
        return;
      }
      const dataUri = `data:image/jpeg;base64,${manipulated.base64}`;
      await updateMutation.mutateAsync({ avatar: dataUri });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Could not update avatar');
    } finally {
      setSaving(false);
    }
  }

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setEditingName(false);
    setSaving(true);
    try {
      await updateMutation.mutateAsync({ full_name: trimmed });
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? 'Could not update name');
    } finally {
      setSaving(false);
    }
  }

  const roleColor = ROLE_COLORS[member?.role ?? 'member'] ?? C.textSecondary;
  const displayName = profile?.fullName ?? member?.fullName ?? 'Raven User';

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile & Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding + 24 }]}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <Pressable onPress={pickAvatar} disabled={saving} style={styles.avatarWrap}>
            {profile?.avatar ? (
              <Image source={{ uri: profile.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarInitial}>
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.cameraBadge}>
              <Feather name="camera" size={14} color="#fff" />
            </View>
          </Pressable>

          {editingName ? (
            <View style={styles.nameEditRow}>
              <TextInput
                style={styles.nameInput}
                value={nameDraft}
                onChangeText={setNameDraft}
                onBlur={saveName}
                onSubmitEditing={saveName}
                autoFocus
                selectTextOnFocus
              />
              <Pressable onPress={saveName} style={styles.nameSaveBtn}>
                <Feather name="check" size={20} color={C.primary} />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setEditingName(true); setNameDraft(displayName); }} style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {displayName}
              </Text>
              <Feather name="edit-2" size={16} color={C.textTertiary} />
            </Pressable>
          )}

          {profile?.cellNumber ? (
            <Text style={styles.phone}>{profile.cellNumber}</Text>
          ) : null}

          {saving ? <ActivityIndicator color={C.primary} style={{ marginTop: 8 }} /> : null}

          <View style={[styles.roleBadge, { backgroundColor: `${roleColor}22` }]}>
            <Text style={[styles.roleText, { color: roleColor }]}>
              {member?.role
                ? member.role.charAt(0).toUpperCase() + member.role.slice(1)
                : 'Member'}
            </Text>
          </View>
        </View>

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
            <PressableRow icon="info" label="About Raven" />
          </View>
        </View>

        {/* Sign out */}
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [styles.signOutBtn, pressed && styles.signOutBtnPressed]}
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
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
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
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.border,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 48,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: C.background,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  name: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    maxWidth: '70%',
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  nameInput: {
    minWidth: 180,
    maxWidth: 240,
    height: 44,
    backgroundColor: C.surface,
    borderRadius: C.radius,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    color: C.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    textAlign: 'center',
  },
  nameSaveBtn: {
    padding: 6,
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
