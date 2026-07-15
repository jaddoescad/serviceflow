import Constants from "expo-constants";

export function isLocationTrackingFeatureEnabled() {
  return Constants.expoConfig?.extra?.locationTrackingEnabled !== false;
}

export function isLocationTrackingEnabledForUser(userOrEmail) {
  if (!isLocationTrackingFeatureEnabled()) return false;
  const pilotEmails = Array.isArray(Constants.expoConfig?.extra?.locationTrackingPilotEmails)
    ? Constants.expoConfig.extra.locationTrackingPilotEmails
    : [];
  if (!pilotEmails.length) return true;
  const email = String(userOrEmail?.email || userOrEmail?.userEmail || userOrEmail || "").trim().toLowerCase();
  return Boolean(email && pilotEmails.includes(email));
}
