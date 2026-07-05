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

module.exports = {
  expo: {
    name: "ServiceFlow",
    slug: "serviceflow",
    version: "1.0.6",
    orientation: "portrait",
    icon: "./assets/serviceflow-icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: false,
    splash: {
      image: "./assets/serviceflow-splash.png",
      resizeMode: "contain",
      backgroundColor: "#FFFFFF"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.ottawapainters.app",
      buildNumber: "5",
      config: googleMapsApiKeyIos
        ? {
            googleMapsApiKey: googleMapsApiKeyIos
          }
        : undefined,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["location", "fetch"],
        NSLocationWhenInUseUsageDescription:
          "ServiceFlow uses your location while you are clocked in to confirm job-site time.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "ServiceFlow uses background location to track job-site and travel time while you are clocked in, and to remind you to clock in when you arrive at a job site.",
        NSLocationAlwaysUsageDescription:
          "ServiceFlow uses background location to track job-site and travel time while you are clocked in, and to remind you to clock in when you arrive at a job site."
      }
    },
    android: {
      package: "com.ottawapainters.app",
      versionCode: 7,
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
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "POST_NOTIFICATIONS"
      ]
    },
    updates: {
      fallbackToCacheTimeout: 0
    },
    assetBundlePatterns: ["**/*"],
    plugins: [
      "expo-asset",
      "expo-font",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "ServiceFlow uses your location to track job-site and travel time while you are clocked in, and to remind you to clock in when you arrive at a job site.",
          locationWhenInUsePermission:
            "ServiceFlow uses your location while you are clocked in to confirm job-site time.",
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true
        }
      ],
      "expo-task-manager",
      "expo-notifications"
    ],
    extra: {
      appTitle: "ServiceFlow",
      supabaseUrl,
      supabasePublishableKey,
      expoProjectId: easProjectId,
      eas: easProjectId
        ? {
            projectId: easProjectId
          }
        : undefined
    }
  }
}
