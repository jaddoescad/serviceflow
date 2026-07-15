export const TRACKING_MODE = Object.freeze({
  CLOCKED_OUT: "clocked_out",
  PAINTING: "painting",
  STATIONARY: "stationary",
  TRAVEL: "travel",
  UNAVAILABLE: "unavailable",
  UNKNOWN: "unknown",
});

export const TRACKING_POLICY = Object.freeze({
  travelDistanceMeters: 100,
  travelMaximumGapMs: 3 * 60 * 1000,
  paintingDistanceMeters: 60,
  paintingMaximumGapMs: 15 * 60 * 1000,
  stationaryRadiusMeters: 70,
  stationaryAfterMs: 3 * 60 * 1000,
  routeGapMs: 15 * 60 * 1000,
  freshAfterMs: 5 * 60 * 1000,
  staleAfterMs: 15 * 60 * 1000,
  maximumAcceptedAccuracyMeters: 250,
});

export function pointDistanceMeters(a, b) {
  if (!a || !b) return null;
  const latA = Number(a.latitude);
  const lngA = Number(a.longitude);
  const latB = Number(b.latitude);
  const lngB = Number(b.longitude);
  if (![latA, lngA, latB, lngB].every(Number.isFinite)) return null;

  const radius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const firstLatitude = toRad(latA);
  const secondLatitude = toRad(latB);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(dLng / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export function modeForLocationStatus(status) {
  if (status?.onSite === true) return TRACKING_MODE.PAINTING;
  if (status?.onSite === false) return TRACKING_MODE.TRAVEL;
  return TRACKING_MODE.UNKNOWN;
}

export function shouldRecordLocation(previous, point, mode, eventType = "location") {
  if (!point) return false;
  if (eventType !== "location") return true;
  const accuracy = Number(point.accuracy);
  if (Number.isFinite(accuracy) && accuracy > TRACKING_POLICY.maximumAcceptedAccuracyMeters) {
    return false;
  }
  if (!previous) return true;

  const previousTime = new Date(previous.capturedAt || previous.captured_at || 0).getTime();
  const nextTime = new Date(point.capturedAt || point.captured_at || 0).getTime();
  const elapsed = Math.max(0, nextTime - previousTime);
  const distance = pointDistanceMeters(previous, point);
  const isLowPowerMode = mode === TRACKING_MODE.PAINTING || mode === TRACKING_MODE.STATIONARY;
  const minimumDistance = isLowPowerMode
    ? TRACKING_POLICY.paintingDistanceMeters
    : TRACKING_POLICY.travelDistanceMeters;
  const maximumGap = isLowPowerMode
    ? TRACKING_POLICY.paintingMaximumGapMs
    : TRACKING_POLICY.travelMaximumGapMs;

  return distance == null || distance >= minimumDistance || elapsed >= maximumGap;
}

export function updateStationaryState(state, point, mode) {
  if (!point || mode !== TRACKING_MODE.TRAVEL) {
    return { anchor: null, stationary: false };
  }

  const previousAnchor = state?.anchor;
  if (!previousAnchor) {
    return { anchor: point, stationary: false };
  }

  const distance = pointDistanceMeters(previousAnchor, point);
  if (distance == null || distance > TRACKING_POLICY.stationaryRadiusMeters) {
    return { anchor: point, stationary: false };
  }

  const anchorTime = new Date(previousAnchor.capturedAt || 0).getTime();
  const pointTime = new Date(point.capturedAt || 0).getTime();
  return {
    anchor: previousAnchor,
    stationary: pointTime - anchorTime >= TRACKING_POLICY.stationaryAfterMs,
  };
}

export function freshnessForTimestamp(value, now = Date.now()) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { level: "unavailable", ageMs: null, label: "No location received" };
  }

  const ageMs = Math.max(0, now - timestamp);
  if (ageMs <= TRACKING_POLICY.freshAfterMs) {
    return { level: "fresh", ageMs, label: "Recently updated" };
  }
  if (ageMs <= TRACKING_POLICY.staleAfterMs) {
    return { level: "aging", ageMs, label: "Location is getting stale" };
  }
  return { level: "stale", ageMs, label: "No recent updates" };
}

export function freshnessForTrackingStatus(status, now = Date.now()) {
  const freshness = freshnessForTimestamp(status?.last_location_at || status?.lastLocationAt, now);
  if (
    freshness.ageMs != null &&
    (status?.tracking_mode === TRACKING_MODE.PAINTING || status?.tracking_mode === TRACKING_MODE.STATIONARY) &&
    status?.task_status === "geofence"
  ) {
    return {
      ...freshness,
      level: "stationary",
      label: status.tracking_mode === TRACKING_MODE.PAINTING
        ? "Stationary at job"
        : "Stationary",
    };
  }
  if (status?.tracking_mode === TRACKING_MODE.CLOCKED_OUT) {
    return { ...freshness, level: "clocked_out", label: "Clocked out" };
  }
  return freshness;
}

export function splitRouteSegments(points, maximumGapMs = TRACKING_POLICY.routeGapMs) {
  const ordered = (points || [])
    .filter((point) => Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude)))
    .slice()
    .sort(
      (a, b) =>
        new Date(a.captured_at || a.capturedAt || 0).getTime() -
        new Date(b.captured_at || b.capturedAt || 0).getTime(),
    );

  const segments = [];
  for (const point of ordered) {
    const current = segments[segments.length - 1];
    const previous = current?.[current.length - 1];
    const previousTime = new Date(previous?.captured_at || previous?.capturedAt || 0).getTime();
    const pointTime = new Date(point.captured_at || point.capturedAt || 0).getTime();
    if (!current || !previous || pointTime - previousTime > maximumGapMs) {
      segments.push([point]);
    } else {
      current.push(point);
    }
  }
  return segments;
}

export function trackingEventId(shift, point, eventType = "location") {
  const entryId = shift?.localId || shift?.client_entry_id || "shift";
  const capturedAt = point?.capturedAt || point?.captured_at || new Date().toISOString();
  const latitude = Number(point?.latitude).toFixed(5);
  const longitude = Number(point?.longitude).toFixed(5);
  return `${entryId}:${capturedAt}:${latitude}:${longitude}:${eventType}`;
}
