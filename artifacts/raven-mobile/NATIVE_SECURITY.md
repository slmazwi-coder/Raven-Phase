# Raven Phase 3 — Native Security Modules

This document describes the native security layer added in Phase 3. A parallel
agent is working on the app-side copy/forward block, watermarking, and admin
controls on `phase-3-app`; this branch (`phase-3-native`) only contains the
items below.

## What is implemented

| Feature                              | Platform | Native technique                                                                                 | JS surface                                    |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Block screenshots & screen recording | Android  | `WindowManager.LayoutParams.FLAG_SECURE` in `MainActivity.onCreate` (Expo config plugin)         | none — applied at OS window level             |
| Screenshot detection                 | iOS      | `UIApplication.userDidTakeScreenshotNotification`                                                | `RavenSecurityModule.onScreenshotTaken`       |
| Screen recording detection + blur    | iOS      | `UIScreen.capturedDidChangeNotification` + `UIVisualEffectView` blur overlay over the key window | `RavenSecurityModule.onRecordingStateChanged` |
| Device attestation                   | iOS      | `DeviceCheck.DCAppAttestService`                                                                 | `RavenSecurityModule.getAttestationToken()`   |
| Device attestation                   | Android  | Google Play Integrity API                                                                        | `RavenSecurityModule.getAttestationToken()`   |

## JS interface

All features are exposed through a single native module:

```ts
import { RavenSecurityModule } from "raven-security";

// iOS only: screenshot detection
RavenSecurityModule.onScreenshotTaken((event) => {
  console.log("Screenshot taken at", event.timestamp);
  // parallel team will POST /incidents/report
});

// iOS only: screen recording detection + native blur
RavenSecurityModule.onRecordingStateChanged((event) => {
  console.log("Recording:", event.recording, event.timestamp);
});

// Both platforms: request an attestation token
const tokenJson = await RavenSecurityModule.getAttestationToken();
const token = JSON.parse(tokenJson);
```

### `getAttestationToken()` return shape

The function returns a **JSON string** that the caller should parse and attach
to API requests (for example as `X-Attestation-Token`).

**iOS**

```json
{
  "platform": "ios",
  "keyId": "...",
  "attestationBase64": "...",
  "challenge": "raven-challenge-<uuid>",
  "challengeHash": "<hex sha256 of challenge>"
}
```

The backend should verify the `attestationBase64` blob with Apple's
`/devicecheck/attest_device` endpoint using the `challengeHash` as the
`clientDataHash`.

**Android**

```json
{
  "platform": "android",
  "token": "<Play Integrity token>",
  "nonce": "<base64 nonce>"
}
```

The backend should send this token to the Play Integrity server for
verification.

## Project layout

```
artifacts/raven-mobile/
├── plugins/
│   └── withRavenSecurity.js      # Expo config plugin
├── modules/
│   └── raven-security/
│       ├── expo-module.config.json
│       ├── package.json
│       ├── index.ts                # Typed JS interface
│       ├── ios/
│       │   └── RavenSecurityModule.swift
│       └── android/
│           ├── build.gradle        # Play Integrity dependency
│           └── src/main/java/expo/modules/ravensecurity/
│               └── RavenSecurityModule.kt
└── app.json                        # references withRavenSecurity.js
```

## Expo config plugin

`plugins/withRavenSecurity.js` is the only Expo config plugin used for Phase 3.
It does two things during `expo prebuild`:

1. **Android `FLAG_SECURE`** — injects `window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)`
   into `MainActivity.onCreate`, immediately after `super.onCreate(null)`. This
   blocks screenshots and screen recordings at the OS window level.
2. **Android Play Integrity metadata** — adds
   `<meta-data android:name="com.raven.security.CLOUD_PROJECT_NUMBER" android:value="..."/>`
   to `AndroidManifest.xml`.

The cloud project number is read from `RAVEN_ANDROID_CLOUD_PROJECT_NUMBER` at
prebuild time. If it is not set, the metadata tag is omitted and Android
attestation will fail at runtime with a clear error until the environment
variable is provided.

## Build / EAS notes

- The local module `raven-security` is referenced from the mobile package as
  `file:./modules/raven-security` and will be linked automatically by Expo's
  autolinking.
- Play Integrity requires a Google Cloud project linked to the Play Console app.
  Set `RAVEN_ANDROID_CLOUD_PROJECT_NUMBER` in your EAS environment before
  building.
- iOS App Attest requires an Apple Developer account and the App Attest
  entitlement. It is supported on physical devices and recent simulators, but
  real device attestation is only meaningful on physical hardware.
- No manual native project edits are required. Running `expo prebuild` or an EAS
  build regenerates the native directories from the config plugin and local
  module.

## iOS limitation

iOS does **not** expose any public API to prevent screenshots or screen
recordings at the app layer. This implementation detects them and (for
recording) obscures content with a native blur overlay as quickly as possible.
Any claim that an app can block iOS screenshots at the native layer is
incorrect; this branch follows Apple's documented capabilities.
