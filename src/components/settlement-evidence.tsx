import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  Stat,
  StatGrid,
  StatusText,
} from "@/components/ui";
import { fmtDate, fmtDateTime, fmtHours, fmtTime } from "@/lib/format";
import type {
  InvoiceVerification,
  LabourInvoiceEvidence,
  LabourPaymentEvidence,
} from "@/lib/settlements";

const currency = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : currency.format(value);
}

function signedMoney(value: number) {
  return `${value > 0 ? "+" : "−"}${currency.format(Math.abs(value))}`;
}

function verificationTone(
  status: InvoiceVerification["verification_status"],
): "good" | "warn" | "bad" {
  if (status === "verified") return "good";
  if (status === "needs_information") return "bad";
  return "warn";
}

function paymentTone(
  status: InvoiceVerification["payment_status"],
): "good" | "warn" | "bad" | "neutral" {
  if (status === "paid") return "good";
  if (status === "partially_paid") return "warn";
  if (status === "overpaid") return "bad";
  return "neutral";
}

function statusLabel(status: string) {
  return (
    {
      verified: "Numbers verified",
      needs_review: "Numbers need review",
      needs_information: "Needs information",
      unpaid: "Unpaid",
      partially_paid: "Partially paid",
      paid: "Paid",
      overpaid: "Overpaid",
      unidentified: "Recipient not verified",
      unmatched: "No invoice or bonus matched",
      partially_allocated: "Partially allocated",
      fully_allocated: "Fully allocated",
    }[status] ?? status.replaceAll("_", " ")
  );
}

function entryTypeLabel(entryType: string) {
  return (
    {
      labour: "Labour",
      material: "Material",
      bonus: "Bonus",
      commission: "Commission",
      expense: "Expense",
      other: "Other",
      unclassified: "Unclassified",
    }[entryType] ?? entryType
  );
}

function entrySourceLabel(sourceKind: string) {
  return (
    {
      extracted: "Exact source entry",
      manual: "Manually entered",
      legacy_project_link: "Derived from job match",
      legacy_invoice_total: "Exact lines needed",
    }[sourceKind] ?? sourceKind
  );
}

const entrySourceTextClass: Record<string, string> = {
  extracted: "text-[var(--color-good)]",
  manual: "text-[var(--color-brand-strong)]",
  legacy_project_link: "text-[var(--color-warn)]",
  legacy_invoice_total: "text-[var(--color-bad)]",
};

function Check({
  label,
  value,
  kind = "money",
}: {
  label: string;
  value: number;
  kind?: "money" | "hours";
}) {
  const clear = Math.abs(value) <= (kind === "hours" ? 0.0167 : 0.005);
  return (
    <StatusText tone={clear ? "good" : "warn"}>
      {label}{" "}
      {clear ? (
        "matches"
      ) : (
        <span className="tabular-nums">
          off by{" "}
          {kind === "hours"
            ? `${value > 0 ? "+" : "−"}${fmtHours(Math.abs(value))}`
            : signedMoney(value)}
        </span>
      )}
    </StatusText>
  );
}

export function InvoiceEvidence({
  invoice,
  showDocument = true,
  highlightEntryId,
}: {
  invoice: LabourInvoiceEvidence;
  showDocument?: boolean;
  highlightEntryId?: string;
}) {
  const { verification } = invoice;
  const canPreviewSource = /\.(pdf|png|jpe?g|webp)$/i.test(
    verification.original_filename,
  );

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <StatGrid columns={4}>
          <Stat
            label="Invoice total"
            value={money(verification.invoice_amount)}
          />
          <Stat label="Bank payments" value={money(verification.paid_amount)} />
          <Stat
            label="Amount remaining"
            value={money(verification.amount_remaining)}
          />
          <Stat
            label="Listed / backend hours"
            value={`${fmtHours(verification.invoiced_hours)} / ${fmtHours(
              verification.backend_hours,
            )}`}
          />
        </StatGrid>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[var(--color-border)] px-4 py-2.5">
          <StatusText tone={paymentTone(verification.payment_status)}>
            {statusLabel(verification.payment_status)}
          </StatusText>
          <StatusText tone={verificationTone(verification.verification_status)}>
            {statusLabel(verification.verification_status)}
          </StatusText>
          <Check
            label="Invoice vs entries"
            value={verification.invoice_line_difference}
          />
          <Check label="Entries vs jobs" value={verification.job_difference} />
          <Check
            label="Invoice vs backend hours"
            value={verification.hours_difference}
            kind="hours"
          />
          <span className="ml-auto text-xs text-[var(--color-muted)]">
            {invoice.contractor?.supplier_name ?? verification.supplier_name}
            {invoice.contractor?.worker_name
              ? ` · ${invoice.contractor.worker_name}`
              : ""}
          </span>
        </div>
      </Card>

      {showDocument ? (
        <Card className="overflow-hidden">
          <CardHeader
            title="Original invoice"
            subtitle={verification.original_filename}
            right={
              invoice.signedUrl ? (
                <a
                  href={invoice.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-brand-strong)] hover:bg-[var(--color-brand-soft)]"
                >
                  Open source
                </a>
              ) : (
                <Badge tone="bad">Unavailable</Badge>
              )
            }
          />
          {invoice.signedUrl && canPreviewSource ? (
            <iframe
              src={invoice.signedUrl}
              title={`Invoice ${verification.invoice_number}`}
              className="h-[620px] w-full bg-white"
            />
          ) : invoice.signedUrl ? (
            <div className="border-t border-[var(--color-border)] px-5 py-8 text-sm">
              <div className="font-medium text-[var(--color-heading)]">
                Exact source archived in its original format
              </div>
              <p className="mt-1 max-w-2xl text-[var(--color-muted)]">
                This file type does not preview reliably in the browser. Use
                Open source to download the archived file; the invoice entries
                and comparisons remain visible below.
              </p>
            </div>
          ) : (
            <div className="px-5 py-10 text-center text-sm text-[var(--color-muted)]">
              The archived source file is unavailable.
            </div>
          )}
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          title="Invoice entries compared with backend"
          subtitle="Printed values stay separate from job and timesheet evidence"
          right={<Badge tone="neutral">{invoice.lines.length} entries</Badge>}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-[13px]">
            <thead className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">
                  Date / invoice entry
                </th>
                <th className="px-4 py-2.5 font-medium">Job</th>
                <th className="px-4 py-2.5 font-medium">Backend shift</th>
                <th className="border-l border-[var(--color-border)] px-4 py-2.5 text-right font-medium">
                  Invoice hours
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Backend hours
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {invoice.lines.map((line) => {
                const backendHours = line.timeEntries.reduce(
                  (total, entry) => total + entry.allocated_hours,
                  0,
                );
                const hoursDifference =
                  backendHours - Number(line.quantity_hours ?? 0);
                return (
                  <tr
                    key={line.id}
                    id={`invoice-entry-${line.id}`}
                    className={`align-top ${
                      highlightEntryId === line.id
                        ? "bg-[var(--color-brand-soft)]"
                        : ""
                    }`}
                  >
                    <td className="max-w-[300px] px-4 py-3">
                      <Link
                        href={`/invoices/entries/${encodeURIComponent(line.id)}`}
                        className="font-medium text-[var(--color-brand-strong)] hover:underline"
                      >
                        {line.description}
                      </Link>
                      <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                        {fmtDate(line.service_started_on)} ·{" "}
                        <span
                          className={
                            line.entry_type === "unclassified"
                              ? "font-medium text-[var(--color-bad)]"
                              : undefined
                          }
                        >
                          {entryTypeLabel(line.entry_type)}
                        </span>{" "}
                        ·{" "}
                        <span
                          className={`font-medium ${
                            entrySourceTextClass[line.source_kind] ??
                            "text-[var(--color-muted)]"
                          }`}
                        >
                          {entrySourceLabel(line.source_kind)}
                        </span>
                      </div>
                      {line.source_text ? (
                        <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                          Source: {line.source_text}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      {line.jobs.map((job) => (
                        <div key={job.companycam_project_id}>
                          <Link
                            href={`/projects/${encodeURIComponent(
                              job.companycam_project_id,
                            )}`}
                            title={job.address ?? undefined}
                            className="font-medium text-[var(--color-brand-strong)] hover:underline"
                          >
                            {job.name}
                          </Link>
                        </div>
                      ))}
                    </td>
                    <td className="max-w-[280px] px-4 py-3">
                      {line.timeEntries.map((entry) => (
                        <div key={entry.time_entry_id}>
                          <span className="font-medium text-[var(--color-heading)]">
                            {entry.worker_name}
                          </span>
                          <span className="text-[11px] text-[var(--color-muted)]">
                            {" "}
                            · {fmtTime(entry.started_at)}–
                            {fmtTime(entry.ended_at)}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td className="whitespace-nowrap border-l border-[var(--color-border)] px-4 py-3 text-right tabular-nums">
                      {line.quantity_hours == null
                        ? "—"
                        : fmtHours(line.quantity_hours)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
                      {fmtHours(backendHours)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
                      {money(line.hourly_rate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                      {money(line.amount_before_tax)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${
                        Math.abs(hoursDifference) > 0.0167
                          ? "text-[var(--color-warn)]"
                          : "text-[var(--color-good)]"
                      }`}
                    >
                      {hoursDifference > 0
                        ? "+"
                        : hoursDifference < 0
                          ? "−"
                          : ""}
                      {fmtHours(Math.abs(hoursDifference))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-[var(--color-border)] font-medium">
              <tr>
                <td className="px-4 py-3" colSpan={3}>
                  Totals
                </td>
                <td className="border-l border-[var(--color-border)] px-4 py-3 text-right tabular-nums">
                  {fmtHours(verification.invoiced_hours)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtHours(verification.backend_hours)}
                </td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">
                  {money(verification.line_amount)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {verification.hours_difference > 0
                    ? "+"
                    : verification.hours_difference < 0
                      ? "−"
                      : ""}
                  {fmtHours(Math.abs(verification.hours_difference))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Bank payments"
          subtitle="Cleared bank rows allocated to this invoice"
          right={<Badge tone="neutral">{invoice.payments.length}</Badge>}
        />
        {invoice.payments.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {invoice.payments.map((payment) => (
              <Link
                key={payment.allocation_id}
                href={`/financials/transactions/${payment.financial_transaction_id}`}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hover:bg-[var(--color-surface-2)]"
              >
                <div>
                  <div className="font-medium text-[var(--color-heading)]">
                    {payment.counterparty ?? payment.description}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {fmtDate(payment.posted_on)} · {payment.account_name} ••••{" "}
                    {payment.account_last_four ?? "—"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">
                    {money(payment.allocated_amount)}
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-[var(--color-muted)]">
                    Bank row {money(Math.abs(payment.bank_amount))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-[var(--color-muted)]">
            No cleared bank payment is allocated to this invoice.
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payment evidence: money trail. A purpose summary on top, then a     */
/* numbered flow — bank line item → invoice line items → jobs →        */
/* original (unstructured) invoice document at the bottom.             */
/* ------------------------------------------------------------------ */

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div
        className="mt-0.5 truncate text-[13px] font-medium text-[var(--color-heading)]"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function BankLineCard({
  transaction,
}: {
  transaction: LabourPaymentEvidence["transaction"];
}) {
  const signed =
    transaction.transaction_type === "income" ||
    transaction.transaction_type === "credit"
      ? money(Math.abs(transaction.amount))
      : `−${money(Math.abs(transaction.amount))}`;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-3 px-5 py-4">
        <div className="grid min-w-0 flex-1 gap-x-8 gap-y-3 sm:grid-cols-3">
          <Field label="Posted" value={fmtDate(transaction.posted_on)} />
          <Field
            label="Account"
            value={`${transaction.account_name} •••• ${
              transaction.account_last_four ?? "—"
            }`}
          />
          <Field label="Bank description" value={transaction.description} />
        </div>
        <div className="text-right font-display text-lg font-bold tabular-nums text-[var(--color-heading)]">
          {signed}
        </div>
      </div>
    </Card>
  );
}

function InvoiceLinesCard({
  invoice,
  transactionId,
}: {
  invoice: LabourInvoiceEvidence;
  transactionId: string;
}) {
  const { verification, lines } = invoice;
  const taxTotal = lines.reduce((total, line) => total + line.tax_amount, 0);
  const checks = [
    {
      label: "entries",
      clear: Math.abs(verification.invoice_line_difference) <= 0.005,
    },
    { label: "jobs", clear: Math.abs(verification.job_difference) <= 0.005 },
    {
      label: "hours",
      clear: Math.abs(verification.hours_difference) <= 0.0167,
    },
    {
      label: "numbers",
      clear: verification.verification_status === "verified",
    },
  ];
  const failing = checks.filter((check) => !check.clear);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-[var(--color-border)] px-5 py-3">
        <span className="font-display text-sm font-bold text-[var(--color-heading)]">
          Invoice #{verification.invoice_number}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {failing.length === 0 ? (
            <StatusText tone="good">verified against backend</StatusText>
          ) : (
            failing.map((check) => (
              <StatusText key={check.label} tone="warn">
                {check.label} check needs review
              </StatusText>
            ))
          )}
          <Link
            href={`/invoices/${encodeURIComponent(verification.invoice_id)}`}
            className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
          >
            invoice record →
          </Link>
        </div>
      </div>
      <div className="px-5 py-3.5">
        <div>
          {lines.map((line) => (
            <KV
              key={line.id}
              k={
                <>
                  <Link
                    href={`/invoices/entries/${encodeURIComponent(line.id)}`}
                    className="font-medium text-[var(--color-text)] hover:text-[var(--color-brand-strong)] hover:underline"
                  >
                    {line.description}
                  </Link>
                  <span className="text-xs text-[var(--color-muted)]">
                    {" "}
                    · {entryTypeLabel(line.entry_type)}
                    {line.quantity_hours != null
                      ? ` · ${fmtHours(line.quantity_hours)}`
                      : ""}
                    {line.jobs.some((job) => job.name !== line.description)
                      ? ` · ${line.jobs
                          .filter((job) => job.name !== line.description)
                          .map((job) => job.name)
                          .join(", ")}`
                      : ""}
                  </span>
                </>
              }
              v={money(line.amount_before_tax)}
            />
          ))}
          {Math.abs(taxTotal) > 0.005 ? (
            <KV k="HST" v={money(taxTotal)} />
          ) : null}
          <div className="mt-1 border-t border-[var(--color-border)] pt-1">
            <KV
              k="Invoice total"
              v={money(verification.invoice_amount)}
              strong
            />
          </div>
          {invoice.payments.map((item) => {
            const isThisTransaction =
              item.financial_transaction_id === transactionId;
            return (
              <details
                key={item.allocation_id}
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
                    Paid · {fmtDate(item.posted_on)}
                    {isThisTransaction ? " · this transaction" : ""}
                  </span>
                  <span
                    className={`text-right font-medium tabular-nums ${
                      isThisTransaction
                        ? "text-[var(--color-brand-strong)]"
                        : "text-[var(--color-muted)]"
                    }`}
                  >
                    −{money(item.allocated_amount)}
                  </span>
                </summary>
                <div className="mb-1.5 ml-4 space-y-0.5 text-xs text-[var(--color-muted)]">
                  <div>
                    {item.account_name} •••• {item.account_last_four ?? "—"} ·{" "}
                    {item.description}
                  </div>
                  <div>
                    Bank row {money(Math.abs(item.bank_amount))}
                    {!isThisTransaction ? (
                      <>
                        {" · "}
                        <Link
                          href={`/financials/transactions/${item.financial_transaction_id}`}
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
              verification.amount_remaining > 0.005 ? (
                <span className="text-[var(--color-warn)]">
                  {money(verification.amount_remaining)}
                </span>
              ) : (
                money(Math.max(verification.amount_remaining, 0))
              )
            }
            strong
          />
        </div>
      </div>
    </Card>
  );
}

function TargetRowCard({
  title,
  sub,
  amount,
  amountSub,
  href,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  amount: string;
  amountSub?: string;
  href?: string;
}) {
  const body = (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5">
      <div className="min-w-0">
        <div className="font-medium text-[var(--color-heading)]">{title}</div>
        {sub != null ? (
          <div className="mt-0.5 text-xs text-[var(--color-muted)]">{sub}</div>
        ) : null}
      </div>
      <div className="text-right">
        <div className="font-semibold tabular-nums text-[var(--color-heading)]">
          {amount}
        </div>
        {amountSub ? (
          <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
            {amountSub}
          </div>
        ) : null}
      </div>
    </div>
  );
  return (
    <Card className="overflow-hidden">
      {href ? (
        <Link href={href} className="block hover:bg-[var(--color-surface-2)]">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function InvoiceDocumentCard({ invoice }: { invoice: LabourInvoiceEvidence }) {
  const { verification, signedUrl } = invoice;
  const canPreview = /\.(pdf|png|jpe?g|webp)$/i.test(
    verification.original_filename,
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Invoice #${verification.invoice_number} — exact archived source`}
        subtitle={verification.original_filename}
        right={
          signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-brand-strong)] hover:bg-[var(--color-brand-soft)]"
            >
              Open in new tab ↗
            </a>
          ) : (
            <Badge tone="bad">Unavailable</Badge>
          )
        }
      />
      {signedUrl && canPreview ? (
        <iframe
          src={signedUrl}
          title={`Invoice ${verification.invoice_number}`}
          className="h-[560px] w-full bg-white"
        />
      ) : signedUrl ? (
        <p className="px-5 py-6 text-sm text-[var(--color-muted)]">
          This file type does not preview in the browser — use Open in new tab
          to download the archived file.
        </p>
      ) : (
        <p className="px-5 py-6 text-sm text-[var(--color-muted)]">
          The archived source file is unavailable.
        </p>
      )}
    </Card>
  );
}

export function PaymentEvidence({
  payment,
}: {
  payment: LabourPaymentEvidence;
}) {
  const { transaction } = payment;
  const verification = payment.verification;
  const isInbound =
    transaction.transaction_type === "income" ||
    transaction.transaction_type === "credit";
  const hasBankSupportedExpense =
    transaction.expense_evidence_status === "bank_supported_no_itc" &&
    transaction.review_status === "reconciled";

  if (hasBankSupportedExpense) {
    const isCredit = transaction.transaction_type === "credit";
    return (
      <div className="space-y-4">
        <Card className="overflow-hidden">
          <StatGrid columns={4}>
            <Stat
              label="Purpose"
              value={isCredit ? "Subscription credit" : "Software overhead"}
            />
            <Stat
              label={isCredit ? "Received from" : "Paid to"}
              value={
                transaction.expense_evidence_vendor ??
                transaction.counterparty ??
                transaction.description
              }
            />
            <Stat label="Category" value={transaction.category} />
            <Stat label="HST" value="None claimed" />
          </StatGrid>
        </Card>
        <BankLineCard transaction={transaction} />
      </div>
    );
  }

  const jobs = new Map<
    string,
    { name: string; total: number; types: Set<string>; needsReview: boolean }
  >();
  for (const invoice of payment.invoices) {
    for (const line of invoice.lines) {
      for (const job of line.jobs) {
        const existing = jobs.get(job.companycam_project_id) ?? {
          name: job.name,
          total: 0,
          types: new Set<string>(),
          needsReview: false,
        };
        existing.total += job.allocated_amount;
        existing.types.add(entryTypeLabel(line.entry_type));
        existing.needsReview ||= job.needs_review;
        jobs.set(job.companycam_project_id, existing);
      }
    }
  }
  for (const bonus of payment.bonuses) {
    const existing = jobs.get(bonus.project_id) ?? {
      name: bonus.project_name,
      total: 0,
      types: new Set<string>(),
      needsReview: false,
    };
    existing.total += bonus.allocated_amount;
    existing.types.add("Bonus");
    jobs.set(bonus.project_id, existing);
  }

  // What the money was for, by entry type across everything allocated.
  const purposeTotals = new Map<string, number>();
  for (const invoice of payment.invoices) {
    for (const line of invoice.lines) {
      const label = entryTypeLabel(line.entry_type);
      purposeTotals.set(
        label,
        (purposeTotals.get(label) ?? 0) + line.amount_before_tax,
      );
    }
  }
  for (const bonus of payment.bonuses) {
    purposeTotals.set(
      "Bonus",
      (purposeTotals.get("Bonus") ?? 0) + bonus.allocated_amount,
    );
  }
  for (const allocation of payment.otherAllocations) {
    const label = allocation.allocation_type.replaceAll("_", " ");
    const capitalized = label.replace(/^\w/, (c) => c.toUpperCase());
    purposeTotals.set(
      capitalized,
      (purposeTotals.get(capitalized) ?? 0) + allocation.allocated_amount,
    );
  }
  const purposeParts = [...purposeTotals.entries()].sort((a, b) => b[1] - a[1]);
  const purposeValue = purposeParts.length
    ? purposeParts.map(([label]) => label).join(" + ")
    : transaction.is_overpayment
      ? "Overpayment"
      : transaction.has_no_invoice
        ? "No invoice provided"
        : transaction.invoice_not_found
          ? "Invoice not found"
          : "Not yet matched";

  const unallocatedAmount = Number(
    verification?.unallocated_amount ?? Math.abs(transaction.amount),
  );
  const counterpartyName = payment.contractor
    ? payment.contractor.worker_name
      ? `${payment.contractor.supplier_name} · ${payment.contractor.worker_name}`
      : payment.contractor.supplier_name
    : (transaction.counterparty ?? "Unknown");
  const recipientConfirmed =
    verification?.recipient_status === "confirmed" && payment.contractor;

  const unmatchedReason = transaction.is_overpayment
    ? "This payment exceeds every invoice on file for this contractor — the balance is treated as an overpayment."
    : transaction.partial_no_invoice_residual
      ? "Part of this payment matches an invoice; the remaining balance has no invoice behind it."
      : transaction.has_no_invoice
        ? "The contractor did not provide an invoice for this payment."
        : transaction.invoice_not_found
          ? "An invoice should exist for this payment but has not been located."
          : "No invoice, bonus, or other settlement is matched to this payment yet.";

  const hasTargets =
    payment.invoices.length > 0 ||
    payment.bonuses.length > 0 ||
    payment.otherAllocations.length > 0;
  const documents = payment.invoices.filter((invoice) => invoice.signedUrl);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <StatGrid columns={3}>
          {jobs.size ? (
            <Stat
              label={jobs.size === 1 ? "Job" : "Jobs"}
              value={
                <span className="flex flex-col gap-0.5">
                  {[...jobs.entries()].map(([projectId, job]) => (
                    <Link
                      key={projectId}
                      href={`/projects/${encodeURIComponent(projectId)}`}
                      className="truncate text-[var(--color-brand-strong)] hover:underline"
                      title={job.name}
                    >
                      {job.name}
                    </Link>
                  ))}
                </span>
              }
            />
          ) : (
            <Stat label="Category" value={transaction.category} />
          )}
          <Stat label="Purpose" value={purposeValue} />
          <Stat
            label={isInbound ? "Received from" : "Paid to"}
            value={counterpartyName}
            hint={
              recipientConfirmed ? undefined : (
                <StatusText tone="warn">Recipient not verified</StatusText>
              )
            }
          />
        </StatGrid>
      </Card>

      {payment.invoices.length === 0 ? (
        <BankLineCard transaction={transaction} />
      ) : null}

      {payment.invoices.map((invoice) => (
        <InvoiceLinesCard
          key={invoice.verification.invoice_id}
          invoice={invoice}
          transactionId={transaction.id}
        />
      ))}
      {payment.bonuses.map((bonus) => (
        <TargetRowCard
          key={bonus.allocation_id}
          title={`Bonus — ${bonus.project_name}`}
          sub={`Approved ${fmtDateTime(bonus.approved_at)} · formula ${
            bonus.formula_version
          }`}
          amount={money(bonus.allocated_amount)}
          href={`/projects/${encodeURIComponent(bonus.project_id)}`}
        />
      ))}
      {payment.otherAllocations.map((allocation) => (
        <TargetRowCard
          key={allocation.id}
          title={
            <span className="capitalize">
              {allocation.allocation_type.replaceAll("_", " ")}
            </span>
          }
          sub={allocation.explanation}
          amount={money(allocation.allocated_amount)}
          href={
            allocation.project_id
              ? `/projects/${encodeURIComponent(allocation.project_id)}`
              : undefined
          }
        />
      ))}
      {!hasTargets || unallocatedAmount > 0.005 ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5">
            <p className="text-[13px] text-[var(--color-muted)]">
              {unmatchedReason}
            </p>
            {hasTargets ? (
              <span className="font-semibold tabular-nums text-[var(--color-warn)]">
                {money(unallocatedAmount)}
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}

      {documents.map((invoice) => (
        <InvoiceDocumentCard
          key={invoice.verification.invoice_id}
          invoice={invoice}
        />
      ))}
    </div>
  );
}
