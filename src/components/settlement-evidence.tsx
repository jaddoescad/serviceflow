import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui";
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

function signedMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.005) return currency.format(0);
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

function Difference({
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
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
          {label}
        </span>
        <Badge tone={clear ? "good" : "warn"}>
          {clear ? "Matches" : "Difference"}
        </Badge>
      </div>
      <div
        className={`mt-2 font-display text-xl font-semibold tabular-nums ${
          clear ? "text-[var(--color-good)]" : "text-[var(--color-warn)]"
        }`}
      >
        {kind === "hours"
          ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmtHours(Math.abs(value))}`
          : signedMoney(value)}
      </div>
    </div>
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value
          label="Invoice total"
          value={money(verification.invoice_amount)}
        />
        <Value label="Bank payments" value={money(verification.paid_amount)} />
        <Value
          label="Amount remaining"
          value={money(verification.amount_remaining)}
        />
        <Value
          label="Listed / backend hours"
          value={`${fmtHours(verification.invoiced_hours)} / ${fmtHours(
            verification.backend_hours,
          )}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={paymentTone(verification.payment_status)}>
          {statusLabel(verification.payment_status)}
        </Badge>
        <Badge tone={verificationTone(verification.verification_status)}>
          {statusLabel(verification.verification_status)}
        </Badge>
        <span className="text-xs text-[var(--color-muted)]">
          Contractor:{" "}
          {invoice.contractor?.supplier_name ?? verification.supplier_name}
          {invoice.contractor?.worker_name
            ? ` · ${invoice.contractor.worker_name}`
            : ""}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Difference
          label="Printed invoice vs entries"
          value={verification.invoice_line_difference}
        />
        <Difference
          label="Entries vs jobs"
          value={verification.job_difference}
        />
        <Difference
          label="Invoice vs backend hours"
          value={verification.hours_difference}
          kind="hours"
        />
      </div>

      {showDocument ? (
        <Card className="overflow-hidden">
          <CardHeader
            title="Original invoice"
            subtitle={`${verification.original_filename} · SHA-256 ${verification.content_sha256.slice(
              0,
              16,
            )}…`}
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
                Exact source archived as an email file
              </div>
              <p className="mt-1 max-w-2xl text-[var(--color-muted)]">
                Email files do not preview reliably in the browser. Use Open
                source to download the archived file; the invoice entries and
                comparisons remain visible below.
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
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Date / invoice entry</th>
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-4 py-3 font-medium">Backend shift</th>
                <th className="px-4 py-3 text-right font-medium">
                  Invoice hours
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  Backend hours
                </th>
                <th className="px-4 py-3 text-right font-medium">Rate</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-right font-medium">Difference</th>
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
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge
                          tone={
                            line.entry_type === "unclassified"
                              ? "bad"
                              : "neutral"
                          }
                        >
                          {entryTypeLabel(line.entry_type)}
                        </Badge>
                        <Badge
                          tone={
                            line.source_kind === "extracted"
                              ? "good"
                              : line.source_kind === "manual"
                                ? "brand"
                                : line.source_kind === "legacy_project_link"
                                  ? "warn"
                                  : "bad"
                          }
                        >
                          {entrySourceLabel(line.source_kind)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-muted)]">
                        {fmtDate(line.service_started_on)}
                      </div>
                      {line.source_text ? (
                        <div className="mt-1 text-[11px] text-[var(--color-muted)]">
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
                            className="font-medium text-[var(--color-brand-strong)] hover:underline"
                          >
                            {job.name}
                          </Link>
                          {job.address ? (
                            <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                              {job.address}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </td>
                    <td className="max-w-[280px] px-4 py-3">
                      {line.timeEntries.map((entry) => (
                        <div key={entry.time_entry_id}>
                          <div className="font-medium text-[var(--color-heading)]">
                            {entry.worker_name}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                            {fmtTime(entry.started_at)}–
                            {fmtTime(entry.ended_at)} · {entry.status}
                          </div>
                        </div>
                      ))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {line.quantity_hours == null
                        ? "—"
                        : fmtHours(line.quantity_hours)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {fmtHours(backendHours)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
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
            <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] font-medium">
              <tr>
                <td className="px-4 py-3" colSpan={3}>
                  Totals
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
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
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--color-surface-2)]"
              >
                <div>
                  <div className="font-medium text-[var(--color-heading)]">
                    {payment.counterparty ?? payment.description}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    {fmtDate(payment.posted_on)} · {payment.account_name} ••••{" "}
                    {payment.account_last_four ?? "—"} ·{" "}
                    {payment.source_filename}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">
                    {money(payment.allocated_amount)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
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

export function PaymentEvidence({
  payment,
}: {
  payment: LabourPaymentEvidence;
}) {
  const verification = payment.verification;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value
          label="Bank payment"
          value={money(Math.abs(payment.transaction.amount))}
        />
        <Value
          label="Invoices"
          value={money(verification?.invoice_allocated_amount ?? 0)}
        />
        <Value
          label="Bonuses / other"
          value={money(
            Number(verification?.bonus_allocated_amount ?? 0) +
              Number(verification?.other_allocated_amount ?? 0),
          )}
        />
        <Value
          label="Unallocated"
          value={money(
            verification?.unallocated_amount ??
              Math.abs(payment.transaction.amount),
          )}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          tone={
            payment.transaction.is_overpayment
              ? "bad"
              : verification?.payment_status === "fully_allocated"
                ? "good"
                : verification?.payment_status === "needs_review"
                  ? "bad"
                  : "warn"
          }
        >
          {payment.transaction.is_overpayment
            ? "Overpayment"
            : payment.transaction.has_no_invoice
              ? "No invoice provided"
              : statusLabel(verification?.payment_status ?? "unmatched")}
        </Badge>
        <Badge
          tone={
            verification?.recipient_status === "confirmed" ? "good" : "warn"
          }
        >
          {verification?.recipient_status === "confirmed"
            ? "Recipient confirmed"
            : "Recipient not verified"}
        </Badge>
      </div>

      <Card>
        <CardHeader
          title="Bank evidence"
          subtitle="The imported bank row is the payment source"
        />
        <dl className="grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <Detail
            label="Posted"
            value={fmtDate(payment.transaction.posted_on)}
          />
          <Detail
            label="Account"
            value={`${payment.transaction.account_name} •••• ${
              payment.transaction.account_last_four ?? "—"
            }`}
          />
          <Detail
            label="Bank description"
            value={payment.transaction.description}
          />
          <Detail
            label="Counterparty"
            value={
              payment.transaction.counterparty ?? "Recipient not in bank row"
            }
          />
          <Detail
            label="Source file"
            value={payment.transaction.source_filename}
          />
          <Detail
            label="Source checksum"
            value={
              payment.transaction.source_sha256
                ? `${payment.transaction.source_sha256.slice(0, 20)}…`
                : "Unavailable"
            }
          />
        </dl>
        {payment.transaction.notes ? (
          <p className="border-t border-[var(--color-border)] px-5 py-4 text-sm text-[var(--color-muted)]">
            {payment.transaction.notes}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Recipient evidence"
          subtitle="Email is not required; inaccessible message links are not shown"
        />
        <dl className="grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-2">
          <Detail
            label="Contractor"
            value={payment.contractor?.supplier_name ?? "Unknown"}
          />
          <Detail
            label="Worker"
            value={payment.contractor?.worker_name ?? "—"}
          />
          <Detail
            label="Confirmation"
            value={
              payment.contractor?.confirmation_method?.replaceAll("_", " ") ??
              "Not confirmed"
            }
          />
          <Detail
            label="Confirmed"
            value={fmtDateTime(payment.contractor?.confirmed_at ?? null)}
          />
        </dl>
        {payment.contractor?.confirmation_note ? (
          <p className="border-t border-[var(--color-border)] px-5 py-4 text-sm text-[var(--color-muted)]">
            {payment.contractor.confirmation_note}
          </p>
        ) : null}
      </Card>

      {payment.invoices.map((invoice) => (
        <Card key={invoice.verification.invoice_id} className="overflow-hidden">
          <CardHeader
            title={`${invoice.verification.supplier_name} · Invoice #${invoice.verification.invoice_number}`}
            subtitle={`${fmtDate(invoice.verification.invoice_date)} · ${
              invoice.verification.original_filename
            }`}
            right={
              <Link
                href={`/invoices/${invoice.verification.invoice_id}`}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-brand-strong)] hover:bg-[var(--color-brand-soft)]"
              >
                Full invoice
              </Link>
            }
          />
          <div className="p-5">
            <InvoiceEvidence invoice={invoice} showDocument={false} />
          </div>
        </Card>
      ))}

      {payment.bonuses.length ? (
        <Card className="overflow-hidden">
          <CardHeader title="Approved bonuses" />
          <div className="divide-y divide-[var(--color-border)]">
            {payment.bonuses.map((bonus) => (
              <div
                key={bonus.allocation_id}
                className="flex items-start justify-between gap-4 px-5 py-4"
              >
                <div>
                  <Link
                    href={`/projects/${encodeURIComponent(bonus.project_id)}`}
                    className="font-medium text-[var(--color-brand-strong)] hover:underline"
                  >
                    {bonus.project_name}
                  </Link>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    Approved {fmtDateTime(bonus.approved_at)} · Formula{" "}
                    {bonus.formula_version}
                  </div>
                </div>
                <div className="font-semibold tabular-nums">
                  {money(bonus.allocated_amount)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {payment.otherAllocations.length ? (
        <Card className="overflow-hidden">
          <CardHeader title="Other explained payment amounts" />
          <div className="divide-y divide-[var(--color-border)]">
            {payment.otherAllocations.map((allocation) => (
              <div
                key={allocation.id}
                className="flex items-start justify-between gap-4 px-5 py-4"
              >
                <div>
                  <div className="font-medium capitalize text-[var(--color-heading)]">
                    {allocation.allocation_type.replaceAll("_", " ")}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    {allocation.explanation}
                  </div>
                </div>
                <div className="font-semibold tabular-nums">
                  {money(allocation.allocated_amount)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className="mt-2 font-display text-xl font-semibold tabular-nums text-[var(--color-heading)]">
        {value}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
      <dd className="mt-1 break-words font-medium text-[var(--color-heading)]">
        {value}
      </dd>
    </div>
  );
}
