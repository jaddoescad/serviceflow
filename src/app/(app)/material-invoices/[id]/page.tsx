import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/kpi";
import { Badge, Card, CardHeader, Stat, StatGrid } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { materialClassificationLabel } from "@/lib/material-classification";
import { getMaterialInvoice } from "@/lib/materials";

export const dynamic = "force-dynamic";

function money(value: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(value);
}

function evidenceUrl(
  signedUrl: string | null,
  pageStart: number | null,
) {
  if (!signedUrl || !pageStart || pageStart <= 1) return signedUrl;
  return `${signedUrl}#page=${pageStart}`;
}

function pageLabel(pageStart: number | null, pageEnd: number | null) {
  if (!pageStart || !pageEnd) return null;
  return pageStart === pageEnd ? `Page ${pageStart}` : `Pages ${pageStart}-${pageEnd}`;
}

export default async function MaterialInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoiceId = decodeURIComponent(id);
  const [, invoice] = await Promise.all([
    requireStaff(),
    getMaterialInvoice(invoiceId),
  ]);
  if (!invoice) notFound();

  const settled = Math.abs(invoice.amountRemaining) <= 0.02;
  const allocated =
    Math.abs(invoice.jobAllocatedTotal - invoice.totalAmount) <= 0.02;
  const primarySourceUrl = evidenceUrl(
    invoice.document.signedUrl,
    invoice.document.sourcePageStart,
  );
  const supportingEvidence = invoice.evidence.filter(
    (evidence) => evidence.role !== "primary_invoice",
  );

  return (
    <>
      <div className="mb-4">
        <Link
          href="/material-invoices"
          className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline"
        >
          ← Material invoices
        </Link>
      </div>
      <PageHeader
        title={`${invoice.supplierName} · Invoice #${invoice.invoiceNumber}`}
        subtitle={`${fmtDate(invoice.invoiceDate)} · ${invoice.documentFilename}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={allocated ? "good" : "warn"}>
              {allocated ? "Fully classified" : "Needs job"}
            </Badge>
            <Badge tone={settled ? "good" : "warn"}>
              {settled
                ? invoice.totalAmount < 0
                  ? "Credit applied"
                  : "Settled"
                : "Open"}
            </Badge>
          </div>
        }
      />

      <div className="space-y-4">
        <Card className="overflow-hidden">
          <StatGrid columns={4}>
            <Stat
              label="Before HST"
              value={money(invoice.amountBeforeTax, invoice.currency)}
            />
            <Stat
              label="HST"
              value={money(invoice.taxAmount, invoice.currency)}
            />
            <Stat
              label="Invoice total"
              value={money(invoice.totalAmount, invoice.currency)}
            />
            <Stat
              label="Amount open"
              value={money(invoice.amountRemaining, invoice.currency)}
              tone={settled ? "good" : "warn"}
              hint={
                invoice.creditAppliedAmount
                  ? `${money(invoice.creditAppliedAmount)} supplier credit applied`
                  : undefined
              }
            />
          </StatGrid>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Invoice lines and cost classification"
            subtitle="Every product line stays tied to its source invoice; general paint supplies remain separate from job-specific costs"
            right={<Badge tone="neutral">{invoice.lines.length} lines</Badge>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-[13px]">
              <thead className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="px-4 py-2.5 font-medium">Description / colour</th>
                  <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-4 py-2.5 text-right font-medium">Before HST</th>
                  <th className="px-4 py-2.5 text-right font-medium">HST</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 font-medium">Job / classification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {invoice.lines.map((line) => (
                  <tr key={line.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-heading)]">
                        {line.salesNumber ?? line.productCode ?? `Line ${line.lineNumber}`}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                        {[line.size, line.productCode].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="max-w-[360px] px-4 py-3">
                      <div>{line.description}</div>
                      {line.colorName || line.colorCode ? (
                        <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                          {[line.colorCode, line.colorName].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {line.quantity ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(line.amountBeforeTax, invoice.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
                      {money(line.taxAmount, invoice.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {money(line.totalAmount, invoice.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {line.allocations.length ? (
                        <div className="flex flex-col gap-1">
                          {line.allocations.map((allocation) =>
                            allocation.projectId ? (
                              <Link
                                key={allocation.id}
                                href={`/projects/${encodeURIComponent(allocation.projectId)}/invoices`}
                                className="font-medium text-[var(--color-brand-strong)] hover:underline"
                              >
                                {allocation.projectName ?? allocation.projectId}
                              </Link>
                            ) : (
                              <span key={allocation.id} className="text-[var(--color-muted)]">
                                {materialClassificationLabel(allocation.overheadCategory)}
                              </span>
                            ),
                          )}
                        </div>
                      ) : (
                        <Badge tone="warn">Needs job</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Settlement evidence"
            subtitle="Bank rows and supplier credits allocated to this invoice"
            right={
              <Badge tone={settled ? "good" : "warn"}>
                {money(
                  invoice.paidAmount +
                    invoice.creditAppliedAmount +
                    invoice.creditUsedAmount,
                  invoice.currency,
                )}{" "}
                allocated
              </Badge>
            }
          />
          {invoice.payments.length || invoice.creditsIn.length || invoice.creditsOut.length ? (
            <div className="divide-y divide-[var(--color-border)]">
              {invoice.payments.map((payment) => (
                <Link
                  key={payment.id}
                  href={`/financials/transactions/${encodeURIComponent(payment.transactionId)}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-[var(--color-surface-2)]"
                >
                  <span>
                    <span className="font-medium text-[var(--color-heading)]">
                      {fmtDate(payment.postedOn)} · {payment.counterparty ?? payment.description}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                      {payment.evidenceReference ?? "Bank allocation"}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {money(payment.allocatedAmount, invoice.currency)}
                  </span>
                </Link>
              ))}
              {invoice.creditsIn.map((credit) => (
                <Link
                  key={credit.id}
                  href={`/material-invoices/${encodeURIComponent(credit.creditInvoiceId)}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-[var(--color-surface-2)]"
                >
                  <span>
                    <span className="font-medium text-[var(--color-heading)]">
                      Credit #{credit.creditInvoiceNumber} · {fmtDate(credit.creditInvoiceDate)}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                      {credit.evidenceReference ?? "Supplier credit"}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {money(credit.allocatedAmount, invoice.currency)}
                  </span>
                </Link>
              ))}
              {invoice.creditsOut.map((credit) => (
                <Link
                  key={credit.id}
                  href={`/material-invoices/${encodeURIComponent(credit.chargeInvoiceId)}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-[var(--color-surface-2)]"
                >
                  <span>
                    <span className="font-medium text-[var(--color-heading)]">
                      Applied to invoice #{credit.chargeInvoiceNumber} · {fmtDate(credit.chargeInvoiceDate)}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                      {credit.evidenceReference ?? "Supplier credit allocation"}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {money(credit.allocatedAmount, invoice.currency)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-5 py-8 text-sm text-[var(--color-muted)]">
              No bank payment or supplier credit is allocated yet.
            </p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title={
              invoice.document.sourceSystem === "derived_sherwin_invoice_pdf"
                ? "Invoice-specific source"
                : "Original supplier document"
            }
            subtitle={`${invoice.document.label} · ${invoice.document.originalFilename} · SHA-256 ${invoice.document.contentSha256.slice(0, 16)}…`}
            right={
              primarySourceUrl ? (
                <a
                  href={primarySourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
                >
                  Open invoice PDF
                </a>
              ) : null
            }
          />
          {primarySourceUrl ? (
            <iframe
              src={primarySourceUrl}
              title={`Material invoice ${invoice.invoiceNumber}`}
              className="h-[680px] w-full bg-white"
            />
          ) : (
            <p className="px-5 py-8 text-sm text-[var(--color-muted)]">
              The archived source file is unavailable.
            </p>
          )}
        </Card>

        {invoice.portalRecord || supportingEvidence.length ? (
          <Card className="overflow-hidden">
            <CardHeader
              title="Supporting evidence"
              subtitle="Portal confirmation and unchanged source batches remain separate from the invoice-specific PDF"
              right={<Badge tone="neutral">{supportingEvidence.length} files</Badge>}
            />
            <div className="divide-y divide-[var(--color-border)]">
              {invoice.portalRecord ? (
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="font-medium text-[var(--color-heading)]">
                      Sherwin PRO+ portal row {invoice.portalRecord.rowNumber}
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      Store {invoice.portalRecord.storeNumber} · {invoice.portalRecord.portalType} · PO {invoice.portalRecord.poNumber || "not entered"}
                    </div>
                    {invoice.portalRecord.matchDifferences.length ? (
                      <div className="mt-2 text-xs text-[var(--color-warn)]">
                        Portal and physical source differ on {invoice.portalRecord.matchDifferences
                          .map((difference) => difference.field ?? "one field")
                          .join(", ")}; both values remain preserved.
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-[var(--color-good)]">
                        Invoice number, date, PO, and total match the physical source.
                      </div>
                    )}
                  </div>
                  <Badge
                    tone={
                      invoice.portalRecord.matchStatus === "matched" ? "good" : "warn"
                    }
                  >
                    {money(invoice.portalRecord.totalAmount, invoice.currency)}
                  </Badge>
                </div>
              ) : null}
              {supportingEvidence.map((evidence) => {
                const sourceUrl = evidenceUrl(
                  evidence.signedUrl,
                  evidence.sourcePageStart,
                );
                const pages = pageLabel(
                  evidence.sourcePageStart,
                  evidence.sourcePageEnd,
                );
                return (
                  <div
                    key={evidence.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div>
                      <div className="font-medium text-[var(--color-heading)]">
                        {evidence.label}
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-muted)]">
                        {[evidence.originalFilename, pages, `SHA-256 ${evidence.contentSha256.slice(0, 16)}…`]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
                      >
                        {evidence.role === "portal_export" ? "Open CSV" : "Open batch source"}
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
