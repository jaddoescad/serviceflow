// Google Maps keys are injected into the native build at prebuild time (never
// bundled into the JS). Set GOOGLE_MAPS_API_KEY for a single shared key, or the
// per-platform vars to use restricted keys. Without them the Google map renders
// blank, so both platforms need a key once we switch to PROVIDER_GOOGLE.
const googleMapsApiKeyIos = process.env.GOOGLE_MAPS_API_KEY_IOS || process.env.GOOGLE_MAPS_API_KEY;
const googleMapsApiKeyAndroid = process.env.GOOGLE_MAPS_API_KEY_ANDROID || process.env.GOOGLE_MAPS_API_KEY;
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "93638a9a-d605-4fee-800e-6449ca444429";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const locationTrackingEnabled = process.env.EXPO_PUBLIC_LOCATION_TRACKING_ENABLED !== "0";
const projectMediaApiUrl = (process.env.EXPO_PUBLIC_PROJECT_MEDIA_API_URL || "").replace(/\/+$/, "");
const cameraPermissionText =
  "ServiceFlow uses the camera to take job-site photos and videos for project records.";
const microphonePermissionText =
  "ServiceFlow uses the microphone to record audio when you capture job-site videos.";
const photoLibraryPermissionText =
  "ServiceFlow accesses your photo library so you can attach existing photos and videos to a project.";
const locationTrackingPilotEmails = (process.env.EXPO_PUBLIC_LOCATION_TRACKING_PILOT_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

module.exports = {
  expo: {
    name: "ServiceFlow",
    slug: "serviceflow",
    version: "1.4.0",
    orientation: "portrait",
    icon: "./assets/serviceflow-icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    splash: {
      image: "./assets/serviceflow-splash.png",
      resizeMode: "contain",
      backgroundColor: "#FFFFFF"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.ottawapainters.app",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["location", "fetch"],
        NSLocationWhenInUseUsageDescription:
          "ServiceFlow uses your location during an active shift to confirm job-site and travel time.",
        NSCameraUsageDescription: cameraPermissionText,
        NSMicrophoneUsageDescription: microphonePermissionText,
        NSPhotoLibraryUsageDescription: photoLibraryPermissionText
      }
    },
    android: {
      package: "com.ottawapainters.app",
      versionCode: 27,
      googleServicesFile: "./android/app/google-services.json",
      adaptiveIcon: {
        foregroundImage: "./assets/serviceflow-adaptive-icon.png",
        backgroundColor: "#FFFFFF"
      },
      config: googleMapsApiKeyAndroid
        ? {
            googleMaps: {
              apiKey: googleMapsApiKeyAndroid
            }
          }
        : undefined,
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "CAMERA",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "POST_NOTIFICATIONS",
        "RECORD_AUDIO"
      ]
    },
    // Bare native projects require a literal OTA runtime version. Increment
    // this whenever a release changes native code or native dependencies.
    runtimeVersion: "1.4.0",
    updates: {
      url: `https://u.expo.dev/${easProjectId}`,
      fallbackToCacheTimeout: 0
    },
    assetBundlePatterns: ["**/*"],
    plugins: [
      "expo-asset",
      "expo-font",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          locationWhenInUsePermission:
            "ServiceFlow uses your location during an active shift to confirm job-site and travel time.",
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: true
        }
      ],
      "expo-task-manager",
      "expo-notifications",
      [
        "expo-image-picker",
        {
          cameraPermission: cameraPermissionText,
          microphonePermission: microphonePermissionText,
          photosPermission: photoLibraryPermissionText
        }
      ],
      "expo-video"
    ],
    extra: {
      appTitle: "ServiceFlow",
      supabaseUrl,
      supabasePublishableKey,
      projectMediaApiUrl,
      locationTrackingEnabled,
      locationTrackingPilotEmails,
      expoProjectId: easProjectId,
      eas: easProjectId
        ? {
            projectId: easProjectId
          }
        : undefined
    }
  }
}
