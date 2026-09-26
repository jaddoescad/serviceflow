import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProjectMediaPreview } from "@/components/project-media-preview";
import { LabelChip } from "@/components/label-chip";
import { getContactDetail } from "@/lib/contacts";
import { createClient } from "@/lib/supabase/server";
import { CustomerActions } from "@/components/customer-actions";
import { requireMember } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const contact = await getContactDetail(id, page);
  const profile = await requireMember();
  if (!contact) notFound();
  const pages = Math.max(1, Math.ceil(contact.projectCount / 40));
  if (page > pages) redirect(`/contacts/${id}?page=${pages}`);
  const previews: Record<string, { id: string; media_type: string }[]> = {};
  if (contact.projects.length) {
    const client = await createClient();
    const { data, error } = await client.rpc("project_directory_previews", {
      requested_ids: contact.projects.map((project) => project.id),
    });
    if (error) throw new Error("Could not load project previews.");
    for (const row of data ?? []) (previews[row.project_id] ??= []).push(row);
  }
  return (
    <section className="workspace-page">
      <Link
        href="/contacts"
        className="text-sm text-slate-500 hover:text-blue-600"
      >
        ‹ Customers
      </Link>
      <div className="mt-6 flex items-center justify-between gap-4">
        <h1 className="break-words text-4xl font-extrabold tracking-tight">
          {contact.name}
        </h1>
        {["admin", "manager"].includes(profile.role) && (
          <CustomerActions
            customer={{
              id: contact.id,
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
              address: contact.address,
            }}
          />
        )}
      </div>
      <div className="mt-8 grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section aria-labelledby="customer-projects">
          <h2
            id="customer-projects"
            className="border-b border-slate-200 pb-4 text-lg font-semibold"
          >
            Projects ({contact.projectCount})
          </h2>
          {contact.projects.map((project) => (
            <article
              key={project.id}
              className="flex items-center gap-4 border-b border-slate-200 py-5"
            >
              <Link
                href={`/jobs/${project.id}`}
                prefetch={false}
                aria-label={`Open ${project.name}`}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100"
              >
                {previews[project.id]?.[0] ? (
                  <ProjectMediaPreview
                    src={`/api/jobs/${project.id}/media/${previews[project.id][0].id}`}
                    alt={project.name}
                    video={previews[project.id][0].media_type === "video"}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center text-slate-400"
                  >
                    ▧
                  </span>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/jobs/${project.id}`}
                  prefetch={false}
                  className="font-semibold hover:text-blue-600"
                >
                  {project.name}
                </Link>
                {project.address && (
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {project.address}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {project.archived_at && (
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
                      Archived
                    </span>
                  )}
                  {project.labels.map((label) => (
                    <LabelChip key={label.id} label={label} />
                  ))}
                </div>
              </div>
            </article>
          ))}
          {!contact.projects.length && (
            <p className="py-14 text-center text-sm text-slate-500">
              No projects yet.
            </p>
          )}
          {pages > 1 && (
            <nav
              aria-label="Customer project pages"
              className="mt-5 flex items-center justify-end gap-4 text-sm"
            >
              {page > 1 && (
                <Link
                  href={`/contacts/${id}?page=${page - 1}`}
                  className="text-blue-600"
                >
                  Previous
                </Link>
              )}
              <span className="text-slate-500">
                {page} / {pages}
              </span>
              {page < pages && (
                <Link
                  href={`/contacts/${id}?page=${page + 1}`}
                  className="text-blue-600"
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </section>
        <aside className="text-sm">
          <h2 className="border-b border-slate-200 pb-4 text-lg font-semibold">
            Contact Info
          </h2>
          <dl className="space-y-5 pt-5">
            {contact.email && (
              <div>
                <dt className="text-xs text-slate-500">Email</dt>
                <dd className="mt-1 break-all">
                  <a
                    href={`mailto:${contact.email}`}
                    className="hover:text-blue-600"
                  >
                    {contact.email}
                  </a>
                </dd>
              </div>
            )}
            {contact.phone && (
              <div>
                <dt className="text-xs text-slate-500">Phone</dt>
                <dd className="mt-1">
                  <a
                    href={`tel:${contact.phone}`}
                    className="hover:text-blue-600"
                  >
                    {contact.phone}
                  </a>
                </dd>
              </div>
            )}
            {contact.address && (
              <div>
                <dt className="text-xs text-slate-500">Address</dt>
                <dd className="mt-1 whitespace-pre-line">{contact.address}</dd>
              </div>
            )}
            {contact.notes && (
              <div>
                <dt className="text-xs text-slate-500">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap">{contact.notes}</dd>
              </div>
            )}
          </dl>
          {!contact.email &&
            !contact.phone &&
            !contact.address &&
            !contact.notes && (
              <p className="pt-5 text-slate-500">No contact details.</p>
            )}
        </aside>
      </div>
    </section>
  );
}
