export function formatAddress(project) {
  if (!project) return "";
  if (project.formatted_address) return project.formatted_address;
  if (project.address) return project.address;
  return [project.street_address_1, project.street_address_2, project.city, project.state, project.postal_code]
    .filter(Boolean)
    .join(", ");
}

export function normalizeProject(project) {
  if (!project) return null;
  const id = String(project.companycam_id || project.companycam_project_id || project.projectId || project.id || "");
  if (!id) return null;

  let latitude = normalizeCoordinate(project.latitude, -90, 90);
  let longitude = normalizeCoordinate(project.longitude, -180, 180);
  // Missing database coordinates previously became Number(null) === 0, which
  // placed Ottawa jobs in the Gulf of Guinea and produced ~8,900 km distances.
  if (latitude === 0 && longitude === 0) {
    latitude = null;
    longitude = null;
  }
  const address = formatAddress(project);

  return {
    ...project,
    id,
    companycam_id: id,
    name: project.name || project.project_name || "Project",
    address,
    formatted_address: project.formatted_address || address,
    latitude,
    longitude,
  };
}

function normalizeCoordinate(value, minimum, maximum) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
    ? coordinate
    : null;
}

export function distanceMeters(a, b) {
  if (!a || !b) return null;
  const radius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export function formatDistance(meters) {
  if (meters == null || !Number.isFinite(meters)) return "distance unknown";
  if (meters < 1000) return `${Math.max(0, Math.round(meters))} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(ms) {
  const minutes = Math.max(0, Math.floor((ms || 0) / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
