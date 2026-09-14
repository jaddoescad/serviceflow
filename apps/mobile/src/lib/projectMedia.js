import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { supabase } from "./supabase";
import {
  MAX_IMAGE_BYTES,
  MAX_MULTIPART_VIDEO_BYTES,
  MAX_VIDEO_BYTES,
  buildProjectMediaUploadPath,
  buildUploadHeaders,
  inferAssetMimeType,
  normalizeProjectMediaApiUrl,
  normalizeProjectMediaKind,
  resolveMediaKind,
} from "./projectMediaModel";

export {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  buildProjectMediaUploadPath,
  buildUploadHeaders,
  inferAssetMimeType,
  normalizeProjectMediaApiUrl,
  normalizeProjectMediaKind,
  resolveMediaKind,
} from "./projectMediaModel";

// Project media flows Expo -> authenticated Cloudflare Worker -> private R2.
// Metadata lives in public.job_media (RLS enforced); this module only talks to
// the Worker for bytes and to Supabase for listings.

export function getProjectMediaApiUrl() {
  return normalizeProjectMediaApiUrl(
    process.env.EXPO_PUBLIC_PROJECT_MEDIA_API_URL ||
      Constants.expoConfig?.extra?.projectMediaApiUrl,
  );
}

function requireProjectMediaApiUrl() {
  const baseUrl = getProjectMediaApiUrl();
  if (!baseUrl) {
    throw new Error(
      "Project media is not configured. Set EXPO_PUBLIC_PROJECT_MEDIA_API_URL to the media Worker URL.",
    );
  }
  return baseUrl;
}

async function requireAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) {
    throw new Error("You need to be signed in to view project media.");
  }
  return token;
}

async function readWorkerError(response, fallbackMessage) {
  let message = fallbackMessage;
  try {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.error === "string" && parsed.error.trim()) {
          message = parsed.error.trim();
        }
      } catch (_parseError) {
        // Non-JSON body (HTML error page, plain text) — keep the fallback.
      }
    }
  } catch (_readError) {
    // Body unreadable — keep the fallback.
  }
  return new Error(`${message} (HTTP ${response.status})`);
}

function attachMediaAccess(row, baseUrl, token) {
  return {
    ...row,
    url: `${baseUrl}/v1/media/${row.id}`,
    // Videos carry a still-frame URL the worker renders on demand; photos have
    // no separate thumbnail, so the field stays null.
    thumbnailUrl:
      row.media_type === "video" ? `${baseUrl}/v1/media/${row.id}/thumbnail` : null,
    headers: { Authorization: `Bearer ${token}` },
  };
}

function getEmployeeSourceName(employee) {
  const fullName = String(employee?.full_name || "").trim();
  if (fullName) return fullName;
  const emailName = String(employee?.email || "").split("@")[0].trim();
  return emailName || "Team member";
}

function getMediaSourceName(row, employeesById) {
  const importedCreator = String(row?.source_metadata?.creator_name || "").trim();
  if (importedCreator) return importedCreator;
  if (row?.source_provider === "companycam") return "CompanyCam";
  return getEmployeeSourceName(employeesById.get(row?.uploaded_by));
}

export async function listProjectMedia(
  projectId,
  { projectKind = "job", linkedLeadId = null } = {},
) {
  const baseUrl = requireProjectMediaApiUrl();
  if (!projectId) return { media: [], error: new Error("Missing project id.") };

  const normalizedKind = normalizeProjectMediaKind(projectKind);

  const token = await requireAccessToken();
  let query = supabase
    .from("job_media")
    .select("*");
  if (normalizedKind === "lead") {
    query = query.eq("lead_id", projectId);
  } else if (linkedLeadId) {
    query = query.or(`job_id.eq.${projectId},lead_id.eq.${linkedLeadId}`);
  } else {
    query = query.eq("job_id", projectId);
  }

  const { data, error } = await query
    .order("captured_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return { media: [], error };
  const uploaderIds = [
    ...new Set((data || []).map((row) => row.uploaded_by).filter(Boolean)),
  ];
  let employeesById = new Map();
  if (uploaderIds.length) {
    const { data: employees } = await supabase
      .from("employees")
      .select("id,email,full_name")
      .in("id", uploaderIds);
    employeesById = new Map((employees || []).map((employee) => [employee.id, employee]));
  }
  return {
    media: (data || []).map((row) => attachMediaAccess({
      ...row,
      source_name: getMediaSourceName(row, employeesById),
    }, baseUrl, token)),
    error: null,
  };
}

// Anything past this goes out in parts. Below it a single request is fewer
// round trips and the retry cost is small.
const MULTIPART_THRESHOLD_BYTES = 16 * 1024 * 1024;
const MULTIPART_PART_RETRIES = 3;

async function uploadPartWithRetry(url, token, objectKey, partNumber, chunk) {
  let lastError = null;
  for (let attempt = 1; attempt <= MULTIPART_PART_RETRIES; attempt += 1) {
    try {
      const response = await expoFetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "x-object-key": objectKey,
          "x-part-number": String(partNumber),
        },
        body: chunk,
      });
      if (response.ok) return response.json();
      // A refused part will not succeed on retry; a server or network fault might.
      if (response.status < 500) throw await readWorkerError(response, "Upload failed");
      lastError = await readWorkerError(response, "Upload failed");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Upload failed");
}

async function uploadVideoInParts({
  baseUrl,
  token,
  projectId,
  projectKind,
  asset,
  body,
  byteSize,
  mimeType,
}) {
  const startPath = `${buildProjectMediaUploadPath(projectId, projectKind)}/multipart`;
  const startResponse = await expoFetch(`${baseUrl}${startPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-media-content-type": mimeType,
      "x-file-size": String(byteSize),
      ...(asset?.fileName ? { "x-original-filename": String(asset.fileName) } : {}),
    },
  });
  if (!startResponse.ok) throw await readWorkerError(startResponse, "Upload failed");

  const { objectKey, uploadId, partSize } = await startResponse.json();
  const chunkSize = Number(partSize) > 0 ? Number(partSize) : 8 * 1024 * 1024;
  const partsUrl = `${baseUrl}/v1/media-uploads/${encodeURIComponent(uploadId)}/parts`;

  const parts = [];
  // A file handle reads a byte range straight from storage. Blob slices were
  // not sent intact by the native fetch, which is what failed the upload.
  let handle = null;
  try {
    handle = body.open();
    let offset = 0;
    let partNumber = 1;
    while (offset < byteSize) {
      const length = Math.min(chunkSize, byteSize - offset);
      handle.offset = offset;
      const chunk = handle.readBytes(length);
      if (!chunk?.length) throw new Error("Could not read the video from storage.");
      const part = await uploadPartWithRetry(partsUrl, token, objectKey, partNumber, chunk);
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      offset += chunk.length;
      partNumber += 1;
    }
  } catch (error) {
    // Leave no half-finished upload occupying storage.
    await expoFetch(`${baseUrl}/v1/media-uploads/${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "x-object-key": objectKey },
    }).catch(() => {});
    throw error;
  } finally {
    handle?.close?.();
  }

  const completeResponse = await expoFetch(
    `${baseUrl}/v1/media-uploads/${encodeURIComponent(uploadId)}/complete`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        objectKey,
        parts,
        mimeType,
        byteSize,
        originalFilename: asset?.fileName ?? null,
        width: asset?.width ?? null,
        height: asset?.height ?? null,
        durationMs: asset?.duration ?? null,
        capturedAt: asset?.creationTime ?? null,
      }),
    },
  );
  if (!completeResponse.ok) throw await readWorkerError(completeResponse, "Upload failed");

  const { media } = await completeResponse.json();
  return attachMediaAccess(media, baseUrl, token);
}

export async function uploadProjectMedia(projectId, asset, { projectKind = "job" } = {}) {
  const baseUrl = requireProjectMediaApiUrl();
  if (!projectId) throw new Error("Missing project id.");
  if (!asset?.uri) throw new Error("No file selected.");

  const mimeType = inferAssetMimeType(asset);
  const mediaKind = resolveMediaKind(mimeType);
  if (!mediaKind) {
    throw new Error("Unsupported file type. Use JPEG, PNG, WebP, HEIC photos or MP4/MOV videos.");
  }

  // Videos go through multipart, which has a far higher ceiling and survives a
  // dropped connection; photos are small enough to stay on the single request.
  const maxBytes = mediaKind === "video" ? MAX_MULTIPART_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const pickerSize = Number(asset?.fileSize);
  if (Number.isFinite(pickerSize) && pickerSize > maxBytes) {
    const maxMb = Math.floor(maxBytes / (1024 * 1024));
    throw new Error(`This ${mediaKind} is too large. The limit is ${maxMb} MB.`);
  }

  const body = asset.file || new File(asset.uri);
  const byteSize = Number(body.size);
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    throw new Error("The selected file is empty or cannot be read.");
  }
  if (byteSize > maxBytes) {
    const maxMb = Math.floor(maxBytes / (1024 * 1024));
    throw new Error(`This ${mediaKind} is too large. The limit is ${maxMb} MB.`);
  }

  const token = await requireAccessToken();

  if (mediaKind === "video" && byteSize > MULTIPART_THRESHOLD_BYTES) {
    try {
      return await uploadVideoInParts({
        baseUrl,
        token,
        projectId,
        projectKind,
        asset,
        body,
        byteSize,
        mimeType,
      });
    } catch (error) {
      // Anything that still fits in one request falls back to the path that has
      // always worked rather than failing the capture outright.
      if (byteSize > MAX_VIDEO_BYTES) throw error;
      console.warn("[project-media] Multipart upload failed, retrying as one request", error?.message);
    }
  }

  // expo/fetch understands expo-file-system File as a Blob and streams it from
  // native storage while supplying a real Content-Length for the R2 Worker.
  const uploadPath = buildProjectMediaUploadPath(projectId, projectKind);
  const response = await expoFetch(`${baseUrl}${uploadPath}`, {
    method: "PUT",
    headers: buildUploadHeaders({ token, mimeType, mediaKind, asset }),
    body,
  });

  if (!response.ok) {
    throw await readWorkerError(response, "Upload failed");
  }

  const created = await response.json();
  return attachMediaAccess(created, baseUrl, token);
}

export async function deleteProjectMedia(mediaId) {
  const baseUrl = requireProjectMediaApiUrl();
  if (!mediaId) throw new Error("Missing media id.");
  const token = await requireAccessToken();

  const response = await fetch(`${baseUrl}/v1/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw await readWorkerError(response, "Delete failed");
  }
}
