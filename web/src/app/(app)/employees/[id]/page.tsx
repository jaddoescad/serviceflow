import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoFeed } from "@/components/photo-feed";
import { requireStaff } from "@/lib/auth";
import { initials } from "@/lib/format";
import { getPhotoFeed } from "@/lib/photo-feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const client = await createClient();
  const [, { data: member, error }, { batch, summary }] = await Promise.all([
    requireStaff(),
    client
      .from("employees")
      .select("id,full_name,email,role,is_active")
      .eq("id", id)
      .maybeSingle(),
    getPhotoFeed({
      uploader_filter: id,
      project_filters: null,
      creator_filters: null,
      media_filter: null,
      since_filter: null,
    }),
  ]);
  if (error) throw new Error("Could not load team member.");
  if (!member) notFound();
  const name = member.full_name || member.email || "Team member";

  return (
    <PhotoFeed
      key={id}
      uploaderId={id}
      initialBatch={batch}
      summary={summary!}
      header={
        <header key={id} className="pb-5">
          <Link
            href="/employees"
            className="mb-5 inline-block text-sm text-slate-500 hover:text-blue-600"
          >
            ‹ Team
          </Link>
          <div className="flex items-center gap-7">
            <span
              aria-hidden="true"
              className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-slate-100 text-4xl font-semibold text-slate-600 sm:h-28 sm:w-28"
            >
              {initials(name)}
            </span>
            <div className="min-w-0">
              <h1 className="break-words text-4xl font-extrabold tracking-tight">
                {name}
              </h1>
              {member.email && (
                <a
                  href={`mailto:${member.email}`}
                  className="mt-2 block break-all text-sm text-slate-600 hover:text-blue-600"
                >
                  {member.email}
                </a>
              )}
              <p className="mt-2 text-sm capitalize text-slate-500">
                {member.role}
                {!member.is_active && " · Deactivated"}
              </p>
            </div>
          </div>
        </header>
      }
    />
  );
}
