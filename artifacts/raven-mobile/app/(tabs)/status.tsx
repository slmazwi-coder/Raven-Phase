import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';

const C = colors.light;

export default function StatusScreen() {
  const insets = useSafeAreaInsets();
  const { member } = useAuth();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Status</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.myStatus}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>
              {(member?.fullName ?? 'R').charAt(0).toUpperCase()}
            </Text>
            <View style={styles.addBadge}>
              <Feather name="plus" size={12} color="#fff" />
            </View>
          </View>
          <View style={styles.myStatusBody}>
            <Text style={styles.name}>My status</Text>
            <Text style={styles.hint}>Tap to add status update</Text>
          </View>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent updates</Text>
          <View style={styles.empty}>
            <Feather name="aperture" size={40} color={C.textTertiary} />
            <Text style={styles.emptyText}>No status updates yet.</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
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
  scroll: {
    paddingBottom: 32,
  },
  myStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarInitial: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
  },
  addBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: C.background,
  },
  myStatusBody: { flex: 1, gap: 2 },
  name: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  hint: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  section: {
    marginTop: 8,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
});
