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

function normalizeCellNumber(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return input.trim().startsWith('+') ? input.trim() : `+${digits}`;
}

export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [cellNumber, setCellNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;

  async function handleContinue() {
    const name = fullName.trim();
    const normalized = normalizeCellNumber(cellNumber);
    if (!name) {
      setError('Enter your full name.');
      return;
    }
    if (!normalized) {
      setError('Enter a valid phone number with country code (e.g. +15550000001).');
      return;
    }

    setError(null);
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    router.push({
      pathname: '/(auth)/otp',
      params: { fullName: name, cellNumber: normalized },
    });
    setLoading(false);
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
        Enter your name and phone number to get started.
      </Text>

      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        placeholder="Full name"
        placeholderTextColor={colors.light.textTertiary}
        value={fullName}
        onChangeText={(t) => {
          setFullName(t);
          if (error) setError(null);
        }}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="next"
        multiline={false}
      />

      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        placeholder="Phone number (e.g. +15550000001)"
        placeholderTextColor={colors.light.textTertiary}
        value={cellNumber}
        onChangeText={(t) => {
          setCellNumber(t);
          if (error) setError(null);
        }}
        keyboardType="phone-pad"
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
