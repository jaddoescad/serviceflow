import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoFeed } from "@/components/photo-feed";
import { Tag } from "@/components/ui";
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
        <header key={id} className="pb-2">
          <p className="mb-4 text-[13px]">
            <Link
              href="/employees"
              className="font-medium text-[var(--color-muted)] hover:text-[var(--color-heading)]"
            >
              Team
            </Link>
            <span className="mx-1.5 text-[var(--color-faint)]">/</span>
            <span className="text-[var(--color-heading)]">{name}</span>
          </p>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--tag-gray-bg)] text-sm font-semibold text-[var(--tag-gray-text)]"
            >
              {initials(name)}
            </span>
            <div className="min-w-0">
              <h1 className="break-words text-lg font-semibold text-[var(--color-heading)]">
                {name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-muted)]">
                <Tag>
                  <span className="capitalize">{member.role}</span>
                </Tag>
                {!member.is_active && <Tag tone="red">Deactivated</Tag>}
                {member.email && (
                  <a
                    href={`mailto:${member.email}`}
                    className="break-all hover:text-[var(--color-heading)] hover:underline"
                  >
                    {member.email}
                  </a>
                )}
              </div>
            </div>
          </div>
        </header>
      }
    />
  );
}
