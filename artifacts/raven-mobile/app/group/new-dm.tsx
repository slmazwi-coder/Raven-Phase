import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import colors from '@/constants/colors';
import { createGroup, searchMembers, type SearchMember } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const C = colors.light;

function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return `+${digits}`;
}

export default function NewDirectChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchMember | null>(null);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleSearch() {
    const q = normalizePhone(query);
    if (q.length < 5) {
      Alert.alert('Enter a phone number', 'Include country code, e.g. +15550000001');
      return;
    }
    setSearching(true);
    try {
      const res = await searchMembers(token!, q);
      if (res.members.length === 0) {
        setResult(null);
        Alert.alert('No user found', 'That phone number is not on Raven yet.');
      } else {
        setResult(res.members[0]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) {
      Alert.alert('Search failed', e?.message ?? 'Could not search members');
    } finally {
      setSearching(false);
    }
  }

  async function handleStartChat() {
    if (!result || !token) return;

    setCreating(true);
    try {
      const res = await createGroup(token, {
        name: result.fullName,
        member_ids: [result.id],
      });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.replace(`/group/${res.group.id}`);
    } catch (e: any) {
      Alert.alert('Could not start chat', e?.message ?? 'Please try again');
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>New chat</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Enter the person's phone number</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="+15550000001"
            placeholderTextColor={C.textTertiary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            keyboardType="phone-pad"
            autoFocus
          />
          <Pressable
            onPress={handleSearch}
            disabled={searching}
            style={({ pressed }) => [
              styles.searchBtn,
              pressed && styles.searchBtnPressed,
            ]}
          >
            {searching ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Feather name="search" size={18} color="#fff" />
            )}
          </Pressable>
        </View>

        {result ? (
          <View style={styles.resultCard}>
            <View style={styles.resultAvatar}>
              <Text style={styles.resultInitial}>
                {result.fullName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.resultBody}>
              <Text style={styles.resultName}>{result.fullName}</Text>
              <Text style={styles.resultPhone}>{result.cellNumber}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.hint}>
            Search by full phone number including country code.
          </Text>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={handleStartChat}
          disabled={!result || creating}
          style={({ pressed }) => [
            styles.startBtn,
            (!result || creating) && styles.startBtnDisabled,
            pressed && styles.startBtnPressed,
          ]}
        >
          {creating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.startBtnText}>Start chat</Text>
          )}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { padding: 4 },
  placeholder: { width: 30 },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  form: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: C.text,
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    height: 52,
    backgroundColor: C.surface,
    borderRadius: C.radius,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    color: C.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  searchBtn: {
    width: 52,
    height: 52,
    borderRadius: C.radius,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnPressed: { opacity: 0.8 },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 24,
    padding: 16,
    backgroundColor: C.surface,
    borderRadius: C.radius,
  },
  resultAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultInitial: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  resultBody: { flex: 1 },
  resultName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  resultPhone: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  hint: {
    marginTop: 16,
    color: C.textTertiary,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    marginTop: 'auto',
  },
  startBtn: {
    height: 52,
    backgroundColor: C.primary,
    borderRadius: C.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnDisabled: { opacity: 0.5 },
  startBtnPressed: { opacity: 0.85 },
  startBtnText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});
