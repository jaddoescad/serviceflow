import { requireMember, getSessionToken } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { validPhotoId } from "@/lib/photo-link";
import {
  archiveFilename,
  mediaZipStream,
  MAX_ARCHIVE_BYTES,
} from "@/lib/media-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  await requireMember();
  const token = await getSessionToken();
  if (!token)
    return new Response("Sign in to download photos.", { status: 401 });
  let ids: string[];
  try {
    const form = await request.formData();
    const raw = form.get("ids");
    if (typeof raw !== "string" || raw.length > 20000) throw new Error();
    const parsed = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.length ||
      parsed.length > 500 ||
      parsed.some((id) => typeof id !== "string" || !validPhotoId(id))
    )
      throw new Error();
    ids = [...new Set(parsed)];
  } catch {
    return new Response("Choose between 1 and 500 photos or videos.", {
      status: 400,
    });
  }

  const client = await createClient();
  const { data, error } = await client
    .from("job_media")
    .select("id,original_filename,mime_type,byte_size")
    .in("id", ids);
  if (error || data.length !== ids.length)
    return new Response(
      "Some selected files are no longer available. Refresh the gallery and try again.",
      { status: 404 },
    );
  if (
    data.reduce((sum, row) => sum + Number(row.byte_size ?? 0), 0) >
    MAX_ARCHIVE_BYTES
  ) {
    return new Response(
      "This selection is larger than 3.5 GB. Download it in smaller groups.",
      { status: 413 },
    );
  }
  const base = new URL(
    process.env.PROJECT_MEDIA_API_URL ||
      "https://project-media-worker.jadslim-fai.workers.dev",
  );
  if (base.protocol !== "https:")
    return new Response("Media service unavailable.", { status: 503 });
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
  };
  const stream = mediaZipStream(
    data.map((row) => ({
      name: archiveFilename(
        row.original_filename,
        row.id,
        extensions[row.mime_type] ?? "bin",
      ),
      async open(signal: AbortSignal) {
        const response = await fetch(new URL(`/v1/media/${row.id}`, base), {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.any([
            signal,
            request.signal,
            AbortSignal.timeout(120000),
          ]),
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error("A selected file could not be downloaded.");
        }
        return response.body;
      },
    })),
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="ServiceFlow-photos.zip"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
