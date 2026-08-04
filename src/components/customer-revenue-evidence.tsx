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
} from "@/lib/customer-revenue";
import { fmtDate } from "@/lib/format";

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
