import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceEvidence } from "@/components/settlement-evidence";
import { PageHeader, Kpi } from "@/components/kpi";
import { StatusText } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate, fmtHours } from "@/lib/format";
import { getInvoiceEntryEvidence } from "@/lib/settlements";

export const dynamic = "force-dynamic";

function evidenceLabel(sourceKind: string) {
  return {
    extracted: "Exact source entry",
    manual: "Manually entered",
    legacy_project_link: "Derived from job match",
    legacy_invoice_total: "Exact lines needed",
  }[sourceKind] ?? sourceKind.replaceAll("_", " ");
}

export default async function InvoiceEntryEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entryId = decodeURIComponent(id);
  const [, evidence] = await Promise.all([
    requireStaff(),
    getInvoiceEntryEvidence(entryId),
  ]);

  if (!evidence) notFound();

  const { entry, invoice } = evidence;
  const currency = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: invoice.verification.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const backendHours = entry.timeEntries.reduce(
    (total, timeEntry) => total + timeEntry.allocated_hours,
    0,
  );

  return (
    <>
      <div className="mb-4">
        <Link
          href="/invoices"
          className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline"
        >
          ← Invoices
        </Link>
      </div>
      <PageHeader
        title={entry.description}
        subtitle={`${invoice.verification.supplier_name} · Invoice #${
          invoice.verification.invoice_number
        } · ${fmtDate(invoice.verification.invoice_date)}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
            <StatusText
              tone={entry.entry_type === "unclassified" ? "bad" : "neutral"}
              className="capitalize"
            >
              {entry.entry_type.replaceAll("_", " ")}
            </StatusText>
            <StatusText
              tone={
                entry.source_kind === "extracted"
                  ? "good"
                  : entry.source_kind === "manual"
                    ? "brand"
                    : entry.source_kind === "legacy_project_link"
                      ? "warn"
                      : "bad"
              }
            >
              {evidenceLabel(entry.source_kind)}
            </StatusText>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Entry before HST"
          value={currency.format(entry.amount_before_tax)}
          hint={`entry ${entry.line_number} of ${invoice.lines.length}`}
        />
        <Kpi
          label="Invoice quantity"
          value={
            entry.quantity_hours != null
              ? fmtHours(entry.quantity_hours)
              : entry.quantity != null
                ? `${entry.quantity.toLocaleString("en-CA")} ${
                    entry.unit ?? ""
                  }`.trim()
                : "—"
          }
          hint={
            entry.hourly_rate != null
              ? `${currency.format(entry.hourly_rate)} per hour`
              : "as recorded on this entry"
          }
        />
        <Kpi
          label="Linked jobs"
          value={entry.jobs.length}
          hint={
            entry.jobs.length
              ? entry.jobs.map((job) => job.name).join(", ")
              : "no job allocation"
          }
          tone={entry.jobs.length ? "good" : "warn"}
        />
        <Kpi
          label="Backend hours"
          value={fmtHours(backendHours)}
          hint={`${entry.timeEntries.length} linked time ${
            entry.timeEntries.length === 1 ? "entry" : "entries"
          }`}
          tone={
            entry.quantity_hours == null ||
            Math.abs(entry.quantity_hours - backendHours) <= 0.0167
              ? "good"
              : "warn"
          }
        />
      </div>

      {entry.source_kind !== "extracted" &&
      entry.source_kind !== "manual" ? (
        <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          <span className="font-semibold">{evidenceLabel(entry.source_kind)}.</span>{" "}
          {entry.source_kind === "legacy_project_link"
            ? "This entry preserves an older invoice-to-job dollar match. Compare it with the original invoice below before treating its wording or classification as exact."
            : "This amount preserves the source invoice total, but the original document still needs to be split into its exact labour, material, bonus, or other entries."}
        </div>
      ) : null}

      <InvoiceEvidence
        invoice={invoice}
        highlightEntryId={entry.id}
      />
    </>
  );
}
