import { Platform } from 'react-native';

let cachedToken: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type ScreenshotEvent = { timestamp: number };
type RecordingStateEvent = { recording: boolean; timestamp: number };

async function loadSecurityModule() {
  if (Platform.OS === 'web') {
    throw new Error('RavenSecurityModule is not available on web');
  }
  const mod = await import('@workspace/raven-security');
  return mod.default ?? mod.RavenSecurityModule;
}

/** Returns the cached attestation token, or null if not yet generated. */
export function getAttestationHeader(): string | null {
  if (Date.now() - cachedAt > CACHE_TTL_MS) {
    // Lazy refresh on next request; callers can await refreshAttestation().
    cachedToken = null;
  }
  return cachedToken;
}

/** Generates a fresh attestation token and caches it. */
export async function refreshAttestation(): Promise<string | null> {
  if (process.env.RAVEN_SKIP_ATTESTATION === 'true') {
    return null;
  }
  try {
    const RavenSecurityModule = await loadSecurityModule();
    if (!RavenSecurityModule?.getAttestationToken) {
      throw new Error('RavenSecurityModule missing getAttestationToken');
    }
    const token = await RavenSecurityModule.getAttestationToken();
    cachedToken = token;
    cachedAt = Date.now();
    return token;
  } catch (err) {
    // Don't crash the app if attestation fails (jailbroken/rooted devices, simulators, web).
    console.warn('[attestation] Failed to generate attestation token:', err);
    cachedToken = null;
    cachedAt = 0;
    return null;
  }
}

/** Subscribe to native security events. Returns remove functions. */
export async function subscribeToSecurityEvents(
  onScreenshot: (event: ScreenshotEvent) => void,
  onRecordingStateChanged: (event: RecordingStateEvent) => void,
): Promise<() => void> {
  const RavenSecurityModule = await loadSecurityModule();
  const screenshotSub = RavenSecurityModule.onScreenshotTaken(onScreenshot);
  const recordingSub = RavenSecurityModule.onRecordingStateChanged(onRecordingStateChanged);

  return () => {
    screenshotSub?.remove?.();
    recordingSub?.remove?.();
  };
}

export type { ScreenshotEvent, RecordingStateEvent };
