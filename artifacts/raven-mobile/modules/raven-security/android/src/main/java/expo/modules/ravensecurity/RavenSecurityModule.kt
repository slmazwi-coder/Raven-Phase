package expo.modules.ravensecurity

import android.content.pm.PackageManager
import android.util.Base64
import com.google.android.gms.tasks.Tasks
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.security.SecureRandom

private const val CLOUD_PROJECT_NUMBER_META = "com.raven.security.CLOUD_PROJECT_NUMBER"

class RavenSecurityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RavenSecurityModule")

    // iOS emits these; Android defines them for interface parity but does not
    // emit screenshot/recording events because FLAG_SECURE blocks them at the OS layer.
    Events("onScreenshotTaken", "onRecordingStateChanged")

    AsyncFunction("getAttestationToken") { promise: Promise ->
      getAttestationToken(promise)
    }
  }

  private fun getAttestationToken(promise: Promise) {
    try {
      val context = appContext.reactContext
        ?: throw CodedException("APP_CONTEXT_NOT_FOUND", "React context is not available", null)

      val applicationInfo = context.packageManager.getApplicationInfo(
        context.packageName,
        PackageManager.GET_META_DATA
      )
      val cloudProjectNumber = applicationInfo.metaData?.getString(CLOUD_PROJECT_NUMBER_META)
        ?: throw CodedException(
          "CLOUD_PROJECT_NUMBER_MISSING",
          "com.raven.security.CLOUD_PROJECT_NUMBER is not set in the AndroidManifest. " +
            "Set it via the withRavenSecurity config plugin or EAS env RAVEN_ANDROID_CLOUD_PROJECT_NUMBER.",
          null
        )

      val nonce = generateNonce()
      val integrityManager = IntegrityManagerFactory.create(context)
      val request = IntegrityTokenRequest.builder()
        .setNonce(nonce)
        .setCloudProjectNumber(cloudProjectNumber.toLong())
        .build()

      val response = Tasks.await(integrityManager.requestIntegrityToken(request))
      val token = response?.token()
        ?: throw CodedException("INTEGRITY_TOKEN_NULL", "Play Integrity returned a null token response.", null)

      val payload = JSONObject().apply {
        put("platform", "android")
        put("token", token)
        put("nonce", nonce)
      }
      promise.resolve(payload.toString())
    } catch (error: Throwable) {
      val code = if (error is CodedException) error.code else "ATTESTATION_ERROR"
      promise.reject(code, error.localizedMessage ?: error.toString(), error)
    }
  }

  private fun generateNonce(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP)
  }
}
