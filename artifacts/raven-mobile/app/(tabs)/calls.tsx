import React from 'react';
import {
  Linking,
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

export default function CallsScreen() {
  const insets = useSafeAreaInsets();
  const { member } = useAuth();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Calls</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.empty}>
          <Feather name="phone" size={48} color={C.textTertiary} />
          <Text style={styles.emptyTitle}>No calls yet</Text>
          <Text style={styles.emptyText}>
            Calls can be started from a chat using the phone icon.
          </Text>
        </View>

        {member?.cellNumber ? (
          <Pressable
            onPress={() => Linking.openURL(`tel:${member.cellNumber}`)}
            style={({ pressed }) => [styles.devCall, pressed && { opacity: 0.7 }]}
          >
            <Feather name="phone" size={18} color={C.primary} />
            <Text style={styles.devCallText}>Test device dialer</Text>
          </Pressable>
        ) : null}
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
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    gap: 12,
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
    paddingHorizontal: 40,
  },
  devCall: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: C.surface,
    borderRadius: C.radius,
  },
  devCallText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
});
