/**
 * Raven brand theme — always dark.
 * Source of truth for all colors used across the app.
 * Use via the useColors() hook: const colors = useColors()
 */

const ravenTheme = {
  // Surfaces
  background: '#1A1A3C',
  surface: '#252550',
  surfaceElevated: '#2F2F60',
  tabBar: '#12122A',

  // Brand accents
  primary: '#F87920',        // orange — primary action / CTA
  primaryForeground: '#FFFFFF',
  primaryPressed: '#D96A1A',
  accent: '#EC5837',         // deep red-orange — alerts / warnings / destructive

  // Text
  text: '#F2F2F2',           // soft off-white on dark
  textSecondary: 'rgba(242, 242, 242, 0.6)',
  textTertiary: 'rgba(242, 242, 242, 0.35)',

  // Borders & dividers
  border: 'rgba(242, 242, 242, 0.1)',
  borderStrong: 'rgba(242, 242, 242, 0.2)',

  // Inputs
  input: 'rgba(242, 242, 242, 0.08)',
  inputFocused: 'rgba(248, 121, 32, 0.25)',

  // Chat bubbles
  bubbleSent: '#F87920',
  bubbleSentText: '#FFFFFF',
  bubbleReceived: '#2F2F60',
  bubbleReceivedText: '#F2F2F2',

  // Status
  success: '#4CAF50',
  destructive: '#EC5837',
  destructiveForeground: '#FFFFFF',

  // Compatibility aliases for useColors() hook
  tint: '#F87920',
  foreground: '#F2F2F2',
  card: '#252550',
  cardForeground: '#F2F2F2',
  muted: '#252550',
  mutedForeground: 'rgba(242, 242, 242, 0.6)',
  secondary: '#2F2F60',
  secondaryForeground: '#F2F2F2',

  radius: 12,
};

const colors = {
  light: ravenTheme,
  dark: ravenTheme,
  radius: ravenTheme.radius,
};

export default colors;
