import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

function normalizeQuery(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 ? `+${digits}` : trimmed;
}

export default function CreateGroupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMember[]>([]);
  const [selected, setSelected] = useState<SearchMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleSearch() {
    const q = normalizeQuery(query);
    if (q.length < 3) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await searchMembers(token!, q);
      setSearchResults(res.members);
    } catch (e: any) {
      Alert.alert('Search failed', e?.message ?? 'Could not search members');
    } finally {
      setSearching(false);
    }
  }

  function toggleMember(member: SearchMember) {
    Haptics.selectionAsync();
    setSelected((prev) => {
      const exists = prev.find((m) => m.id === member.id);
      if (exists) return prev.filter((m) => m.id !== member.id);
      return [...prev, member];
    });
  }

  async function handleCreate() {
    const groupName = name.trim();
    if (!groupName) {
      Alert.alert('Group name required', 'Enter a name for the group.');
      return;
    }
    if (!token) return;

    setCreating(true);
    try {
      const res = await createGroup(token, {
        name: groupName,
        member_ids: selected.map((m) => m.id),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.replace(`/group/${res.group.id}`);
    } catch (e: any) {
      Alert.alert('Could not create group', e?.message ?? 'Please try again');
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
        <Text style={styles.headerTitle}>Create group</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Group name"
          placeholderTextColor={C.textTertiary}
          value={name}
          onChangeText={setName}
          autoFocus
        />

        <Text style={styles.label}>Add members</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or phone"
            placeholderTextColor={C.textTertiary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            autoCapitalize="none"
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

        {selected.length > 0 ? (
          <View style={styles.selectedRow}>
            {selected.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => toggleMember(m)}
                style={styles.selectedChip}
              >
                <Text style={styles.selectedChipText} numberOfLines={1}>
                  {m.fullName}
                </Text>
                <Feather name="x" size={14} color="#fff" />
              </Pressable>
            ))}
          </View>
        ) : null}

        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isSelected = selected.some((m) => m.id === item.id);
            return (
              <Pressable
                onPress={() => toggleMember(item)}
                style={[styles.result, isSelected && styles.resultSelected]}
              >
                <View style={styles.resultAvatar}>
                  <Text style={styles.resultInitial}>
                    {item.fullName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.resultBody}>
                  <Text style={styles.resultName}>{item.fullName}</Text>
                  <Text style={styles.resultPhone}>{item.cellNumber}</Text>
                </View>
                {isSelected ? (
                  <Feather name="check-circle" size={20} color={C.primary} />
                ) : (
                  <Feather name="circle" size={20} color={C.border} />
                )}
              </Pressable>
            );
          }}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={() =>
            !searching && query.length >= 3 ? (
              <Text style={styles.emptyText}>No members found.</Text>
            ) : (
              <Text style={styles.hintText}>
                Type at least 3 characters and tap search.
              </Text>
            )
          }
        />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={handleCreate}
          disabled={creating}
          style={({ pressed }) => [
            styles.createBtn,
            (!name.trim() || creating) && styles.createBtnDisabled,
            pressed && styles.createBtnPressed,
          ]}
        >
          {creating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>
              Create group
              {selected.length > 0 ? ` · ${selected.length}` : ''}
            </Text>
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
    paddingTop: 16,
    gap: 14,
  },
  input: {
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
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: C.text,
    marginTop: 4,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    height: 48,
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
    width: 48,
    height: 48,
    borderRadius: C.radius,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnPressed: { opacity: 0.8 },
  selectedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  selectedChipText: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    maxWidth: 140,
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: C.surface,
    borderRadius: C.radius,
    marginBottom: 10,
  },
  resultSelected: {
    borderWidth: 1,
    borderColor: C.primary,
  },
  resultAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultInitial: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  resultBody: { flex: 1 },
  resultName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  resultPhone: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  emptyText: {
    textAlign: 'center',
    color: C.textSecondary,
    fontFamily: 'Inter_400Regular',
    marginTop: 24,
  },
  hintText: {
    textAlign: 'center',
    color: C.textTertiary,
    fontFamily: 'Inter_400Regular',
    marginTop: 24,
  },
  footer: {
    paddingHorizontal: 16,
    marginTop: 'auto',
  },
  createBtn: {
    height: 52,
    backgroundColor: C.primary,
    borderRadius: C.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnPressed: { opacity: 0.85 },
  createBtnText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});
