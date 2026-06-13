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

  const latitude = Number(project.latitude);
  const longitude = Number(project.longitude);
  const address = formatAddress(project);

  return {
    ...project,
    id,
    companycam_id: id,
    name: project.name || project.project_name || "Project",
    address,
    formatted_address: project.formatted_address || address,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
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
