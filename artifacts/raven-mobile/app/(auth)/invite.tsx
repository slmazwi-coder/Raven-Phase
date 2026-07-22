import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import colors from '@/constants/colors';
import { verifyInvite, ApiError } from '@/lib/api';

export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;

  async function handleContinue() {
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Paste your invite link or token to continue.');
      return;
    }

    // Accept full URLs or bare tokens
    let inviteToken = trimmed;
    try {
      const parsed = new URL(trimmed);
      inviteToken = parsed.searchParams.get('token') ?? trimmed;
    } catch {
      // Not a URL — treat as raw token
    }

    setError(null);
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const res = await verifyInvite(inviteToken);
      if (!res.valid) {
        setError('This invite is invalid or has expired.');
        return;
      }
      router.push({
        pathname: '/(auth)/otp',
        params: { cellNumber: res.cellNumber, inviteToken },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Could not verify invite. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: topPadding + 32 }]}>
      {/* Logo */}
      <Image
        source={require('@/assets/images/icon.png')}
        style={styles.logo}
        resizeMode="contain"
      />

      <Text style={styles.title}>Join Raven</Text>
      <Text style={styles.subtitle}>
        Paste your invite link or token below to get started.
      </Text>

      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        placeholder="Invite token or link…"
        placeholderTextColor={colors.light.textTertiary}
        value={token}
        onChangeText={(t) => {
          setToken(t);
          if (error) setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={handleContinue}
        multiline={false}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
          loading && styles.buttonDisabled,
        ]}
        onPress={handleContinue}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </Pressable>
    </View>
  );
}

const C = colors.light;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 22,
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
    textAlign: 'center',
    marginBottom: 36,
    lineHeight: 22,
  },
  input: {
    width: '100%',
    height: 52,
    backgroundColor: C.input,
    borderRadius: C.radius,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  inputError: {
    borderColor: C.accent,
  },
  errorText: {
    color: C.accent,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    height: 52,
    backgroundColor: C.primary,
    borderRadius: C.radius,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonPressed: {
    backgroundColor: C.primaryPressed,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: C.primaryForeground,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
