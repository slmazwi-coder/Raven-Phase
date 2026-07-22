import { requireNativeModule } from "expo-modules-core";
import type { EventSubscription } from "expo-modules-core";

export type { EventSubscription };

export interface ScreenshotEvent {
  timestamp: number;
}

export interface RecordingStateEvent {
  recording: boolean;
  timestamp: number;
}

export interface AttestationToken {
  token: string;
  nonce?: string;
  platform: "ios" | "android";
}

type RavenSecurityEvents = {
  onScreenshotTaken: (event: ScreenshotEvent) => void;
  onRecordingStateChanged: (event: RecordingStateEvent) => void;
};

interface RavenSecurityNativeModule {
  getAttestationToken(): Promise<string>;
  addListener<EventName extends keyof RavenSecurityEvents>(
    eventName: EventName,
    listener: RavenSecurityEvents[EventName],
  ): EventSubscription;
  removeAllListeners(eventName: keyof RavenSecurityEvents): void;
  removeListener<EventName extends keyof RavenSecurityEvents>(
    eventName: EventName,
    listener: RavenSecurityEvents[EventName],
  ): void;
}

const nativeModule = requireNativeModule<RavenSecurityNativeModule>(
  "RavenSecurityModule",
);

/**
 * Native security controls for Raven.
 *
 * - Android: screenshot/recording prevention is applied automatically by the
 *   FLAG_SECURE config plugin (`plugins/withRavenSecurity.js`). This module has
 *   no JS event surface on Android for those features.
 * - iOS: screenshot detection and screen-recording detection (with native blur
 *   overlay) are exposed as events. iOS provides no API to *prevent* capture;
 *   the app can only detect it and respond.
 */
export const RavenSecurityModule = {
  /**
   * Subscribe to iOS screenshot events.
   * Payload: `{ timestamp: number }` (ms since epoch).
   */
  onScreenshotTaken(
    listener: (event: ScreenshotEvent) => void,
  ): EventSubscription {
    return nativeModule.addListener("onScreenshotTaken", listener);
  },

  /**
   * Subscribe to iOS screen recording state changes.
   * Payload: `{ recording: boolean, timestamp: number }`.
   * When `recording` becomes `true` the native layer immediately blurs the
   * current window; the blur is removed when recording stops.
   */
  onRecordingStateChanged(
    listener: (event: RecordingStateEvent) => void,
  ): EventSubscription {
    return nativeModule.addListener("onRecordingStateChanged", listener);
  },

  /**
   * Request a device attestation token/assertion.
   *
   * iOS: uses DeviceCheck App Attest. Returns a JSON string containing
   * `attestationBase64`, `keyId`, `challenge`, and `challengeHash`.
   *
   * Android: uses Play Integrity API. Returns a JSON string containing
   * `token`, `nonce`, and `cloudProjectNumber`.
   *
   * The caller should forward the parsed object to the backend, typically as
   * an `X-Attestation-Token` header or in the request body.
   */
  getAttestationToken(): Promise<string> {
    return nativeModule.getAttestationToken();
  },
};

export default RavenSecurityModule;
