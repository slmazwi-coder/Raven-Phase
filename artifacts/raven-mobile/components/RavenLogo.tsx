import React from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';
import colors from '@/constants/colors';

const C = colors.light;

const CRYPTIC = 'RΛVΣИ';

export function RavenLogo({ style, ...props }: TextProps) {
  return (
    <Text style={[styles.logo, style]} {...props}>
      {CRYPTIC}
    </Text>
  );
}

const styles = StyleSheet.create({
  logo: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    letterSpacing: 4,
    textTransform: 'none',
  },
});
