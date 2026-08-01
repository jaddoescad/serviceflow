import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  Stat,
  StatGrid,
  StatusText,
} from "@/components/ui";
import type {
  CustomerInvoiceEvidence,
  CustomerRevenueVerification,
  ProjectCustomerRevenue,
} from "@/lib/customer-revenue";
import { fmtDate } from "@/lib/format";
import type { InvoiceEntryRecord } from "@/lib/invoice-entry-queries";
import type { ProjectLabourInvoiceSummary } from "@/lib/invoice-queries";

const currency = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number) {
  return currency.format(Number(value));
}

function statusLabel(value: string) {
  return value
    .replace("fully_allocated", "Fully matched")
    .replace("partially_allocated", "Partially matched")
    .replace("partially_paid", "Partially paid")
    .replace("needs_information", "Needs information")
    .replace("needs_review", "Needs review")
    .replaceAll("_", " ")
    .replace(/^\w/, (character) => character.toUpperCase());
}

function invoiceTone(
  invoice: CustomerInvoiceEvidence,
): "good" | "warn" | "bad" {
  if (invoice.verification_status === "needs_information") return "bad";
  if (invoice.verification_status === "needs_review") return "warn";
  return "good";
}

function CustomerInvoiceDetails({
  invoice,
  currentTransactionId,
}: {
  invoice: CustomerInvoiceEvidence;
  currentTransactionId?: string;
}) {
  return (
    <details className="group border-t border-[var(--color-border)] first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--color-surface-2)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--color-heading)]">
              Invoice #{invoice.invoice_number}
            </span>
            <Badge tone={invoiceTone(invoice)}>
              {statusLabel(invoice.bank_payment_status)}
            </Badge>
          </div>
          <div className="mt-1 truncate text-xs text-[var(--color-muted)]">
            {invoice.customer_name} · {fmtDate(invoice.invoice_date)} · {invoice.job_address ?? invoice.billing_address ?? invoice.project_name}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-right">
          <div>
            <div className="font-semibold tabular-nums text-[var(--color-heading)]">
              {money(invoice.total_amount)}
            </div>
            <div className="text-xs tabular-nums text-[var(--color-muted)]">
              {money(invoice.bank_paid_amount)} credited to invoice
            </div>
          </div>
          <span className="text-[var(--color-muted)] transition-transform group-open:rotate-180">
            ▾
          </span>
        </div>
      </summary>

      <div className="space-y-4 bg-[var(--color-surface-2)] px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Amount label="Before HST" value={invoice.subtotal} />
          <Amount label="HST" value={invoice.tax_amount} />
          <Amount label="After HST" value={invoice.total_amount} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={invoiceTone(invoice)}>
            {statusLabel(invoice.verification_status)}
          </Badge>
          <span className="text-xs text-[var(--color-muted)]">
            DripJobs recorded {money(invoice.source_paid_amount)} paid · verified invoice credit {money(invoice.bank_paid_amount)} · bank cash {money(invoice.bank_cash_amount)}
          </span>
          {invoice.signed_url ? (
            <a
              href={invoice.signed_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              Open original PDF
            </a>
          ) : null}
          {invoice.source_url ? (
            <a
              href={invoice.source_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              Open in DripJobs
            </a>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Invoice item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Before HST</th>
                <th className="px-3 py-2 text-right font-medium">HST</th>
                <th className="px-3 py-2 text-right font-medium">After HST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {invoice.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 text-[var(--color-heading)]">
                    {item.description}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">
                    {item.quantity ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(item.amount_before_tax)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">
                    {money(item.tax_amount)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {money(item.total_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Bank income evidence
          </div>
          {invoice.bank_payments.length > 0 ? (
            <div className="space-y-2">
              {invoice.bank_payments.map((payment) => (
                <Link
                  key={payment.allocation_id}
                  href={`/financials/transactions/${encodeURIComponent(payment.transaction_id)}`}
                  className={`flex items-center justify-between gap-4 rounded-lg border px-3 py-2 text-xs hover:bg-[var(--color-brand-soft)] ${
                    currentTransactionId === payment.transaction_id
                      ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface)]"
                  }`}
                >
                  <span>
                    <span className="font-medium text-[var(--color-heading)]">
                      {fmtDate(payment.posted_on)} · {payment.account_name} •••• {payment.account_last_four ?? "—"}
                    </span>
                    <span className="ml-2 text-[var(--color-muted)]">
                      {payment.description}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-[var(--color-good)]">
                    {money(payment.allocated_amount)} bank cash
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-3 text-xs text-[var(--color-warn)]">
              No incoming bank row has been allocated to this invoice yet.
            </div>
          )}
        </div>

        {invoice.document ? (
          <div className="text-[11px] text-[var(--color-muted)]">
            Source: {invoice.document.original_filename} · SHA-256 {invoice.document.content_sha256.slice(0, 16)}…
          </div>
        ) : null}
      </div>
    </details>
  );
}

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className="mt-1 font-display text-lg font-semibold tabular-nums text-[var(--color-heading)]">
        {money(value)}
      </div>
    </div>
  );
}

function ChainStage({
  label,
  value,
  detail,
  state,
}: {
  label: string;
  value: string;
  detail: string;
  state: "complete" | "partial" | "missing";
}) {
  return (
    <div className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          {label}
        </span>
        <Badge tone={state === "complete" ? "good" : state === "partial" ? "warn" : "bad"}>
          {state === "complete" ? "Linked" : state === "partial" ? "Review" : "Missing"}
        </Badge>
      </div>
      <div className="mt-2 font-display text-xl font-semibold tabular-nums text-[var(--color-heading)]">
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--color-muted)]">{detail}</div>
    </div>
  );
}

export function JobAccountingChain({
  revenue,
  labourEntries,
  labourSummary,
}: {
  revenue: ProjectCustomerRevenue;
  labourEntries: InvoiceEntryRecord[];
  labourSummary: ProjectLabourInvoiceSummary;
}) {
  const labourInvoices = [
    ...new Map(
      labourEntries.map((entry) => [entry.invoice.id, entry.invoice]),
    ).values(),
  ];
  const labourPayments = [
    ...new Map(
      labourInvoices.flatMap((invoice) =>
        invoice.payments.map((payment) => [
          payment.financial_transaction_id,
          payment,
        ] as const),
      ),
    ).values(),
  ];
  const revenuePaid = revenue.invoice_total > 0 && revenue.amount_remaining <= 0.005;
  const labourPaid =
    labourSummary.invoiceCount > 0 &&
    labourSummary.confirmedUnpaidTotals.CAD <= 0.005 &&
    labourSummary.partialSettlementTotals.CAD <= 0.005;

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader
        title="Job accounting chain"
        subtitle="Customer invoice → income in bank → subcontractor invoice → payment to subcontractor"
        right={
          <Badge
            tone={
              revenue.invoices.length > 0 &&
              revenuePaid &&
              labourInvoices.length > 0 &&
              labourPaid
                ? "good"
                : "warn"
            }
          >
            Evidence linked by job
          </Badge>
        }
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <ChainStage
          label="1 · Customer invoice"
          value={money(revenue.invoice_total)}
          detail={`${revenue.invoices.length} original invoice${revenue.invoices.length === 1 ? "" : "s"}`}
          state={revenue.invoices.length > 0 ? "complete" : "missing"}
        />
        <ChainStage
          label="2 · Income in bank"
          value={money(revenue.bank_cash_amount)}
          detail={`${revenue.bank_payment_count} linked bank row${revenue.bank_payment_count === 1 ? "" : "s"} · ${money(revenue.processing_fee_amount)} fees · ${money(revenue.amount_remaining)} invoice balance`}
          state={
            revenue.bank_payment_count === 0
              ? "missing"
              : revenuePaid
                ? "complete"
                : "partial"
          }
        />
        <ChainStage
          label="3 · Sub invoice"
          value={money(labourSummary.totals.CAD)}
          detail={`${labourInvoices.length} subcontractor invoice${labourInvoices.length === 1 ? "" : "s"}`}
          state={labourInvoices.length > 0 ? "complete" : "missing"}
        />
        <ChainStage
          label="4 · Payment to sub"
          value={money(labourSummary.confirmedPaidTotals.CAD)}
          detail={`${labourPayments.length} linked bank payment${labourPayments.length === 1 ? "" : "s"}`}
          state={
            labourPayments.length === 0
              ? "missing"
              : labourPaid
                ? "complete"
                : "partial"
          }
        />
      </div>

      {revenue.invoices.length > 0 ? (
        <div className="border-t border-[var(--color-border)]">
          <div className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Customer invoices and incoming bank evidence
          </div>
          {revenue.invoices.map((invoice) => (
            <CustomerInvoiceDetails key={invoice.id} invoice={invoice} />
          ))}
        </div>
      ) : (
        <div className="border-t border-[var(--color-border)] px-5 py-5 text-sm text-[var(--color-warn)]">
          No customer invoice is linked to this job yet.
        </div>
      )}

      {labourInvoices.length > 0 ? (
        <div className="border-t border-[var(--color-border)] px-5 py-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Subcontractor invoice and payment evidence
          </div>
          <div className="flex flex-wrap gap-2">
            {labourInvoices.map((invoice) => (
              <Link
                key={invoice.id}
                href={`/invoices/${encodeURIComponent(invoice.id)}`}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs hover:bg-[var(--color-brand-soft)]"
              >
                <span className="font-medium text-[var(--color-heading)]">
                  {invoice.supplier_name} · #{invoice.invoice_number}
                </span>
                <span className="ml-2 tabular-nums text-[var(--color-muted)]">
                  {money(invoice.amount_after_tax)} · {statusLabel(invoice.payment_status)}
                </span>
              </Link>
            ))}
            {labourPayments.map((payment) => (
              <Link
                key={payment.financial_transaction_id}
                href={`/financials/transactions/${encodeURIComponent(payment.financial_transaction_id)}`}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs hover:bg-[var(--color-brand-soft)]"
              >
                <span className="font-medium text-[var(--color-heading)]">
                  Bank payment · {fmtDate(payment.posted_on)}
                </span>
                <span className="ml-2 tabular-nums text-[var(--color-muted)]">
                  {money(payment.allocated_amount)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function KV({
  k,
  v,
  strong = false,
  dim = false,
}: {
  k: React.ReactNode;
  v: React.ReactNode;
  strong?: boolean;
  dim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-[3px] text-[13px]">
      <span
        className={
          strong
            ? "font-semibold text-[var(--color-heading)]"
            : "text-[var(--color-muted)]"
        }
      >
        {k}
      </span>
      <span
        className={`text-right tabular-nums ${
          strong
            ? "font-semibold text-[var(--color-heading)]"
            : dim
              ? "text-[var(--color-muted)]"
              : "font-medium text-[var(--color-text)]"
        }`}
      >
        {v}
      </span>
    </div>
  );
}

function CustomerInvoiceStatement({
  invoice,
  currentTransactionId,
}: {
  invoice: CustomerInvoiceEvidence;
  currentTransactionId: string;
}) {
  const dripjobsMismatch =
    Math.abs(invoice.source_paid_amount - invoice.bank_paid_amount) > 0.005;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-[var(--color-border)] px-5 py-3">
        <span className="font-display text-sm font-bold text-[var(--color-heading)]">
          Invoice #{invoice.invoice_number}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {invoice.verification_status === "verified" ? (
            <StatusText tone="good">verified against DripJobs</StatusText>
          ) : (
            <StatusText
              tone={
                invoice.verification_status === "needs_information"
                  ? "bad"
                  : "warn"
              }
            >
              {statusLabel(invoice.verification_status)}
            </StatusText>
          )}
          {invoice.source_url ? (
            <a
              href={invoice.source_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              DripJobs →
            </a>
          ) : null}
        </div>
      </div>
      <div className="px-5 py-3.5">
        {invoice.items.map((item) => (
          <KV
            key={item.id}
            k={
              <>
                <span className="font-medium text-[var(--color-text)]">
                  {item.description}
                </span>
                {item.quantity != null && item.unit_price != null ? (
                  <span className="text-xs text-[var(--color-muted)]">
                    {" "}
                    · {item.quantity} × {money(item.unit_price)}
                  </span>
                ) : null}
              </>
            }
            v={money(item.amount_before_tax)}
          />
        ))}
        {Math.abs(invoice.tax_amount) > 0.005 ? (
          <KV k="HST" v={money(invoice.tax_amount)} />
        ) : null}
        <div className="mt-1 border-t border-[var(--color-border)] pt-1">
          <KV k="Invoice total" v={money(invoice.total_amount)} strong />
        </div>
        {invoice.bank_payments.map((payment) => {
          const isThisTransaction =
            payment.transaction_id === currentTransactionId;
          return (
            <details
              key={payment.allocation_id}
              className={`group ${
                isThisTransaction
                  ? "-mx-2 rounded-md bg-[var(--color-brand-soft)] px-2"
                  : ""
              }`}
            >
              <summary className="flex cursor-pointer select-none list-none items-baseline justify-between gap-6 py-[3px] text-[13px] [&::-webkit-details-marker]:hidden">
                <span
                  className={
                    isThisTransaction
                      ? "font-medium text-[var(--color-brand-strong)]"
                      : "text-[var(--color-muted)]"
                  }
                >
                  <span
                    aria-hidden="true"
                    className="mr-1 inline-block text-[9px] transition-transform group-open:rotate-90"
                  >
                    ▶
                  </span>
                  Paid · {fmtDate(payment.posted_on)}
                  {isThisTransaction ? " · this transaction" : ""}
                </span>
                <span
                  className={`text-right font-medium tabular-nums ${
                    isThisTransaction
                      ? "text-[var(--color-brand-strong)]"
                      : "text-[var(--color-muted)]"
                  }`}
                >
                  −{money(payment.invoice_applied_amount)}
                </span>
              </summary>
              <div className="mb-1.5 ml-4 space-y-0.5 text-xs text-[var(--color-muted)]">
                <div>
                  {payment.account_name} •••• {payment.account_last_four ?? "—"}{" "}
                  · {payment.description}
                </div>
                {payment.source_payment ? (
                  <div>
                    DripJobs payment
                    {payment.source_payment.method
                      ? ` · ${payment.source_payment.method}`
                      : ""}
                    {payment.source_payment.reference
                      ? ` · ref ${payment.source_payment.reference}`
                      : ""}{" "}
                    · {money(payment.source_payment.amount)}
                  </div>
                ) : null}
                <div>
                  Bank cash {money(payment.allocated_amount)}
                  {Math.abs(payment.processing_fee_amount) > 0.005
                    ? ` · processor fee ${money(payment.processing_fee_amount)}`
                    : ""}
                  {` · bank row ${money(Math.abs(payment.amount))}`}
                  {!isThisTransaction ? (
                    <>
                      {" · "}
                      <Link
                        href={`/financials/transactions/${encodeURIComponent(payment.transaction_id)}`}
                        className="font-medium text-[var(--color-brand-strong)] hover:underline"
                      >
                        view transaction →
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })}
        <KV
          k="Balance owing"
          v={
            invoice.amount_remaining > 0.005 ? (
              <span className="text-[var(--color-warn)]">
                {money(invoice.amount_remaining)}
              </span>
            ) : (
              money(Math.max(invoice.amount_remaining, 0))
            )
          }
          strong
        />
        {dripjobsMismatch ? (
          <KV
            k="DripJobs records paid"
            v={
              <span className="text-[var(--color-warn)]">
                {money(invoice.source_paid_amount)}
              </span>
            }
            dim
          />
        ) : null}
      </div>
    </Card>
  );
}

function CustomerInvoiceDocumentCard({
  invoice,
}: {
  invoice: CustomerInvoiceEvidence;
}) {
  if (!invoice.signed_url) return null;
  const filename = invoice.document?.original_filename ?? "Archived document";
  const canPreview = /\.(pdf|png|jpe?g|webp)$/i.test(filename);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Invoice #${invoice.invoice_number} — exact archived source`}
        subtitle={filename}
        right={
          <a
            href={invoice.signed_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-brand-strong)] hover:bg-[var(--color-brand-soft)]"
          >
            Open in new tab ↗
          </a>
        }
      />
      {canPreview ? (
        <iframe
          src={invoice.signed_url}
          title={`Invoice ${invoice.invoice_number}`}
          className="h-[560px] w-full bg-white"
        />
      ) : (
        <p className="px-5 py-6 text-sm text-[var(--color-muted)]">
          This file type does not preview in the browser — use Open in new tab
          to download the archived file.
        </p>
      )}
    </Card>
  );
}

export function CustomerRevenueTransactionEvidence({
  evidence,
  receivedFrom,
  exception,
}: {
  evidence: {
    verification: CustomerRevenueVerification;
    invoices: CustomerInvoiceEvidence[];
  };
  receivedFrom: string | null;
  exception: {
    kind: string;
    detail: string | null;
    needsReview: boolean;
  } | null;
}) {
  const { verification, invoices } = evidence;
  const transactionId = verification.financial_transaction_id;
  const jobs = new Map<string, string>();
  for (const invoice of invoices) {
    jobs.set(invoice.companycam_project_id, invoice.project_name);
  }
  const customers = [...new Set(invoices.map((i) => i.customer_name))];
  const unallocated = Number(verification.unallocated_amount);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <StatGrid columns={3}>
          {jobs.size ? (
            <Stat
              label={jobs.size === 1 ? "Job" : "Jobs"}
              value={
                <span className="flex flex-col gap-0.5">
                  {[...jobs.entries()].map(([projectId, name]) => (
                    <Link
                      key={projectId}
                      href={`/projects/${encodeURIComponent(projectId)}`}
                      className="truncate text-[var(--color-brand-strong)] hover:underline"
                      title={name}
                    >
                      {name}
                    </Link>
                  ))}
                </span>
              }
            />
          ) : (
            <Stat label="Category" value="Customer revenue" />
          )}
          <Stat label="Purpose" value="Customer invoice payment" />
          <Stat
            label="Received from"
            value={customers.length ? customers.join(", ") : receivedFrom ?? "Unknown"}
          />
        </StatGrid>
      </Card>

      {invoices.map((invoice) => (
        <CustomerInvoiceStatement
          key={invoice.id}
          invoice={invoice}
          currentTransactionId={transactionId}
        />
      ))}

      {invoices.length === 0 || unallocated > 0.005 ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5">
            <div>
              <p className="text-[13px] text-[var(--color-muted)]">
                {exception?.detail ??
                  (invoices.length === 0
                    ? "No customer invoice has been allocated to this bank income yet."
                    : "Part of this bank income is not matched to a customer invoice.")}
              </p>
              {exception ? (
                <p className="mt-1 text-xs font-medium text-[var(--color-heading)]">
                  {exception.needsReview ? "Evidence gap still needs review" : "Documented settlement exception"}
                </p>
              ) : null}
            </div>
            {invoices.length > 0 ? (
              <span className="font-semibold tabular-nums text-[var(--color-warn)]">
                {money(unallocated)}
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}

      {invoices.map((invoice) => (
        <CustomerInvoiceDocumentCard key={invoice.id} invoice={invoice} />
      ))}
    </div>
  );
}
