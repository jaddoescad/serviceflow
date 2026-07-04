export const GEOFENCE_TASK = "ottawa-painters-geofence";

// Geofencing is native-only; the web build ships these no-op stubs.
export async function syncGeofences() {
  return false;
}

export async function stopGeofences() {}
