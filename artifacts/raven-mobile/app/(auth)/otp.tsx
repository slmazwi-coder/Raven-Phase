import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import colors from '@/constants/colors';
import { requestOtp, verifyOtp, registerDevice, ApiError } from '@/lib/api';
import { refreshAttestation } from '@/lib/attestation';
import { useAuth } from '@/context/AuthContext';

export default function OtpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { cellNumber, inviteToken } = useLocalSearchParams<{
    cellNumber: string;
    inviteToken: string;
  }>();
  const { login, getDeviceId } = useAuth();

  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;

  // Auto-request OTP on mount
  useEffect(() => {
    handleSendOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resend countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function handleSendOtp() {
    if (!cellNumber || sendingOtp) return;
    setSendingOtp(true);
    setError(null);
    setDevOtp(null);
    try {
      const res = await requestOtp(cellNumber);
      setOtpSent(true);
      setCountdown(60);
      if (res.dev_otp) {
        setOtp(res.dev_otp);
        setDevOtp(res.dev_otp);
        // Auto-verify in dev mode so the tester doesn't have to tap Verify
        setTimeout(() => handleVerify(res.dev_otp), 150);
      } else {
        setTimeout(() => inputRef.current?.focus(), 400);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Could not send OTP. Check your connection.');
      }
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleVerify(explicitCode?: string) {
    const code = (explicitCode ?? otp).trim();
    if (code.length !== 6) {
      setError('Enter the 6-digit code sent to your phone.');
      return;
    }
    if (!cellNumber) return;

    setError(null);
    setVerifying(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const res = await verifyOtp(cellNumber, code);

      // Register this device. Generate an attestation token first so the
      // backend can bind this device to an App Attest / Play Integrity assertion.
      const deviceId = await getDeviceId();
      const platform = Platform.OS === 'web' ? 'android' : Platform.OS; // fallback for web
      await refreshAttestation();
      await registerDevice(res.token, platform, deviceId);

      await login(res.token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // AuthGate in _layout.tsx will redirect to (tabs)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Verification failed. Please try again.');
      }
      setVerifying(false);
    }
  }

  // OTP digit boxes (visual only — real input is hidden below)
  function renderDigitBoxes() {
    return (
      <View style={styles.digitRow}>
        {Array.from({ length: 6 }).map((_, i) => {
          const char = otp[i] ?? '';
          const isFocused = otpSent && otp.length === i;
          return (
            <Pressable key={i} onPress={() => inputRef.current?.focus()}>
              <View
                style={[
                  styles.digitBox,
                  isFocused && styles.digitBoxFocused,
                  char ? styles.digitBoxFilled : null,
                ]}
              >
                <Text style={styles.digitText}>{char}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPadding + 32 }]}>
      {/* Back */}
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Verify your number</Text>
      <Text style={styles.subtitle}>
        We sent a 6-digit code to{'\n'}
        <Text style={styles.phone}>{cellNumber}</Text>
      </Text>

      {/* OTP input — visually hidden, drives digit boxes */}
      <TextInput
        ref={inputRef}
        value={otp}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6);
          setOtp(digits);
          if (error) setError(null);
          if (digits.length === 6) {
            // Auto-submit
            handleVerify();
          }
        }}
        keyboardType="number-pad"
        maxLength={6}
        style={styles.hiddenInput}
        caretHidden
        autoFocus={false}
      />

      {renderDigitBoxes()}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {devOtp ? (
        <View style={styles.devOtpBanner}>
          <Text style={styles.devOtpText}>
            Dev OTP: <Text style={styles.devOtpCode}>{devOtp}</Text>
          </Text>
        </View>
      ) : null}

      {/* Verify button */}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
          (verifying || otp.length !== 6) && styles.buttonDisabled,
        ]}
        onPress={() => handleVerify()}
        disabled={verifying || otp.length !== 6}
      >
        {verifying ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Verify</Text>
        )}
      </Pressable>

      {/* Resend */}
      <Pressable
        onPress={handleSendOtp}
        disabled={sendingOtp || countdown > 0}
        style={styles.resendBtn}
      >
        {sendingOtp ? (
          <ActivityIndicator color={C.primary} size="small" />
        ) : (
          <Text
            style={[
              styles.resendText,
              countdown > 0 && styles.resendTextDisabled,
            ]}
          >
            {countdown > 0
              ? `Resend code in ${countdown}s`
              : "Didn't get a code? Resend"}
          </Text>
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
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 32,
  },
  backText: {
    color: C.primary,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  title: {
    fontSize: 26,
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
  phone: {
    color: C.text,
    fontFamily: 'Inter_600SemiBold',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  digitRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  digitBox: {
    width: 46,
    height: 58,
    backgroundColor: C.input,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitBoxFocused: {
    borderColor: C.primary,
    backgroundColor: C.inputFocused,
  },
  digitBoxFilled: {
    borderColor: C.borderStrong,
  },
  digitText: {
    fontSize: 22,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  errorText: {
    color: C.accent,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
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
  buttonPressed: { backgroundColor: C.primaryPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: C.primaryForeground,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  resendBtn: {
    marginTop: 20,
    paddingVertical: 8,
  },
  resendText: {
    color: C.primary,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  resendTextDisabled: {
    color: C.textTertiary,
  },
  devOtpBanner: {
    backgroundColor: '#FFF3E0',
    borderRadius: C.radius,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  devOtpText: {
    color: '#E65100',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  devOtpCode: {
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
  },
});
