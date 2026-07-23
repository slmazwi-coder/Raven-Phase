import ExpoModulesCore
import UIKit
import DeviceCheck
import CryptoKit

public class RavenSecurityModule: Module {
  // Tag used to identify and remove the blur overlay added during screen recording.
  private let blurOverlayTag = 0x52617665 // "Rave" in hex

  public func definition() -> ModuleDefinition {
    Name("RavenSecurityModule")

    Events("onScreenshotTaken", "onRecordingStateChanged")

    OnCreate {
      self.setupScreenshotObserver()
      self.setupRecordingObserver()
    }

    AsyncFunction("getAttestationToken") {
      return try await self.getAttestationToken()
    }
  }

  // MARK: - Screenshot detection

  private func setupScreenshotObserver() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(self.handleScreenshot),
      name: UIApplication.userDidTakeScreenshotNotification,
      object: nil
    )
  }

  @objc
  private func handleScreenshot() {
    let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
    sendEvent("onScreenshotTaken", ["timestamp": timestamp])
  }

  // MARK: - Screen recording detection + blur

  private func setupRecordingObserver() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(self.handleRecordingStateChange),
      name: UIScreen.capturedDidChangeNotification,
      object: nil
    )
    // Check initial state immediately in case recording is already active.
    handleRecordingStateChange()
  }

  @objc
  private func handleRecordingStateChange() {
    let isCaptured = UIScreen.main.isCaptured
    let timestamp = Int64(Date().timeIntervalSince1970 * 1000)

    DispatchQueue.main.async {
      if isCaptured {
        self.addBlurOverlay()
      } else {
        self.removeBlurOverlay()
      }
    }

    sendEvent("onRecordingStateChanged", [
      "recording": isCaptured,
      "timestamp": timestamp
    ])
  }

  private func addBlurOverlay() {
    guard let window = self.keyWindow() else { return }

    // Remove any existing overlay first to avoid duplicates.
    removeBlurOverlay()

    let blurEffect = UIBlurEffect(style: .regular)
    let blurView = UIVisualEffectView(effect: blurEffect)
    blurView.frame = window.bounds
    blurView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    blurView.tag = blurOverlayTag
    blurView.accessibilityIdentifier = "RavenRecordingBlurOverlay"

    window.addSubview(blurView)
  }

  private func removeBlurOverlay() {
    guard let window = self.keyWindow() else { return }
    window.viewWithTag(blurOverlayTag)?.removeFromSuperview()
  }

  private func keyWindow() -> UIWindow? {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  // MARK: - Device attestation (App Attest)

  private func getAttestationToken() async throws -> String {
    let service = DCAppAttestService.shared()

    guard service.isSupported else {
      throw Exception(
        name: "AppAttestUnsupported",
        description: "DeviceCheck App Attest is not supported on this device."
      )
    }

    // Generate a fresh attestation key. In production the backend should
    // persist and reuse the keyId after the first successful attestation.
    let keyId = try await service.generateKey()

    let challenge = "raven-challenge-\(UUID().uuidString)"
    let challengeData = Data(challenge.utf8)
    let challengeHash = SHA256.hash(data: challengeData)
    let challengeHashData = Data(challengeHash)

    let attestation = try await service.attestKey(keyId, clientDataHash: challengeHashData)

    let payload: [String: Any] = [
      "platform": "ios",
      "keyId": keyId,
      "attestationBase64": attestation.base64EncodedString(),
      "challenge": challenge,
      "challengeHash": challengeHashData.map { String(format: "%02x", $0) }.joined()
    ]

    let jsonData = try JSONSerialization.data(withJSONObject: payload, options: [])
    guard let jsonString = String(data: jsonData, encoding: .utf8) else {
      throw Exception(
        name: "AttestationSerializationError",
        description: "Failed to serialize attestation payload."
      )
    }

    return jsonString
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }
}
