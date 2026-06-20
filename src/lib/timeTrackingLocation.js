import * as Location from "expo-location";
import { distanceMeters, formatDistance, normalizeProject } from "./trackingModel";
import { readGeocodeCache, writeGeocodeCache } from "./timeTrackingStorage";

const SITE_RADIUS_METERS = 150;
const CLOCK_OUT_PROMPT_METERS = 300;
const JOB_SUGGESTION_METERS = 175;

export function toPoint(location) {
  const coords = location?.coords || location;
  const latitude = Number(coords?.latitude);
  const longitude = Number(coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    accuracy: Number(coords.accuracy || 0) || null,
    capturedAt: new Date(location?.timestamp || Date.now()).toISOString(),
  };
}

function projectPoint(project) {
  const normalized = normalizeProject(project);
  if (!normalized || normalized.latitude == null || normalized.longitude == null) return null;
  return { latitude: normalized.latitude, longitude: normalized.longitude };
}

export async function geocodeProject(project) {
  const normalized = normalizeProject(project);
  if (!normalized || normalized.latitude != null || normalized.longitude != null) return normalized;

  const address = normalized.formatted_address || normalized.address;
  if (!address) return normalized;

  const cacheKey = normalized.companycam_id || address;
  const cache = await readGeocodeCache();
  const cached = cache[cacheKey];
  if (cached?.latitude != null && cached?.longitude != null) {
    return { ...normalized, latitude: cached.latitude, longitude: cached.longitude };
  }

  try {
    const matches = await Location.geocodeAsync(address);
    const first = matches?.[0];
    if (!first || first.latitude == null || first.longitude == null) return normalized;

    const resolved = { ...normalized, latitude: first.latitude, longitude: first.longitude };
    await writeGeocodeCache({
      ...cache,
      [cacheKey]: { latitude: first.latitude, longitude: first.longitude, address, resolvedAt: new Date().toISOString() },
    });
    return resolved;
  } catch (_error) {
    return normalized;
  }
}

export async function geocodeProjects(projects, limit = 80) {
  const output = [];
  let resolvedCount = 0;

  for (const project of projects || []) {
    const normalized = normalizeProject(project);
    if (!normalized) continue;

    if (normalized.latitude == null && normalized.longitude == null && resolvedCount < limit) {
      output.push(await geocodeProject(normalized));
      resolvedCount += 1;
    } else {
      output.push(normalized);
    }
  }

  return output;
}

export function createLocationStatus(shift, projects, point) {
  const activeDistance = distanceMeters(point, projectPoint(shift.project));
  const onSite = activeDistance == null ? null : activeDistance <= SITE_RADIUS_METERS;
  let nearestProject = null;
  let nearestDistance = null;

  for (const rawProject of projects || []) {
    const project = normalizeProject(rawProject);
    const coords = projectPoint(project);
    if (!project || !coords) continue;
    const distance = distanceMeters(point, coords);
    if (distance == null) continue;
    if (nearestDistance == null || distance < nearestDistance) {
      nearestProject = project;
      nearestDistance = distance;
    }
  }

  const suggestedProject =
    nearestProject &&
    nearestProject.companycam_id !== shift.project.companycam_id &&
    nearestDistance != null &&
    nearestDistance <= JOB_SUGGESTION_METERS
      ? nearestProject
      : null;

  return {
    point,
    activeDistance,
    onSite,
    nearestProject,
    nearestDistance,
    suggestedProject,
    shouldPromptClockOut: activeDistance != null && activeDistance >= CLOCK_OUT_PROMPT_METERS,
    label:
      activeDistance == null
        ? "Location captured. Job-site distance unavailable."
        : onSite
          ? `On site, ${formatDistance(activeDistance)} from job.`
          : `Off site, ${formatDistance(activeDistance)} from job.`,
  };
}

export function appendSegment(shift, status) {
  const now = new Date().toISOString();
  const mode = status.onSite === false ? "off_site" : status.onSite === true ? "on_site" : "unknown";
  const segments = shift.segments || [];
  const last = segments[segments.length - 1];

  if (last?.mode === mode) {
    return {
      ...shift,
      segments: [
        ...segments.slice(0, -1),
        { ...last, endedAt: now, distanceMeters: status.activeDistance, location: status.point },
      ],
    };
  }

  return {
    ...shift,
    segments: [
      ...segments,
      { mode, startedAt: now, endedAt: now, distanceMeters: status.activeDistance, location: status.point },
    ],
  };
}
