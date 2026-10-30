import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProjectMediaPreview } from "@/components/project-media-preview";
import { LabelChip } from "@/components/label-chip";
import { getContactDetail } from "@/lib/contacts";
import { getProjectPreviews } from "@/lib/project-workspace";
import { CustomerActions } from "@/components/customer-actions";
import { PortalLinkButton } from "@/components/portal-link-button";
import { PageHeader } from "@/components/kpi";
import { NAV_ICONS } from "@/components/nav-icons";
import { EmptyState, Tag, buttonClassName } from "@/components/ui";
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
  const [contact, profile] = await Promise.all([
    getContactDetail(id, page),
    requireMember(),
  ]);
  if (!contact) notFound();
  const pages = Math.max(1, Math.ceil(contact.projectCount / 40));
  if (page > pages) redirect(`/contacts/${id}?page=${pages}`);
  const previews = await getProjectPreviews(contact.projects.map((project) => project.id));
  return (
    <section>
      <PageHeader
        title={
          <>
            <Link href="/contacts" className="font-medium text-[var(--color-muted)] hover:text-[var(--color-heading)]">
              Customers
            </Link>
            <span className="mx-1.5 font-normal text-[var(--color-faint)]">/</span>
            {contact.name}
          </>
        }
        actions={
          ["admin", "manager"].includes(profile.role) ? (
            <div className="flex items-center gap-2">
              <PortalLinkButton contactId={contact.id} className="h-8 px-3 text-[13px]" />
              <CustomerActions
                customer={{
                  id: contact.id,
                  name: contact.name,
                  email: contact.email,
                  phone: contact.phone,
                  address: contact.address,
                }}
              />
            </div>
          ) : null
        }
      />
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-labelledby="customer-projects">
          <h2
            id="customer-projects"
            className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2 text-sm font-semibold text-[var(--color-heading)]"
          >
            Projects <Tag>{contact.projectCount}</Tag>
          </h2>
          {contact.projects.map((project) => (
            <article
              key={project.id}
              className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5"
            >
              <Link
                href={`/jobs/${project.id}`}
                prefetch={false}
                aria-label={`Open ${project.name}`}
                className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--color-surface-2)] text-[var(--color-faint)]"
              >
                {previews[project.id]?.[0] ? (
                  <ProjectMediaPreview
                    src={`/api/jobs/${project.id}/media/${previews[project.id][0].id}`}
                    alt={project.name}
                    video={previews[project.id][0].media_type === "video"}
                  />
                ) : (
                  NAV_ICONS["/projects"]
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/jobs/${project.id}`}
                  prefetch={false}
                  className="text-[13px] font-semibold text-[var(--color-heading)] hover:underline"
                >
                  {project.name}
                </Link>
                {project.address && (
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {project.address}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {project.archived_at && <Tag>Archived</Tag>}
                {project.labels.map((label) => (
                  <LabelChip key={label.id} label={label} />
                ))}
              </div>
            </article>
          ))}
          {!contact.projects.length && <EmptyState>No projects yet.</EmptyState>}
          {pages > 1 && (
            <nav
              aria-label="Customer project pages"
              className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--color-muted)]"
            >
              {page > 1 && (
                <Link
                  href={`/contacts/${id}?page=${page - 1}`}
                  className={buttonClassName({ variant: "secondary", size: "sm" })}
                >
                  Previous
                </Link>
              )}
              <span className="tabular-nums">
                Page {page} of {pages}
              </span>
              {page < pages && (
                <Link
                  href={`/contacts/${id}?page=${page + 1}`}
                  className={buttonClassName({ variant: "secondary", size: "sm" })}
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </section>
        <aside aria-labelledby="customer-details">
          <h2
            id="customer-details"
            className="border-b border-[var(--color-border)] pb-2 text-sm font-semibold text-[var(--color-heading)]"
          >
            Details
          </h2>
          <dl>
            {(
              [
                ["Email", contact.email ? <a href={`mailto:${contact.email}`} className="break-all hover:underline">{contact.email}</a> : null],
                ["Phone", contact.phone ? <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a> : null],
                ["Address", contact.address ? <span className="whitespace-pre-line">{contact.address}</span> : null],
                ["Notes", contact.notes ? <span className="whitespace-pre-wrap">{contact.notes}</span> : null],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex min-h-9 items-start justify-between gap-4 border-b border-[var(--color-border)] py-2"
              >
                <dt className="shrink-0 text-xs text-[var(--color-muted)]">{label}</dt>
                <dd className="min-w-0 text-right text-[13px] text-[var(--color-text)]">
                  {value ?? <span className="text-[var(--color-faint)]">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </section>
  );
}
