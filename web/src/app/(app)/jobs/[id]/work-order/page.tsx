import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getWorkOrder } from "@/lib/billing";
import { fmtDate } from "@/lib/format";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-medium text-[var(--color-muted)]">{title}</h2>
      <div className="mt-1.5 text-[13px]">{children}</div>
    </section>
  );
}

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  await requireStaff();
  const order = await getWorkOrder(jobId);
  if (!order) notFound();
  const { contact } = order;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/jobs/${encodeURIComponent(jobId)}`}
          className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--color-muted)] hover:text-[var(--color-heading)]"
        >
          <span aria-hidden="true">‹</span>
          <span className="truncate">{order.name}</span>
        </Link>
        <PrintButton />
      </div>
      <Card className="space-y-6 p-5 sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-[var(--color-border)] pb-5">
          <div className="min-w-0">
            <div className="text-xs font-medium text-[var(--color-muted)]">Work order</div>
            <h1 className="mt-1 text-lg font-semibold text-[var(--color-heading)]">{order.name}</h1>
            {order.address ? <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{order.address}</p> : null}
          </div>
          <div className="text-[13px] sm:text-right">
            <div className="font-semibold text-[var(--color-heading)]">
              {order.scheduledOn
                ? `${fmtDate(order.scheduledOn)}${order.scheduledEndOn && order.scheduledEndOn !== order.scheduledOn ? ` – ${fmtDate(order.scheduledEndOn)}` : ""}`
                : "Not scheduled"}
            </div>
            {order.crew.length ? <div className="mt-0.5 text-[var(--color-muted)]">Crew: {order.crew.join(", ")}</div> : null}
          </div>
        </header>
        {contact ? (
          <Section title="Customer">
            <span className="font-medium text-[var(--color-heading)]">{contact.name}</span>
            {contact.phone ? ` · ${contact.phone}` : ""}
            {contact.email ? ` · ${contact.email}` : ""}
          </Section>
        ) : null}
        <Section title={order.proposalName ? `Scope · ${order.proposalName}` : "Scope"}>
          {order.scope.length ? (
            <ol className="space-y-3">
              {order.scope.map((item) => (
                <li key={`${item.changeOrder ?? "proposal"}-${item.id}`} className="flex gap-3">
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-[var(--color-border-strong)]" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--color-heading)]">
                      {item.name}
                      {item.quantity !== 1 ? ` × ${item.quantity}` : ""}
                      {item.changeOrder != null ? (
                        <span className="font-normal text-[var(--color-muted)]"> (change order #{item.changeOrder})</span>
                      ) : null}
                    </div>
                    {item.description ? (
                      <p className="mt-0.5 whitespace-pre-line text-[var(--color-muted)]">{item.description}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[var(--color-muted)]">No accepted proposal on this job.</p>
          )}
        </Section>
        {order.notes.length ? (
          <Section title="Notes">
            <ul className="space-y-2">
              {order.notes.map((note) => (
                <li key={note.id} className="whitespace-pre-line">
                  {note.body}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </Card>
    </div>
  );
}
