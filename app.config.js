module.exports = {
  expo: {
    name: "Ottawa Painters",
    slug: "ottawa-painters-app",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    newArchEnabled: false,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.ottawapainters.app",
      infoPlist: {
        UIBackgroundModes: ["location", "fetch"],
        NSLocationWhenInUseUsageDescription:
          "Ottawa Painters uses your location while you are clocked in to confirm job-site time.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "Ottawa Painters uses background location while you are clocked in to track job-site and travel time.",
        NSLocationAlwaysUsageDescription:
          "Ottawa Painters uses background location while you are clocked in to track job-site and travel time."
      }
    },
    android: {
      package: "com.ottawapainters.app",
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
            "Ottawa Painters uses your location while you are clocked in to track job-site and travel time.",
          locationWhenInUsePermission:
            "Ottawa Painters uses your location while you are clocked in to confirm job-site time.",
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true
        }
      ],
      "expo-task-manager",
      "expo-notifications"
    ],
    extra: {
      appTitle: "Ottawa Painters"
    }
  }
}
