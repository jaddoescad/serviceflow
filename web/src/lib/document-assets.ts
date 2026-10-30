// Files customers see without logging in (company logo, proposal photos and
// attachments, insurance and other company documents) are copies in the public
// `document-assets` bucket under `<org_id>/<random>-<name>`; the random name is
// what keeps them private, like the document link itself.

const BUCKET = "document-assets";

export function documentAssetUrl(path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

function documentAssetPath(orgId: string, fileName: string): string {
  const safe =
    fileName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(-80) || "file";
  return `${orgId}/${crypto.randomUUID()}-${safe}`;
}

/** Browser only: uploads as the signed-in manager and returns the stored path. */
export async function uploadDocumentAsset(orgId: string, file: Blob, fileName: string): Promise<string> {
  const { createClient } = await import("@/lib/supabase/client");
  const path = documentAssetPath(orgId, fileName);
  const { error } = await createClient()
    .storage.from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Browser only: removes uploaded copies (e.g. after the row that used them is deleted). */
export async function removeDocumentAssets(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { createClient } = await import("@/lib/supabase/client");
  await createClient().storage.from(BUCKET).remove(paths);
}

/** Largest file the document-assets bucket accepts. */
export const DOCUMENT_ASSET_MAX_BYTES = 25 * 1024 * 1024;

const MAX_IMAGE_EDGE = 2000;
const WEB_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Browser only: an image customers' browsers can show, at most 2000px on its
 * longest side. Returns null when this browser can't read the image (e.g.
 * HEIC outside Safari).
 */
export async function webImage(file: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && WEB_IMAGE_TYPES.includes(file.type) && file.size <= 3 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  // PNG and GIF may be transparent; photos become JPEG.
  const type = file.type === "image/png" || file.type === "image/gif" ? "image/png" : "image/jpeg";
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return null;
  }
  if (type === "image/jpeg") {
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
}

export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
