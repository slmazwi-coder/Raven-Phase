/**
 * Raven brand theme — always dark.
 * Source of truth for all colors used across the app.
 * Use via the useColors() hook: const colors = useColors()
 */

const whatsappTheme = {
  // Surfaces (WhatsApp dark mode)
  background: '#0B141A',
  surface: '#1F2C34',
  surfaceElevated: '#2A3942',
  tabBar: '#0B141A',

  // Brand accents (WhatsApp green)
  primary: '#25D366',
  primaryForeground: '#111B21',
  primaryPressed: '#1DA851',
  accent: '#EF553C', // destructive / alerts

  // Text
  text: '#E9EDEF',
  textSecondary: 'rgba(233, 237, 239, 0.65)',
  textTertiary: 'rgba(233, 237, 239, 0.4)',

  // Borders & dividers
  border: 'rgba(134, 150, 160, 0.15)',
  borderStrong: 'rgba(134, 150, 160, 0.25)',

  // Inputs
  input: '#2A3942',
  inputFocused: '#33535E',

  // Chat bubbles
  bubbleSent: '#005C4B',
  bubbleSentText: '#E9EDEF',
  bubbleReceived: '#1F2C34',
  bubbleReceivedText: '#E9EDEF',

  // Status
  success: '#25D366',
  destructive: '#EF553C',
  destructiveForeground: '#FFFFFF',

  // Compatibility aliases for useColors() hook
  tint: '#25D366',
  foreground: '#E9EDEF',
  card: '#1F2C34',
  cardForeground: '#E9EDEF',
  muted: '#1F2C34',
  mutedForeground: 'rgba(233, 237, 239, 0.65)',
  secondary: '#2A3942',
  secondaryForeground: '#E9EDEF',

  radius: 12,
};

const colors = {
  light: whatsappTheme,
  dark: whatsappTheme,
  radius: whatsappTheme.radius,
};

export default colors;
