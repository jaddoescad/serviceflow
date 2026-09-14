import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/kpi";
import { Badge, Card, EmptyState } from "@/components/ui";
import { getContactDetail, type ContactProject } from "@/lib/contacts";
import { fmtDate, fmtMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

function statusTone(status: string): "neutral" | "good" | "warn" | "brand" {
  const value = status.toLocaleLowerCase("en-CA");
  if (["completed", "won", "paid"].includes(value)) return "good";
  if (["scheduled", "active", "in_progress"].includes(value)) return "brand";
  if (["proposal_sent", "estimated", "estimate_scheduled"].includes(value)) return "warn";
  return "neutral";
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ProjectPhotos({ project }: { project: ContactProject }) {
  const images = project.media.filter((item) => item.mediaType === "image").slice(0, 3);
  if (!images.length) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs text-[var(--color-muted)]">
        {project.mediaCount > 0 ? "No image preview" : "No photos yet"}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {images.map((image) => (
        <div
          key={image.id}
          className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]"
        >
          <Image
            src={`/api/jobs/${encodeURIComponent(image.ownerProjectId)}/media/${encodeURIComponent(image.id)}`}
            alt=""
            fill
            unoptimized
            sizes="(max-width: 768px) 30vw, 180px"
            className="object-cover"
          />
        </div>
      ))}
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = await getContactDetail(decodeURIComponent(id));
  if (!contact) notFound();
  const jobs = contact.projects.filter((project) => project.kind === "job").length;
  const leads = contact.projects.length - jobs;

  return (
    <>
      <div className="mb-3">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-heading)]"
        >
          <span aria-hidden="true">‹</span>
          Contacts
        </Link>
      </div>
      <PageHeader
        title={contact.name}
        subtitle={`${jobs} ${jobs === 1 ? "job" : "jobs"} · ${leads} ${leads === 1 ? "deal" : "deals"}`}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="contact-projects-title">
          <div className="mb-3">
            <h2
              id="contact-projects-title"
              className="font-display text-lg font-semibold text-[var(--color-heading)]"
            >
              Deals & jobs
            </h2>
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">
              Each card is a separate deal or job with its own photos.
            </p>
          </div>

          {contact.projects.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {contact.projects.map((project) => (
                <Card key={`${project.kind}:${project.id}`} className="overflow-hidden">
                  <Link
                    href={`/jobs/${encodeURIComponent(project.id)}`}
                    className="block p-4 outline-none hover:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--color-heading)]">
                          {project.address || project.name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                          {project.kind === "job" && project.amount != null ? <span>{fmtMoney(project.amount)}</span> : null}
                        </div>
                      </div>
                      <Badge tone={project.kind === "job" ? statusTone(project.status) : "neutral"}>{project.kind === "job" ? statusLabel(project.status) : "Deal"}</Badge>
                    </div>

                    <div className="mt-4">
                      <ProjectPhotos project={project} />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--color-muted)]">
                      <span>{project.source || (project.kind === "job" ? "Job" : "Deal")}</span>
                      <span>
                        {project.mediaCount} {project.mediaCount === 1 ? "photo or video" : "photos and videos"} · {fmtDate(project.createdAt)}
                      </span>
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState>No deals or jobs are linked to this contact yet.</EmptyState>
            </Card>
          )}
        </section>

        <Card className="overflow-hidden xl:sticky xl:top-6">
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
              Contact details
            </h2>
          </div>
          <dl className="space-y-4 p-5 text-sm">
            {contact.address ? <div><dt className="text-xs font-medium text-[var(--color-muted)]">Address</dt><dd className="mt-1 text-[var(--color-heading)]">{contact.address}</dd></div> : null}
            <div>
              <dt className="text-xs font-medium text-[var(--color-muted)]">Email</dt>
              <dd className="mt-1 break-words text-[var(--color-heading)]">
                {contact.email || "No email"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[var(--color-muted)]">Phone</dt>
              <dd className="mt-1 text-[var(--color-heading)]">{contact.phone || "No phone"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[var(--color-muted)]">Customer since</dt>
              <dd className="mt-1 text-[var(--color-heading)]">{fmtDate(contact.createdAt)}</dd>
            </div>
            {contact.notes ? (
              <div>
                <dt className="text-xs font-medium text-[var(--color-muted)]">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-[var(--color-heading)]">
                  {contact.notes}
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </div>
    </>
  );
}
