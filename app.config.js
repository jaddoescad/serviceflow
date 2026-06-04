module.exports = {
  expo: {
    name: "Ottawa Painters",
    slug: "ottawa-painters-app",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.ottawapainters.app"
    },
    android: {
      package: "com.ottawapainters.app"
    },
    updates: {
      fallbackToCacheTimeout: 0
    },
    assetBundlePatterns: ["**/*"],
    plugins: ["expo-asset", "expo-font"],
    extra: {
      appTitle: "Ottawa Painters"
    }
  }
}
