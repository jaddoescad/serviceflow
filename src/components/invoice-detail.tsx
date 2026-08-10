import Link from "next/link";
import { Card, EmptyState, StatusText, cn } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import {
  invoiceReadinessLabel,
  invoiceReadinessTone,
  type InvoiceReadinessCheck,
} from "@/lib/invoice-readiness";

type InvoiceDetailProps = {
  invoice: any;
};

function money(cents: number | string | null | undefined, currency = "CAD") {
  const value = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function label(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusTone(status: string | null | undefined): "neutral" | "good" | "warn" | "bad" {
  if (["paid", "settled", "complete"].includes(status ?? "")) return "good";
  if (["open", "unpaid", "partially_paid", "needs_review"].includes(status ?? "")) return "warn";
  if (["void", "rejected", "reversed"].includes(status ?? "")) return "bad";
  return "neutral";
}

function canPreview(document: any) {
  const mimeType = String(document?.mime_type ?? "").toLowerCase();
  const filename = String(document?.original_filename ?? "").toLowerCase();
  return (
    mimeType === "application/pdf" ||
    mimeType.startsWith("image/") ||
    /\.(pdf|png|jpe?g|webp)$/.test(filename)
  );
}

const checkStatusLabel: Record<InvoiceReadinessCheck["status"], string> = {
  pass: "Pass",
  pending: "Pending",
  fail: "Needs review",
};

const checkStatusTone: Record<InvoiceReadinessCheck["status"], "neutral" | "good" | "warn"> = {
  pass: "good",
  pending: "neutral",
  fail: "warn",
};

function ReadinessCard({ invoice }: InvoiceDetailProps) {
  const readiness = invoice.readiness;
  if (!readiness) return null;
  const isVoid = readiness.state === "void";

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-[var(--color-border)] px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
            Readiness
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{readiness.reason}</p>
        </div>
        <div className="flex shrink-0 items-baseline gap-3">
          {!isVoid ? (
            <span className="text-xs tabular-nums text-[var(--color-muted)]">
              {readiness.passedCheckCount} of {readiness.checks.length} checks passed
            </span>
          ) : null}
          <StatusText tone={invoiceReadinessTone(readiness.state)} className="text-sm">
            {invoiceReadinessLabel(readiness.state)}
          </StatusText>
        </div>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {readiness.checks.map((check: InvoiceReadinessCheck) => (
          <div
            key={check.key}
            className="flex items-baseline justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <div
                className={cn(
                  "text-sm font-medium",
                  isVoid ? "text-[var(--color-muted)]" : "text-[var(--color-heading)]",
                )}
              >
                {check.label}
              </div>
              <div className="mt-0.5 text-xs leading-5 text-[var(--color-muted)]">
                {check.detail}
              </div>
            </div>
            <StatusText
              tone={isVoid ? "neutral" : checkStatusTone[check.status]}
              className={cn("shrink-0", isVoid && "text-[var(--color-muted)]")}
            >
              {isVoid ? "Informational" : checkStatusLabel[check.status]}
            </StatusText>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SourceDocument({ invoice }: InvoiceDetailProps) {
  const evidence = invoice.evidence ?? [];
  const primary =
    evidence.find((item: any) => item.evidence_role === "primary_invoice") ??
    evidence.find((item: any) => item.document?.signed_url) ??
    evidence[0] ??
    null;
  const document = primary?.document ?? null;
  const sourceUrl = document?.signed_url ?? document?.source_url ?? null;
  const additional = evidence.filter((item: any) => item.id !== primary?.id);

  return (
    <Card className="overflow-hidden xl:sticky xl:top-5">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
            Source invoice
          </h2>
          <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
            {document?.original_filename ?? "No archived source document"}
          </p>
        </div>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open source invoice ${invoice.invoice_number} in a new tab`}
            className="shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-strong)] hover:bg-[var(--color-brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          >
            Open original ↗
          </a>
        ) : null}
      </div>

      {sourceUrl && canPreview(document) ? (
        <iframe
          src={`${sourceUrl}#view=FitH`}
          title={`Source invoice ${invoice.invoice_number}`}
          className="h-[620px] w-full bg-white xl:h-[calc(100vh-12rem)] xl:min-h-[680px] xl:max-h-[980px]"
        />
      ) : sourceUrl ? (
        <div className="flex min-h-64 items-center justify-center px-6 text-center">
          <div>
            <p className="text-sm font-medium text-[var(--color-heading)]">
              This file cannot be previewed in the browser.
            </p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Open the archived original to view or download it.
            </p>
          </div>
        </div>
      ) : (
        <EmptyState>No source document is linked to this invoice.</EmptyState>
      )}

      {additional.length ? (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Additional documents
          </div>
          <div className="mt-2 space-y-1.5">
            {additional.map((item: any) => {
              const extraDocument = item.document;
              const extraUrl = extraDocument?.signed_url ?? extraDocument?.source_url;
              return extraUrl ? (
                <a
                  key={item.id}
                  href={extraUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${extraDocument?.original_filename ?? label(item.evidence_role)} in a new tab`}
                  className="block truncate text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
                >
                  {extraDocument?.original_filename ?? label(item.evidence_role)} ↗
                </a>
              ) : (
                <span key={item.id} className="block truncate text-xs text-[var(--color-muted)]">
                  {extraDocument?.original_filename ?? label(item.evidence_role)}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function JobAllocation({ allocations, currency }: { allocations: any[]; currency: string }) {
  if (!allocations.length) {
    return <span className="text-xs text-[var(--color-muted)]">No job allocation recorded</span>;
  }

  return (
    <div className="space-y-2">
      {allocations.map((allocation: any) => (
        <div key={allocation.id}>
          <Link
            href={`/jobs/${encodeURIComponent(allocation.job_id)}`}
            className="font-medium text-[var(--color-brand-strong)] hover:underline"
          >
            {allocation.job?.name ?? allocation.job_id}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-muted)]">
            <span>{money(allocation.subtotal_cents ?? allocation.total_cents, currency)} pre-HST</span>
            {allocation.needs_review ? (
              <span className="font-medium text-[var(--color-warn)]">Needs review</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function InvoiceAssociations({
  allocations,
  payments,
  currency,
}: {
  allocations: any[];
  payments: any[];
  currency: string;
}) {
  return (
    <section
      id="invoice-level-associations"
      aria-labelledby="invoice-level-associations-title"
      className="border-t border-[var(--color-border)]"
    >
      <div className="px-4 py-3.5">
        <h3
          id="invoice-level-associations-title"
          className="font-display text-sm font-semibold text-[var(--color-heading)]"
        >
          Invoice-level associations
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted)]">
          These records apply to the invoice as a whole. No line-level split is implied.
        </p>
      </div>
      <div className="grid border-t border-[var(--color-border)] md:grid-cols-2 md:divide-x md:divide-[var(--color-border)]">
        <div className="px-4 py-3.5">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Jobs not split by line
          </div>
          <JobAllocation allocations={allocations} currency={currency} />
        </div>
        <div className="border-t border-[var(--color-border)] px-4 py-3.5 md:border-t-0">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Bank transactions
          </div>
          <BankMatches payments={payments} currency={currency} />
        </div>
      </div>
    </section>
  );
}

function BankMatches({ payments, currency }: { payments: any[]; currency: string }) {
  if (!payments.length) {
    return <span className="text-xs text-[var(--color-muted)]">No bank transaction linked</span>;
  }

  return (
    <div className="space-y-2">
      {payments.map((payment: any) => {
        const transaction = Array.isArray(payment.transaction)
          ? payment.transaction[0]
          : payment.transaction;
        if (!transaction) return null;
        const account = Array.isArray(transaction.account)
          ? transaction.account[0]
          : transaction.account;
        return (
          <div key={payment.id}>
            <Link
              href={`/financials/transactions/${encodeURIComponent(transaction.id)}`}
              className="font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              {fmtDate(transaction.posted_on)} · {transaction.counterparty ?? transaction.description}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-muted)]">
              <span>{money(payment.amount_cents, currency)} allocated</span>
              {account ? <span>{account.name}{account.last_four ? ` · •••• ${account.last_four}` : ""}</span> : null}
              <span>Whole invoice</span>
              {payment.needs_review ? (
                <span className="font-medium text-[var(--color-warn)]">Needs review</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LineItems({ invoice }: InvoiceDetailProps) {
  const lines = invoice.lines ?? [];
  const allocations = invoice.allocations ?? [];
  const invoiceAllocations = allocations.filter((allocation: any) => !allocation.invoice_line_id);
  const payments = (invoice.payments ?? []).filter(
    (payment: any) => !payment.reversed_at && payment.transaction,
  );
  const currency = invoice.currency ?? "CAD";

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--color-border)] px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
            Line allocation
          </h2>
          <span className="text-xs tabular-nums text-[var(--color-muted)]">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
        </div>
      </div>

      {lines.length ? (
        <>
          <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[640px] table-fixed text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="w-[48%] px-4 py-2.5 font-medium">Line item</th>
                <th className="w-[36%] px-4 py-2.5 font-medium">Job</th>
                <th className="w-[12%] px-4 py-2.5 text-right font-medium">Pre-HST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {lines.map((line: any) => {
                const lineAllocations = allocations.filter(
                  (allocation: any) => allocation.invoice_line_id === line.id,
                );
                const quantity = line.quantity == null
                  ? null
                  : `${Number(line.quantity).toLocaleString("en-CA")}${line.unit ? ` ${line.unit}` : ""}`;
                return (
                  <tr key={line.id} className="align-top">
                    <td className="px-4 py-3.5">
                      <div className="font-medium leading-5 text-[var(--color-heading)]">
                        {line.description}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[var(--color-muted)]">
                        <span>Line {line.line_number}</span>
                        {quantity ? <span>{quantity}</span> : null}
                        {line.unit_price_cents != null ? (
                          <span>{money(line.unit_price_cents, currency)} each</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {lineAllocations.length ? (
                        <JobAllocation allocations={lineAllocations} currency={currency} />
                      ) : invoiceAllocations.length ? (
                        <a
                          href="#invoice-level-associations"
                          className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
                        >
                          Allocated at invoice level ↓
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">No job allocation recorded</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-[var(--color-heading)]">
                      {money(line.subtotal_cents ?? line.total_cents, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] text-sm">
              <tr>
                <th colSpan={2} className="px-4 pt-3 text-right text-xs font-medium text-[var(--color-muted)]">Subtotal (pre-HST)</th>
                <td className="px-4 pt-3 text-right tabular-nums">{money(invoice.subtotal_cents, currency)}</td>
              </tr>
              <tr>
                <th colSpan={2} className="px-4 py-1 text-right text-xs font-medium text-[var(--color-muted)]">Tax</th>
                <td className="px-4 py-1 text-right tabular-nums">{money(invoice.tax_cents, currency)}</td>
              </tr>
              <tr>
                <th colSpan={2} className="px-4 pb-3 text-right font-semibold text-[var(--color-heading)]">Invoice total</th>
                <td className="px-4 pb-3 text-right font-semibold tabular-nums text-[var(--color-heading)]">{money(invoice.total_cents, currency)}</td>
              </tr>
            </tfoot>
          </table>
          </div>

          <div className="divide-y divide-[var(--color-border)] sm:hidden">
            {lines.map((line: any) => {
              const lineAllocations = allocations.filter(
                (allocation: any) => allocation.invoice_line_id === line.id,
              );
              const quantity = line.quantity == null
                ? null
                : `${Number(line.quantity).toLocaleString("en-CA")}${line.unit ? ` ${line.unit}` : ""}`;
              return (
                <div key={line.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium leading-5 text-[var(--color-heading)]">{line.description}</div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[var(--color-muted)]">
                        <span>Line {line.line_number}</span>
                        {quantity ? <span>{quantity}</span> : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-semibold tabular-nums text-[var(--color-heading)]">
                      <div>{money(line.subtotal_cents ?? line.total_cents, currency)}</div>
                      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                        Pre-HST
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Job</div>
                    {lineAllocations.length ? (
                      <JobAllocation allocations={lineAllocations} currency={currency} />
                    ) : invoiceAllocations.length ? (
                      <a href="#invoice-level-associations" className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline">
                        Allocated at invoice level ↓
                      </a>
                    ) : (
                      <span className="text-xs text-[var(--color-muted)]">No job allocation recorded</span>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="bg-[var(--color-surface-2)] px-4 py-3 text-sm">
              <div className="flex justify-between gap-4 text-xs text-[var(--color-muted)]"><span>Subtotal (pre-HST)</span><span className="tabular-nums">{money(invoice.subtotal_cents, currency)}</span></div>
              <div className="mt-1 flex justify-between gap-4 text-xs text-[var(--color-muted)]"><span>Tax</span><span className="tabular-nums">{money(invoice.tax_cents, currency)}</span></div>
              <div className="mt-2 flex justify-between gap-4 font-semibold text-[var(--color-heading)]"><span>Invoice total</span><span className="tabular-nums">{money(invoice.total_cents, currency)}</span></div>
            </div>
          </div>
        </>
      ) : (
        <EmptyState>No line items are recorded for this invoice.</EmptyState>
      )}
      <InvoiceAssociations
        allocations={invoiceAllocations}
        payments={payments}
        currency={currency}
      />
    </Card>
  );
}

export function InvoiceDetail({ invoice }: InvoiceDetailProps) {
  const currency = invoice.currency ?? "CAD";
  const labourReadiness = invoice.category === "labour" ? invoice.readiness : null;
  const displayedPaidCents = labourReadiness?.matchedPaidCents ?? invoice.paid_cents;
  const displayedBalanceCents =
    labourReadiness?.remainingBalanceCents ?? invoice.balance_cents;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/invoices" className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline">
          ← Invoices
        </Link>
      </nav>

      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Invoice #{invoice.invoice_number}
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
            {invoice.contact?.name ?? "Unassigned supplier"}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-muted)]">
            <span>Issued {fmtDate(invoice.issued_on)}</span>
            {invoice.due_on ? <span>Due {fmtDate(invoice.due_on)}</span> : null}
            <span>{label(invoice.direction)}</span>
            <span>{label(invoice.category)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <StatusText tone={statusTone(invoice.status)} className="text-sm">
            {label(invoice.status)}
          </StatusText>
          <dl className="flex gap-5">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                {labourReadiness ? "Matched" : "Paid"}
              </dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-[var(--color-heading)]">{money(displayedPaidCents, currency)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Balance</dt>
              <dd className={`mt-0.5 font-semibold tabular-nums ${Number(displayedBalanceCents) > 0 ? "text-[var(--color-warn)]" : "text-[var(--color-good)]"}`}>
                {money(displayedBalanceCents, currency)}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      {invoice.category === "labour" ? <ReadinessCard invoice={invoice} /> : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(420px,0.85fr)_minmax(640px,1.15fr)]">
        <SourceDocument invoice={invoice} />
        <LineItems invoice={invoice} />
      </div>
    </>
  );
}
