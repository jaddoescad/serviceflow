// Authenticated project media Worker.
//
// Flow: Expo app -> this Worker -> private R2 bucket, with metadata and
// authorization in Supabase (public.job_media, RLS). The Worker forwards the
// caller's Supabase JWT to the Data API, so Supabase RLS decides every read,
// insert, and delete. No service-role key, no public bucket URLs.

const MEDIA_TYPES = {
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/png": { kind: "image", extension: "png" },
  "image/webp": { kind: "image", extension: "webp" },
  "image/heic": { kind: "image", extension: "heic" },
  "image/heif": { kind: "image", extension: "heif" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/quicktime": { kind: "video", extension: "mov" },
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 120;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Range, x-media-type, x-file-size, x-original-filename, x-media-width, x-media-height, x-media-duration-ms, x-captured-at",
  "Access-Control-Expose-Headers":
    "ETag, Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Content-Type",
  "Access-Control-Max-Age": "86400",
};

// A grid tile is small; 640x360 covers 3x displays without paying for more.
// 8 MB parts: comfortably inside the request limit, few enough round trips.
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
const MAX_MULTIPART_VIDEO_BYTES = 1024 * 1024 * 1024;

const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_HEIGHT = 360;
// One second in, so we skip the black frame most recordings start on.
const THUMBNAIL_TIME = "1s";

// Stored alongside the video so a deleted video takes its frame with it.
function thumbnailObjectKey(objectKey) {
  return `${objectKey}.thumb.jpg`;
}

function thumbnailHeaders(etag) {
  const headers = {
    "Content-Type": "image/jpeg",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (etag) headers.ETag = etag;
  return headers;
}

function withCors(headers = {}) {
  return { ...CORS_HEADERS, ...headers };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ "Content-Type": "application/json; charset=utf-8", ...headers }),
  });
}

function errorResponse(status, message, headers = {}) {
  return jsonResponse(status, { error: message }, headers);
}

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : "";
  return token || null;
}

// The JWT subject is only used to attribute uploaded_by; Supabase verifies the
// signature and enforces uploaded_by = auth.uid() through RLS on insert.
function decodeJwtSubject(token) {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const unpadded = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const base64 = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64));
    const sub = String(payload?.sub || "");
    return UUID_PATTERN.test(sub) ? sub : null;
  } catch (_error) {
    return null;
  }
}

function sanitizeFilename(value) {
  const cleaned = String(value || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "");
  return cleaned ? cleaned.slice(0, MAX_FILENAME_LENGTH) : null;
}

function parsePositiveInteger(value, max) {
  if (value === null || value === undefined || value === "") return null;
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > max) return null;
  return number;
}

function parseCapturedAt(value) {
  if (!value || String(value).length > 64) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function supabaseRest(env, token, path, init = {}) {
  const url = `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1${path}`;
  try {
    return await fetch(url, {
      ...init,
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch (_error) {
    return new Response(null, { status: 502 });
  }
}

function hasValidConfiguration(env) {
  try {
    const url = new URL(String(env.SUPABASE_URL || ""));
    return url.protocol === "https:" && Boolean(String(env.SUPABASE_PUBLISHABLE_KEY || "").trim());
  } catch (_error) {
    return false;
  }
}

// Resolve a job_media row visible to this caller. RLS makes "not yours" and
// "does not exist" both look like an empty result, which is what we want.
async function fetchMediaRow(env, token, mediaId) {
  const response = await supabaseRest(
    env,
    token,
    `/job_media?id=eq.${mediaId}&select=*&limit=1`,
    { headers: { Accept: "application/json" } },
  );
  if (response.status === 401 || response.status === 403) {
    return { status: 401, row: null };
  }
  if (!response.ok) return { status: 502, row: null };
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows)) return { status: 502, row: null };
  return { status: 200, row: rows[0] || null };
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader) return { kind: "none" };
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return { kind: "invalid" };

  if (match[1] === "") {
    // Suffix range: last N bytes.
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return { kind: "invalid" };
    const length = Math.min(suffix, size);
    return { kind: "range", offset: size - length, length };
  }

  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start >= size) return { kind: "unsatisfiable" };
  const end = match[2] === "" ? size - 1 : Number(match[2]);
  if (!Number.isSafeInteger(end) || end < start) return { kind: "invalid" };
  return { kind: "range", offset: start, length: Math.min(end, size - 1) - start + 1 };
}

function mediaResponseHeaders(row, etag, size) {
  const filename =
    sanitizeFilename(row.original_filename) ||
    `${row.id}.${row.object_key.split(".").pop() || "bin"}`;
  const headers = {
    "Content-Type": row.mime_type || "application/octet-stream",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Accept-Ranges": "bytes",
    "Content-Length": String(size),
  };
  if (etag) headers.ETag = etag;
  return headers;
}

// Authorization gate: can this JWT read the owning job/lead at all? RLS answers.
// Returns an error Response when access is refused, otherwise null.
async function assertProjectAccess(env, token, projectKind, projectId) {
  const projectTable = projectKind === "lead" ? "leads" : "jobs";
  const projectCheck = await supabaseRest(
    env,
    token,
    `/${projectTable}?id=eq.${projectId}&select=id&limit=1`,
    { headers: { Accept: "application/json" } },
  );
  if (projectCheck.status === 401 || projectCheck.status === 403) {
    return errorResponse(401, "Not authorized.");
  }
  if (!projectCheck.ok) return errorResponse(502, "Could not verify project access.");
  const projectRows = await projectCheck.json().catch(() => null);
  if (!Array.isArray(projectRows) || !projectRows.length) {
    return errorResponse(404, "Project not found or not accessible.");
  }
  return null;
}

// Object keys are server-generated as "<jobs|leads>/<projectId>/<mediaId>.<ext>",
// so a part upload can re-derive who owns it without trusting the client.
function parseObjectKey(objectKey) {
  const match = /^(jobs|leads)\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\.([a-z0-9]+)$/.exec(
    String(objectKey || ""),
  );
  if (!match) return null;
  return {
    projectKind: match[1] === "leads" ? "lead" : "job",
    projectId: match[2],
    mediaId: match[3],
  };
}

async function handleUpload(request, env, projectKind, projectId) {
  const token = getBearerToken(request);
  if (!token) return errorResponse(401, "Missing bearer token.");
  if (!UUID_PATTERN.test(projectId)) return errorResponse(400, "Invalid project id.");

  const uploadedBy = decodeJwtSubject(token);
  if (!uploadedBy) return errorResponse(401, "Invalid bearer token.");

  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const mediaInfo = MEDIA_TYPES[contentType];
  if (!mediaInfo) {
    return errorResponse(415, "Unsupported content type. Allowed: JPEG, PNG, WebP, HEIC/HEIF, MP4, QuickTime.");
  }

  const declaredKind = (request.headers.get("x-media-type") || "").trim().toLowerCase();
  if (declaredKind !== mediaInfo.kind) {
    return errorResponse(400, `x-media-type must be "${mediaInfo.kind}" for ${contentType}.`);
  }

  const maxBytes = mediaInfo.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  // Browsers own the Content-Length header and may omit it from the Fetch API
  // surface, so web uploads also declare the Blob size in x-file-size. The R2
  // result is compared against this value before metadata is committed.
  const contentLength = parsePositiveInteger(
    request.headers.get("Content-Length") || request.headers.get("x-file-size"),
    Number.MAX_SAFE_INTEGER,
  );
  if (!contentLength) return errorResponse(411, "A valid Content-Length header is required.");
  if (contentLength > maxBytes) {
    return errorResponse(413, `File too large. Limit is ${Math.floor(maxBytes / (1024 * 1024))} MB for ${mediaInfo.kind}s.`);
  }

  const denied = await assertProjectAccess(env, token, projectKind, projectId);
  if (denied) return denied;

  const mediaId = crypto.randomUUID();
  const objectPrefix = projectKind === "lead" ? "leads" : "jobs";
  const objectKey = `${objectPrefix}/${projectId}/${mediaId}.${mediaInfo.extension}`;
  const originalFilename = sanitizeFilename(request.headers.get("x-original-filename"));

  let object;
  try {
    object = await env.MEDIA_BUCKET.put(objectKey, request.body, {
      httpMetadata: { contentType },
      customMetadata: {
        project_kind: projectKind,
        project_id: projectId,
        media_id: mediaId,
        uploaded_by: uploadedBy,
        ...(originalFilename ? { original_filename: originalFilename } : {}),
      },
    });
  } catch (_error) {
    return errorResponse(502, "Storing the file failed. Try again.");
  }
  if (!object) {
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => {});
    return errorResponse(502, "Storing the file failed. Try again.");
  }
  if (object && object.size !== contentLength) {
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => {});
    return errorResponse(400, "Uploaded bytes did not match Content-Length.");
  }

  const insertBody = {
    id: mediaId,
    ...(projectKind === "lead" ? { lead_id: projectId } : { job_id: projectId }),
    object_key: objectKey,
    media_type: mediaInfo.kind,
    mime_type: contentType,
    original_filename: originalFilename,
    byte_size: contentLength,
    width: parsePositiveInteger(request.headers.get("x-media-width"), 100000),
    height: parsePositiveInteger(request.headers.get("x-media-height"), 100000),
    duration_ms:
      mediaInfo.kind === "video"
        ? parsePositiveInteger(request.headers.get("x-media-duration-ms"), 24 * 60 * 60 * 1000)
        : null,
    captured_at: parseCapturedAt(request.headers.get("x-captured-at")),
    uploaded_by: uploadedBy,
  };

  const insert = await supabaseRest(env, token, "/job_media", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(insertBody),
  });

  if (!insert.ok) {
    // Keep storage consistent with metadata: no orphaned R2 objects.
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => {});
    if (insert.status === 401 || insert.status === 403) {
      return errorResponse(403, "Not allowed to add media to this project.");
    }
    if (insert.status === 409) return errorResponse(409, "Duplicate media upload.");
    return errorResponse(502, "Saving media details failed. Try again.");
  }

  const rows = await insert.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => {});
    return errorResponse(502, "Saving media details failed. Try again.");
  }

  return jsonResponse(201, row);
}

async function handleMediaFetch(request, env, mediaId, { headOnly }) {
  const token = getBearerToken(request);
  if (!token) return errorResponse(401, "Missing bearer token.");
  if (!UUID_PATTERN.test(mediaId)) return errorResponse(400, "Invalid media id.");

  const { status, row } = await fetchMediaRow(env, token, mediaId);
  if (status === 401) return errorResponse(401, "Not authorized.");
  if (status !== 200) return errorResponse(502, "Could not verify media access.");
  if (!row) return errorResponse(404, "Media not found.");

  if (headOnly) {
    const head = await env.MEDIA_BUCKET.head(row.object_key);
    if (!head) return errorResponse(404, "Media file not found.");
    return new Response(null, {
      status: 200,
      headers: withCors(mediaResponseHeaders(row, head.httpEtag, head.size)),
    });
  }

  const probe = await env.MEDIA_BUCKET.head(row.object_key);
  if (!probe) return errorResponse(404, "Media file not found.");
  const size = probe.size;

  const range = parseRangeHeader(request.headers.get("Range"), size);
  if (range.kind === "unsatisfiable" || range.kind === "invalid") {
    return errorResponse(416, "Requested range not satisfiable.", {
      "Content-Range": `bytes */${size}`,
    });
  }

  const useRange = range.kind === "range";
  const object = await env.MEDIA_BUCKET.get(
    row.object_key,
    useRange ? { range: { offset: range.offset, length: range.length } } : undefined,
  );
  if (!object) return errorResponse(404, "Media file not found.");

  const headers = mediaResponseHeaders(row, object.httpEtag, useRange ? range.length : size);
  if (useRange) {
    headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
  }

  return new Response(object.body, {
    status: useRange ? 206 : 200,
    headers: withCors(headers),
  });
}

// Still frame from a stored video, produced by Cloudflare Media Transformations.
// The binding takes the R2 body directly, so the bucket stays private: no public
// URL and no presigned link is ever created. Same JWT + RLS check as the video.
// --- Multipart uploads -------------------------------------------------------
// A single Worker request body is capped at 100 MB, which is why whole-file
// uploads were limited to 95 MB. Multipart sends the file in parts instead, so
// long videos upload at full quality and a dropped connection only costs the
// part in flight rather than the whole recording.

async function handleMultipartStart(request, env, projectKind, projectId) {
  const token = getBearerToken(request);
  if (!token) return errorResponse(401, "Missing bearer token.");
  if (!UUID_PATTERN.test(projectId)) return errorResponse(400, "Invalid project id.");

  const uploadedBy = decodeJwtSubject(token);
  if (!uploadedBy) return errorResponse(401, "Invalid bearer token.");

  const contentType = (request.headers.get("x-media-content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const mediaInfo = MEDIA_TYPES[contentType];
  if (!mediaInfo) return errorResponse(415, "Unsupported content type.");
  if (mediaInfo.kind !== "video") {
    return errorResponse(400, "Multipart uploads are for videos; send photos in one request.");
  }

  const declaredSize = parsePositiveInteger(
    request.headers.get("x-file-size"),
    Number.MAX_SAFE_INTEGER,
  );
  if (!declaredSize) return errorResponse(411, "A valid x-file-size header is required.");
  if (declaredSize > MAX_MULTIPART_VIDEO_BYTES) {
    return errorResponse(
      413,
      `File too large. Limit is ${Math.floor(MAX_MULTIPART_VIDEO_BYTES / (1024 * 1024))} MB for videos.`,
    );
  }

  const denied = await assertProjectAccess(env, token, projectKind, projectId);
  if (denied) return denied;

  const mediaId = crypto.randomUUID();
  const objectPrefix = projectKind === "lead" ? "leads" : "jobs";
  const objectKey = `${objectPrefix}/${projectId}/${mediaId}.${mediaInfo.extension}`;
  const originalFilename = sanitizeFilename(request.headers.get("x-original-filename"));

  let upload;
  try {
    upload = await env.MEDIA_BUCKET.createMultipartUpload(objectKey, {
      httpMetadata: { contentType },
      customMetadata: {
        project_kind: projectKind,
        project_id: projectId,
        media_id: mediaId,
        uploaded_by: uploadedBy,
        ...(originalFilename ? { original_filename: originalFilename } : {}),
      },
    });
  } catch (_error) {
    return errorResponse(502, "Could not start the upload. Try again.");
  }

  return jsonResponse(200, {
    mediaId,
    objectKey,
    uploadId: upload.uploadId,
    partSize: MULTIPART_PART_SIZE,
  });
}

// Re-checks access on every part: the key names its own project, so a stolen
// upload id cannot be pointed at someone else's job.
async function authorizeMultipart(request, env, objectKey) {
  const token = getBearerToken(request);
  if (!token) return { error: errorResponse(401, "Missing bearer token.") };
  const parsed = parseObjectKey(objectKey);
  if (!parsed) return { error: errorResponse(400, "Invalid object key.") };
  const denied = await assertProjectAccess(env, token, parsed.projectKind, parsed.projectId);
  if (denied) return { error: denied };
  return { token, parsed };
}

async function handleMultipartPart(request, env, uploadId) {
  const objectKey = request.headers.get("x-object-key") || "";
  const { error } = await authorizeMultipart(request, env, objectKey);
  if (error) return error;

  const partNumber = parsePositiveInteger(request.headers.get("x-part-number"), 10000);
  if (!partNumber) return errorResponse(400, "A valid x-part-number header is required.");
  if (!request.body) return errorResponse(400, "Missing part body.");

  try {
    const upload = env.MEDIA_BUCKET.resumeMultipartUpload(objectKey, uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return jsonResponse(200, { partNumber: part.partNumber, etag: part.etag });
  } catch (_error) {
    return errorResponse(502, "Storing that part failed. Try again.");
  }
}

async function handleMultipartComplete(request, env, uploadId) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return errorResponse(400, "Invalid body.");

  const { objectKey, parts } = payload;
  const { token, error, parsed } = await authorizeMultipart(request, env, objectKey);
  if (error) return error;
  if (!Array.isArray(parts) || !parts.length) return errorResponse(400, "No parts to complete.");

  const uploadedBy = decodeJwtSubject(token);
  if (!uploadedBy) return errorResponse(401, "Invalid bearer token.");

  let object;
  try {
    const upload = env.MEDIA_BUCKET.resumeMultipartUpload(objectKey, uploadId);
    object = await upload.complete(
      parts.map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag) })),
    );
  } catch (_error) {
    return errorResponse(502, "Assembling the upload failed. Try again.");
  }

  const contentType = (payload.mimeType || "").split(";")[0].trim().toLowerCase();
  const mediaInfo = MEDIA_TYPES[contentType];
  if (!mediaInfo) {
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => {});
    return errorResponse(415, "Unsupported content type.");
  }

  const insertBody = {
    id: parsed.mediaId,
    ...(parsed.projectKind === "lead"
      ? { lead_id: parsed.projectId }
      : { job_id: parsed.projectId }),
    object_key: objectKey,
    media_type: mediaInfo.kind,
    mime_type: contentType,
    original_filename: sanitizeFilename(payload.originalFilename),
    byte_size: object?.size ?? parsePositiveInteger(payload.byteSize, Number.MAX_SAFE_INTEGER),
    width: parsePositiveInteger(payload.width, 100000),
    height: parsePositiveInteger(payload.height, 100000),
    duration_ms: parsePositiveInteger(payload.durationMs, 24 * 60 * 60 * 1000),
    captured_at: parseCapturedAt(payload.capturedAt),
    uploaded_by: uploadedBy,
  };

  const insert = await supabaseRest(env, token, "/job_media", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(insertBody),
  });

  if (!insert.ok) {
    // Keep storage consistent with metadata: no orphaned R2 objects.
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => {});
    if (insert.status === 401 || insert.status === 403) {
      return errorResponse(403, "Not allowed to add media to this project.");
    }
    if (insert.status === 409) return errorResponse(409, "Duplicate media upload.");
    return errorResponse(502, "Saving media details failed. Try again.");
  }

  const rows = await insert.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : rows;
  return jsonResponse(201, { media: row });
}

async function handleMultipartAbort(request, env, uploadId) {
  const objectKey = request.headers.get("x-object-key") || "";
  const { error } = await authorizeMultipart(request, env, objectKey);
  if (error) return error;
  try {
    await env.MEDIA_BUCKET.resumeMultipartUpload(objectKey, uploadId).abort();
  } catch (_error) {
    // An already-aborted or unknown upload is fine to report as done.
  }
  return jsonResponse(200, { aborted: true });
}

async function handleMediaThumbnail(request, env, mediaId) {
  const token = getBearerToken(request);
  if (!token) return errorResponse(401, "Missing bearer token.");
  if (!UUID_PATTERN.test(mediaId)) return errorResponse(400, "Invalid media id.");
  if (!env.MEDIA) return errorResponse(501, "Media transformations are not enabled.");

  const { status, row } = await fetchMediaRow(env, token, mediaId);
  if (status === 401) return errorResponse(401, "Not authorized.");
  if (status !== 200) return errorResponse(502, "Could not verify media access.");
  if (!row) return errorResponse(404, "Media not found.");
  if (row.media_type !== "video") return errorResponse(400, "Media is not a video.");

  // Serve a previously generated frame if we have one. A stored frame costs
  // nothing to serve, so each video is transformed once ever rather than once
  // per month, and repeat views skip the transformer entirely.
  const cacheKey = thumbnailObjectKey(row.object_key);
  const cached = await env.MEDIA_BUCKET.get(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: withCors(thumbnailHeaders(cached.httpEtag)),
    });
  }

  const object = await env.MEDIA_BUCKET.get(row.object_key);
  if (!object) return errorResponse(404, "Media file not found.");

  try {
    const frame = await env.MEDIA.input(object.body)
      .transform({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT, fit: "cover" })
      .output({ mode: "frame", time: THUMBNAIL_TIME, format: "jpg" })
      .response();

    // Buffer so the same bytes can be stored and returned; a frame is tens of
    // kilobytes, well within a Worker's memory.
    const bytes = await frame.arrayBuffer();
    await env.MEDIA_BUCKET.put(cacheKey, bytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });

    return new Response(bytes, {
      status: 200,
      headers: withCors(thumbnailHeaders(null)),
    });
  } catch (error) {
    // A frame is a nicety: fall back to the placeholder tile rather than an error
    // that would make the whole grid look broken.
    console.warn("Thumbnail generation failed", error?.message);
    return errorResponse(422, "Could not extract a frame from this video.");
  }
}

async function handleMediaDelete(request, env, mediaId) {
  const token = getBearerToken(request);
  if (!token) return errorResponse(401, "Missing bearer token.");
  if (!UUID_PATTERN.test(mediaId)) return errorResponse(400, "Invalid media id.");

  const { status, row } = await fetchMediaRow(env, token, mediaId);
  if (status === 401) return errorResponse(401, "Not authorized.");
  if (status !== 200) return errorResponse(502, "Could not verify media access.");
  if (!row) return errorResponse(404, "Media not found.");

  const deletion = await supabaseRest(env, token, `/job_media?id=eq.${mediaId}`, {
    method: "DELETE",
    headers: { Accept: "application/json", Prefer: "return=representation" },
  });
  if (deletion.status === 401 || deletion.status === 403) {
    return errorResponse(403, "Not allowed to delete this media.");
  }
  if (!deletion.ok) return errorResponse(502, "Deleting media details failed. Try again.");
  const deletedRows = await deletion.json().catch(() => null);
  if (!Array.isArray(deletedRows) || !deletedRows.length) {
    // RLS filtered the delete: the caller can see the row but not remove it.
    return errorResponse(403, "Not allowed to delete this media.");
  }

  await env.MEDIA_BUCKET.delete(row.object_key).catch(() => {});
  // Remove any cached still frame too, so deleting a video leaves nothing behind.
  await env.MEDIA_BUCKET.delete(thumbnailObjectKey(row.object_key)).catch(() => {});
  return new Response(null, { status: 204, headers: withCors() });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }

    if (pathname === "/health" && method === "GET") {
      return jsonResponse(200, { ok: true });
    }

    if (!hasValidConfiguration(env)) {
      return errorResponse(503, "Media service is not configured.");
    }

    const multipartStart = pathname.match(/^\/v1\/(jobs|leads)\/([^/]+)\/media\/multipart$/);
    if (multipartStart) {
      if (method !== "POST") return errorResponse(405, "Method not allowed.");
      const projectKind = multipartStart[1] === "leads" ? "lead" : "job";
      return handleMultipartStart(request, env, projectKind, decodeURIComponent(multipartStart[2]));
    }

    const multipartPart = pathname.match(/^\/v1\/media-uploads\/([^/]+)\/parts$/);
    if (multipartPart) {
      if (method !== "PUT") return errorResponse(405, "Method not allowed.");
      return handleMultipartPart(request, env, decodeURIComponent(multipartPart[1]));
    }

    const multipartComplete = pathname.match(/^\/v1\/media-uploads\/([^/]+)\/complete$/);
    if (multipartComplete) {
      if (method !== "POST") return errorResponse(405, "Method not allowed.");
      return handleMultipartComplete(request, env, decodeURIComponent(multipartComplete[1]));
    }

    const multipartAbort = pathname.match(/^\/v1\/media-uploads\/([^/]+)$/);
    if (multipartAbort) {
      if (method !== "DELETE") return errorResponse(405, "Method not allowed.");
      return handleMultipartAbort(request, env, decodeURIComponent(multipartAbort[1]));
    }

    const uploadMatch = pathname.match(/^\/v1\/(jobs|leads)\/([^/]+)\/media$/);
    if (uploadMatch) {
      if (method !== "PUT") return errorResponse(405, "Method not allowed.");
      const projectKind = uploadMatch[1] === "leads" ? "lead" : "job";
      return handleUpload(request, env, projectKind, decodeURIComponent(uploadMatch[2]));
    }

    const thumbnailMatch = pathname.match(/^\/v1\/media\/([^/]+)\/thumbnail$/);
    if (thumbnailMatch) {
      if (method !== "GET") return errorResponse(405, "Method not allowed.");
      return handleMediaThumbnail(request, env, decodeURIComponent(thumbnailMatch[1]));
    }

    const mediaMatch = pathname.match(/^\/v1\/media\/([^/]+)$/);
    if (mediaMatch) {
      const mediaId = decodeURIComponent(mediaMatch[1]);
      if (method === "GET") return handleMediaFetch(request, env, mediaId, { headOnly: false });
      if (method === "HEAD") return handleMediaFetch(request, env, mediaId, { headOnly: true });
      if (method === "DELETE") return handleMediaDelete(request, env, mediaId);
      return errorResponse(405, "Method not allowed.");
    }

    return errorResponse(404, "Not found.");
  },
};
