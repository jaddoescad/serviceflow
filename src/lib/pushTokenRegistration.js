import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

function getExpoProjectId() {
  return (
    Constants.easConfig?.projectId ||
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.expoConfig?.extra?.expoProjectId ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    null
  );
}

async function configureAndroidNotificationChannel() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#2F8D7F",
  });
}

export async function registerPushToken(user) {
  if (Platform.OS === "web" || !user?.id) return { token: null, error: null };

  try {
    await configureAndroidNotificationChannel();

    const existingPermission = await Notifications.getPermissionsAsync();
    const permission = existingPermission.granted
      ? existingPermission
      : await Notifications.requestPermissionsAsync();
    if (!permission.granted) return { token: null, error: null, permission };

    const projectId = getExpoProjectId();
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const expoPushToken = tokenResponse?.data;
    if (!expoPushToken) return { token: null, error: null };

    let devicePushToken = null;
    try {
      devicePushToken = (await Notifications.getDevicePushTokenAsync())?.data || null;
    } catch (_error) {
      devicePushToken = null;
    }

    const { error } = await supabase
      .from("employee_push_tokens")
      .upsert(
        {
          user_id: user.id,
          expo_push_token: expoPushToken,
          platform: Platform.OS,
          device_push_token: devicePushToken,
          app_version: Constants.expoConfig?.version || null,
          is_active: true,
          last_registered_at: new Date().toISOString(),
        },
        { onConflict: "user_id,expo_push_token" },
      );

    return { token: expoPushToken, error };
  } catch (error) {
    return { token: null, error };
  }
}
