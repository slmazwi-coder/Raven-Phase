import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCall } from '@/context/CallContext';
import colors from '@/constants/colors';

const C = colors.light;

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const {
    state,
    remote,
    duration,
    isMuted,
    isSpeaker,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleSpeaker,
  } = useCall();

  useEffect(() => {
    if (state === 'idle' || state === 'ended' || state === 'unavailable') {
      router.back();
    }
  }, [state, router]);

  const statusText =
    state === 'incoming'
      ? 'Incoming call'
      : state === 'outgoing'
        ? 'Calling...'
        : state === 'connected'
          ? formatDuration(duration)
          : state === 'busy'
            ? 'Busy'
            : state === 'unavailable'
              ? 'Unavailable'
              : '';

  return (
    <View style={[styles.container, { paddingTop: top, paddingBottom: bottom }]}>
      <View style={styles.callerInfo}>
        <View style={styles.avatarWrap}>
          {remote?.avatar ? (
            <Image source={{ uri: remote.avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>{remote?.fullName?.charAt(0) || 'R'}</Text>
            </View>
          )}
        </View>
        <Text style={styles.name}>{remote?.fullName || 'Unknown'}</Text>
        <Text style={styles.status}>{statusText}</Text>
      </View>

      {state === 'incoming' && (
        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.decline]} onPress={rejectCall}>
            <Feather name="phone-off" size={28} color={C.destructiveForeground} />
          </Pressable>
          <Pressable style={[styles.btn, styles.accept]} onPress={acceptCall}>
            <Feather name="phone" size={28} color={C.primaryForeground} />
          </Pressable>
        </View>
      )}

      {state === 'outgoing' && (
        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.decline]} onPress={endCall}>
            <Feather name="phone-off" size={28} color={C.destructiveForeground} />
          </Pressable>
          <ActivityIndicator color={C.primary} style={{ marginLeft: 16 }} />
        </View>
      )}

      {(state === 'connected' || state === 'busy' || state === 'unavailable') && (
        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.secondary, isMuted && styles.activeSecondary]}
            onPress={toggleMute}
          >
            <Feather name={isMuted ? 'mic-off' : 'mic'} size={24} color={C.text} />
          </Pressable>

          <Pressable style={[styles.btn, styles.decline]} onPress={endCall}>
            <Feather name="phone-off" size={28} color={C.destructiveForeground} />
          </Pressable>

          <Pressable
            style={[styles.btn, styles.secondary, isSpeaker && styles.activeSecondary]}
            onPress={toggleSpeaker}
          >
            <Feather name="volume-2" size={24} color={C.text} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  callerInfo: {
    alignItems: 'center',
    marginTop: 80,
  },
  avatarWrap: {
    marginBottom: 20,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 48,
    color: C.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  name: {
    fontSize: 26,
    color: C.text,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 8,
  },
  status: {
    fontSize: 16,
    color: C.textSecondary,
    fontFamily: 'Inter_400Regular',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 60,
  },
  btn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.surface,
  },
  accept: {
    backgroundColor: C.success,
  },
  decline: {
    backgroundColor: C.destructive,
  },
  secondary: {
    backgroundColor: C.surfaceElevated,
  },
  activeSecondary: {
    backgroundColor: C.inputFocused,
  },
});
