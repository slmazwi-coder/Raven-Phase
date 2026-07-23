const {
  withMainActivity,
  withAndroidManifest,
  createRunOncePlugin,
} = require("expo/config-plugins");

const FLAG_SECURE_IMPORT = "import android.view.WindowManager";
const FLAG_SECURE_LINE =
  "window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)";

const META_DATA_NAME = "com.raven.security.CLOUD_PROJECT_NUMBER";

function addFlagSecure(contents) {
  if (contents.includes(FLAG_SECURE_LINE)) {
    return contents;
  }

  // Insert the WindowManager import immediately after the package declaration.
  if (!contents.includes(FLAG_SECURE_IMPORT)) {
    const packageMatch = contents.match(/^package .*$/m);
    if (packageMatch) {
      const insertIndex =
        contents.indexOf(packageMatch[0]) + packageMatch[0].length;
      contents = `${contents.slice(0, insertIndex)}\n${FLAG_SECURE_IMPORT}${contents.slice(insertIndex)}`;
    } else {
      contents = `${FLAG_SECURE_IMPORT}\n${contents}`;
    }
  }

  const marker = "super.onCreate(null)";
  if (!contents.includes(marker)) {
    throw new Error(
      "[withRavenSecurity] Could not find `super.onCreate(null)` in MainActivity. FLAG_SECURE was not applied.",
    );
  }

  contents = contents.replace(
    marker,
    `${marker}\n    ${FLAG_SECURE_LINE} // Blocks screenshots & screen recording (Phase 3)`,
  );

  return contents;
}

function addCloudProjectNumberMetadata(androidManifest, cloudProjectNumber) {
  if (!cloudProjectNumber) return androidManifest;

  const application = androidManifest.manifest.application?.[0];
  if (!application) {
    throw new Error(
      "[withRavenSecurity] No <application> element found in AndroidManifest.",
    );
  }

  if (!application["meta-data"]) {
    application["meta-data"] = [];
  }

  const existing = application["meta-data"].find(
    (meta) => meta.$["android:name"] === META_DATA_NAME,
  );

  if (existing) {
    existing.$["android:value"] = String(cloudProjectNumber);
  } else {
    application["meta-data"].push({
      $: {
        "android:name": META_DATA_NAME,
        "android:value": String(cloudProjectNumber),
      },
    });
  }

  return androidManifest;
}

const withRavenSecurity = (config, props = {}) => {
  const cloudProjectNumber =
    props.cloudProjectNumber || process.env.RAVEN_ANDROID_CLOUD_PROJECT_NUMBER;
  // 1) Android: FLAG_SECURE in MainActivity to block screenshots/recording.
  config = withMainActivity(config, async (config) => {
    if (config.modResults?.contents == null) {
      throw new Error(
        "[withRavenSecurity] MainActivity contents are not available.",
      );
    }
    config.modResults.contents = addFlagSecure(config.modResults.contents);
    return config;
  });

  // 2) Android: inject Play Integrity cloud project number into manifest.
  if (cloudProjectNumber) {
    config = withAndroidManifest(config, async (config) => {
      config.modResults = addCloudProjectNumberMetadata(
        config.modResults,
        cloudProjectNumber,
      );
      return config;
    });
  }

  return config;
};

module.exports = createRunOncePlugin(
  withRavenSecurity,
  "withRavenSecurity",
  "1.0.0",
);
