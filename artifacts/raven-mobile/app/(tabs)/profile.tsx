import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import {
  fetchMember,
  fetchPrivacy,
  updatePrivacy,
  updateProfile,
} from '@/lib/api';

const C = colors.light;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { member, token, logout } = useAuth();
  const queryClient = useQueryClient();

  const { data: profileData, isLoading } = useQuery({
    queryKey: ['member', token],
    queryFn: () => fetchMember(token!),
    enabled: !!token,
  });

  const { data: privacyData } = useQuery({
    queryKey: ['privacy', token],
    queryFn: () => fetchPrivacy(token!),
    enabled: !!token,
  });

  const profile = profileData?.member;
  const privacy = privacyData?.privacy;

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

  const privacyMutation = useMutation({
    mutationFn: (body: { last_seen_enabled?: boolean; read_receipts_enabled?: boolean }) =>
      updatePrivacy(token!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['privacy', token] });
    },
    onError: (e: any) => Alert.alert('Update failed', e?.message ?? 'Could not update privacy'),
  });

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = insets.bottom;

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

  function handleLogout() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Sign out', 'Are you sure you want to sign out of Raven?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  }

  const displayName = profile?.fullName ?? member?.fullName ?? 'Raven User';

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding + 24 }]}>
          {/* Profile card */}
          <View style={styles.profileCard}>
            <Pressable onPress={pickAvatar} disabled={saving} style={styles.avatarWrap}>
              {profile?.avatar ? (
                <Image source={{ uri: profile.avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
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
              <Pressable
                onPress={() => {
                  setEditingName(true);
                  setNameDraft(displayName);
                }}
                style={styles.nameRow}
              >
                <Text style={styles.name} numberOfLines={1}>
                  {displayName}
                </Text>
                <Feather name="edit-2" size={16} color={C.textTertiary} />
              </Pressable>
            )}

            {profile?.cellNumber ? <Text style={styles.phone}>{profile.cellNumber}</Text> : null}
            {saving ? <ActivityIndicator color={C.primary} style={{ marginTop: 8 }} /> : null}
          </View>

          {/* Privacy */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Privacy</Text>
            <View style={styles.card}>
              <ToggleRow
                icon="eye"
                label="Last seen"
                value={privacy?.lastSeenEnabled ?? true}
                onValueChange={(v) => privacyMutation.mutate({ last_seen_enabled: v })}
              />
              <Divider />
              <ToggleRow
                icon="check-circle"
                label="Read receipts"
                value={privacy?.readReceiptsEnabled ?? true}
                onValueChange={(v) => privacyMutation.mutate({ read_receipts_enabled: v })}
              />
            </View>
          </View>

          {/* General */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>General</Text>
            <View style={styles.card}>
              <PressableRow icon="bell" label="Notifications" onPress={() => Alert.alert('Coming soon', 'Notification settings will be available in the next update.')} />
              <Divider />
              <PressableRow icon="shield" label="Security" onPress={() => Alert.alert('Raven Security', 'Screenshot/recording detection and incident reporting are active.')} />
              <Divider />
              <PressableRow icon="help-circle" label="Help" onPress={() => Alert.alert('Help', 'Contact support for help with Raven.')} />
              <Divider />
              <PressableRow icon="info" label="About Raven" onPress={() => Alert.alert('About Raven', 'End-to-end secure messaging and calls.')} />
            </View>
          </View>

          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [styles.signOutBtn, pressed && styles.signOutBtnPressed]}
          >
            <Feather name="log-out" size={18} color={C.accent} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <Pressable onPress={() => onValueChange(!value)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Feather name={icon} size={20} color={C.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: C.surface, true: C.primary }}
        thumbColor="#fff"
      />
    </Pressable>
  );
}

function PressableRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Feather name={icon} size={20} color={C.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Feather name="chevron-right" size={18} color={C.textTertiary} />
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.tabBar,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingTop: 16,
  },
  profileCard: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.surface,
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
    marginTop: 14,
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
    marginTop: 14,
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
    marginTop: 4,
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
    letterSpacing: 0.5,
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
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: C.text,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginLeft: 52,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 14,
    backgroundColor: `${C.accent}15`,
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
