import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { supabase } from "./supabase";
import {
  MAX_IMAGE_BYTES,
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
    headers: { Authorization: `Bearer ${token}` },
  };
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
  return {
    media: (data || []).map((row) => attachMediaAccess(row, baseUrl, token)),
    error: null,
  };
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

  const maxBytes = mediaKind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
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
