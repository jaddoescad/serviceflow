import Link from "next/link";
import type { LabourInvoiceRecord } from "@/lib/invoice-queries";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";

function money(value: number | null, currency: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(value);
}

function statusLabel(status: string) {
  return {
    matched: "Matched",
    matched_multiple: "Multiple jobs",
    unmatched: "Unmatched",
    overhead_unmatched: "Overhead / no job",
    supporting_document: "Supporting document",
    not_invoice: "Not an invoice",
  }[status] ?? status.replaceAll("_", " ");
}

function statusTone(status: string): "neutral" | "good" | "warn" | "bad" | "brand" {
  if (status === "matched") return "good";
  if (status === "matched_multiple") return "brand";
  if (status === "unmatched") return "bad";
  if (status === "overhead_unmatched") return "warn";
  return "neutral";
}

export function LabourInvoicesTable({
  invoices,
  title = "Invoice archive",
  subtitle = "Private source files, gross amounts paid, and CompanyCam job associations",
  showAssociatedJobs = true,
}: {
  invoices: LabourInvoiceRecord[];
  title?: string;
  subtitle?: string;
  showAssociatedJobs?: boolean;
}) {
  if (!invoices.length) {
    return (
      <Card>
        <EmptyState>No labour invoices have been archived yet.</EmptyState>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={title}
        subtitle={subtitle}
        right={<Badge tone="neutral">{invoices.length} files</Badge>}
      />
      <div className="overflow-x-auto">
        <table
          className={`w-full text-left text-sm ${
            showAssociatedJobs ? "min-w-[1280px]" : "min-w-[980px]"
          }`}
        >
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Supplier / invoice</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">HST</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              {showAssociatedJobs ? (
                <th className="px-4 py-3 font-medium">Associated job</th>
              ) : null}
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="align-top hover:bg-[var(--color-surface-2)]">
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[var(--color-muted)]">
                  {invoice.invoice_date ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-[var(--color-heading)]">
                    {invoice.supplier_name}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    #{invoice.invoice_number}
                  </div>
                  {invoice.duplicate_group_size > 1 ? (
                    <div className="mt-1">
                      <Badge tone="warn">
                        {invoice.duplicate_group_size} files in duplicate/version group
                      </Badge>
                    </div>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {money(invoice.amount_before_tax, invoice.currency)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {money(invoice.tax_amount, invoice.currency)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                  {money(invoice.amount_paid, invoice.currency)}
                </td>
                {showAssociatedJobs ? (
                  <td className="max-w-[300px] px-4 py-3">
                    {invoice.labour_invoice_projects.length ? (
                      <div className="space-y-1.5">
                        {invoice.labour_invoice_projects.map((link) => (
                          <div key={link.companycam_project_id}>
                            <Link
                              href={`/projects/${encodeURIComponent(link.companycam_project_id)}`}
                              className="font-medium text-[var(--color-brand-strong)] hover:underline"
                            >
                              {link.companycam_projects?.name ?? link.companycam_project_id}
                            </Link>
                            {link.needs_review ? (
                              <span className="ml-2">
                                <Badge tone="warn">Review</Badge>
                              </span>
                            ) : null}
                            {link.companycam_projects?.formatted_address ? (
                              <div className="text-xs text-[var(--color-muted)]">
                                {link.companycam_projects.formatted_address}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                ) : null}
                <td className="px-4 py-3">
                  <Badge tone={statusTone(invoice.match_status)}>
                    {statusLabel(invoice.match_status)}
                  </Badge>
                </td>
                <td className="max-w-[260px] px-4 py-3">
                  {invoice.signed_url ? (
                    <a
                      href={invoice.signed_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-medium text-[var(--color-brand-strong)] hover:underline"
                      title={invoice.original_filename}
                    >
                      Open invoice
                    </a>
                  ) : (
                    <span className="text-[var(--color-muted)]">Unavailable</span>
                  )}
                  <div
                    className="mt-0.5 max-w-[240px] truncate text-xs text-[var(--color-muted)]"
                    title={invoice.original_filename}
                  >
                    {invoice.original_filename}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
