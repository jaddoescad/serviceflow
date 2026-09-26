import * as Location from "expo-location";
import { Platform } from "react-native";
import { GEOFENCE_TASK } from "./timeTrackingConstants";
import { mergeTrackingRuntimeState } from "./timeTrackingStorage";

let retirementMutation = null;

// Older releases registered job-site geofences. The foreground-only permission
// model never creates new regions, but existing installations may still have
// registrations owned by the operating system until the app explicitly removes
// them once after upgrade.
export function retireLegacyGeofences() {
  if (Platform.OS === "web") return Promise.resolve();
  if (retirementMutation) return retirementMutation;

  retirementMutation = (async () => {
    try {
      const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
      if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    } catch (_error) {
      // Removing the native permission can make old registrations unreadable.
      // They cannot deliver events without authorization, so cleanup is best effort.
    }
    await mergeTrackingRuntimeState({ geofenceSignature: null });
  })();

  return retirementMutation;
}
