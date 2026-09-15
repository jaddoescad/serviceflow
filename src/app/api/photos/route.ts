import { NextResponse } from "next/server";
import { getPhotoFeed, type PhotoCursor } from "@/lib/photo-feed";
import { requireStaff } from "@/lib/auth";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
export async function GET(request: Request) {
  await requireStaff();
  const params = new URL(request.url).searchParams;
  const project = params.get("project"), creator = params.get("creator"), media = params.get("media"), since = params.get("since");
  let cursor: PhotoCursor | null = null;
  try {
    const raw = params.get("cursor");
    if (raw) {
      if (raw.length > 300) throw new Error();
      cursor = JSON.parse(raw);
      if (!cursor || !uuid.test(cursor.id) || !date(cursor.createdAt) || (cursor.capturedAt !== null && !date(cursor.capturedAt))) throw new Error();
    }
    if ((project && !uuid.test(project)) || (creator && creator.length > 500) || (media && !["image", "video"].includes(media)) || (since && !date(since))) throw new Error();
  } catch { return NextResponse.json({ error: "Invalid photo filters" }, { status: 400 }); }
  try {
    const data = await getPhotoFeed({ project_filter: project, creator_filter: creator, media_filter: media, since_filter: since }, cursor, false);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Photos could not load. Try again." }, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
}
