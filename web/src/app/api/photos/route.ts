import { NextResponse } from "next/server";
import { getPhotoFeed, type PhotoCursor } from "@/lib/photo-feed";
import { requireMember } from "@/lib/auth";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 40 &&
  Number.isFinite(Date.parse(value));
export async function GET(request: Request) {
  await requireMember();
  const params = new URL(request.url).searchParams;
  const projects = params.getAll("project"),
    uploader = params.get("uploader"),
    creators = params.getAll("creator"),
    tags = params.getAll("tag"),
    media = params.get("media"),
    since = params.get("since"),
    until = params.get("until");
  let cursor: PhotoCursor | null = null;
  try {
    const raw = params.get("cursor");
    if (raw) {
      if (raw.length > 300) throw new Error();
      cursor = JSON.parse(raw);
      if (
        !cursor ||
        !uuid.test(cursor.id) ||
        !date(cursor.createdAt) ||
        (cursor.capturedAt !== null && !date(cursor.capturedAt))
      )
        throw new Error();
    }
    if (
      (params.has("options") && params.get("options") !== "1") ||
      projects.length > 100 ||
      projects.some((project) => !uuid.test(project)) ||
      (uploader !== null && !uuid.test(uploader)) ||
      tags.length > 30 ||
      tags.some((tag) => !tag || tag.length > 60) ||
      creators.length > 100 ||
      creators.some((creator) => !creator || creator.length > 500) ||
      (params.has("order") &&
        !["oldest", "newest"].includes(params.get("order")!)) ||
      (media && !["image", "video"].includes(media)) ||
      (since && !date(since)) ||
      (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || !date(until)))
    )
      throw new Error();
  } catch {
    return NextResponse.json(
      { error: "Invalid photo filters" },
      { status: 400 },
    );
  }
  try {
    const data = await getPhotoFeed(
      {
        project_filters: projects.length ? projects : null,
        uploader_filter: uploader,
        tag_filters: tags.length ? tags : null,
        creator_filters: creators.length ? creators : null,
        oldest_first: params.get("order") === "oldest",
        media_filter: media,
        since_filter:
          since && /^\d{4}-\d{2}-\d{2}$/.test(since)
            ? `${since} 00:00 America/Toronto`
            : since,
        until_filter: until,
      },
      cursor,
      params.get("options") === "1",
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Photos could not load. Try again." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
