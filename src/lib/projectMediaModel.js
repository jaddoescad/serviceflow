export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];

const EXTENSION_MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
};

const MAX_FILENAME_LENGTH = 120;

export function normalizeProjectMediaApiUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

export function normalizeProjectMediaKind(value) {
  return String(value || "").trim().toLowerCase() === "lead" ? "lead" : "job";
}

export function buildProjectMediaUploadPath(projectId, projectKind = "job") {
  const ownerId = String(projectId || "").trim();
  if (!ownerId) return "";
  const collection = normalizeProjectMediaKind(projectKind) === "lead" ? "leads" : "jobs";
  return `/v1/${collection}/${encodeURIComponent(ownerId)}/media`;
}

export function resolveMediaKind(mimeType) {
  const normalized = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (IMAGE_MIME_TYPES.includes(normalized)) return "image";
  if (VIDEO_MIME_TYPES.includes(normalized)) return "video";
  return null;
}

export function inferAssetMimeType(asset) {
  const declared = String(asset?.mimeType || "").toLowerCase().split(";")[0].trim();
  if (resolveMediaKind(declared)) return declared;

  const source = String(asset?.fileName || asset?.uri || "");
  const match = source.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  const byExtension = match ? EXTENSION_MIME_TYPES[match[1].toLowerCase()] : null;
  if (byExtension) return byExtension;

  if (asset?.type === "image") return "image/jpeg";
  if (asset?.type === "video") return "video/mp4";
  return null;
}

export function sanitizeDisplayFilename(value) {
  const cleaned = String(value || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "");
  if (!cleaned) return "";
  return cleaned.slice(0, MAX_FILENAME_LENGTH);
}

function boundedPositiveInteger(value, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  if (rounded <= 0 || rounded > max) return null;
  return rounded;
}

export function buildUploadHeaders({ token, mimeType, mediaKind, asset }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": mimeType,
    "x-media-type": mediaKind,
  };

  const filename = sanitizeDisplayFilename(asset?.fileName);
  if (filename) headers["x-original-filename"] = filename;

  const width = boundedPositiveInteger(asset?.width, 100000);
  if (width) headers["x-media-width"] = String(width);

  const height = boundedPositiveInteger(asset?.height, 100000);
  if (height) headers["x-media-height"] = String(height);

  if (mediaKind === "video") {
    const durationMs = boundedPositiveInteger(asset?.duration, 24 * 60 * 60 * 1000);
    if (durationMs) headers["x-media-duration-ms"] = String(durationMs);
  }

  const capturedAt = new Date(asset?.creationTime || Date.now());
  if (!Number.isNaN(capturedAt.getTime())) {
    headers["x-captured-at"] = capturedAt.toISOString();
  }

  return headers;
}
