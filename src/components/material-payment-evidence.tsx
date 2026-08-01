import Link from "next/link";
import { Badge, Card, CardHeader, Stat, StatGrid } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type { MaterialPaymentEvidence } from "@/lib/materials";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(value);
}

export function MaterialPaymentEvidenceView({
  evidence,
  transaction,
}: {
  evidence: MaterialPaymentEvidence;
  transaction: {
    posted_on: string;
    description: string;
    counterparty: string | null;
    amount: number;
    currency: string;
    category: string;
    account_name: string;
    account_last_four: string | null;
    source_filename: string;
  };
}) {
  const settled = evidence.verification.payment_status === "fully_allocated";

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <StatGrid columns={4}>
          <Stat label="Purpose" value="Material invoice payment" />
          <Stat
            label="Paid to"
            value={transaction.counterparty ?? transaction.description}
          />
          <Stat label="Category" value={transaction.category} />
          <Stat
            label="Allocated"
            value={money(
              evidence.verification.allocated_amount,
              transaction.currency,
            )}
            tone={settled ? "good" : "warn"}
            hint={`${evidence.verification.invoice_count} supplier invoices`}
          />
        </StatGrid>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Material invoices"
          subtitle="The bank payment is allocated across these archived supplier invoices"
          right={
            <Badge tone={settled ? "good" : "warn"}>
              {settled ? "Fully matched" : "Needs review"}
            </Badge>
          }
        />
        {evidence.invoices.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {evidence.invoices.map((invoice) => (
              <Link
                key={invoice.id}
                href={`/material-invoices/${encodeURIComponent(invoice.id)}`}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hover:bg-[var(--color-surface-2)]"
              >
                <span>
                  <span className="font-medium text-[var(--color-heading)]">
                    {invoice.supplierName} · Invoice #{invoice.invoiceNumber}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                    {fmtDate(invoice.invoiceDate)}
                    {invoice.poNumber ? ` · PO ${invoice.poNumber}` : ""} · {invoice.documentFilename}
                  </span>
                  {invoice.evidenceReference ? (
                    <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                      {invoice.evidenceReference}
                    </span>
                  ) : null}
                </span>
                <span className="font-semibold tabular-nums">
                  {money(invoice.allocatedAmount, transaction.currency)}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="px-5 py-8 text-sm text-[var(--color-muted)]">
            No material invoice is allocated to this bank row.
          </p>
        )}
        {evidence.verification.unallocated_amount > 0.02 ? (
          <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] bg-[var(--color-warn-soft)] px-5 py-3 text-sm text-[var(--color-warn)]">
            <span>Bank amount still without invoice evidence</span>
            <span className="font-semibold tabular-nums">
              {money(
                evidence.verification.unallocated_amount,
                transaction.currency,
              )}
            </span>
          </div>
        ) : null}
      </Card>

      {evidence.statements.length ? (
        <Card className="overflow-hidden">
          <CardHeader
            title="Supplier statement evidence"
            subtitle="The statement payment total was matched to the grouped bank rows before FIFO invoice allocation"
          />
          <div className="divide-y divide-[var(--color-border)]">
            {evidence.statements.map((statement) =>
              statement.signedUrl ? (
                <a
                  key={statement.id}
                  href={statement.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-[var(--color-surface-2)]"
                >
                  <span>
                    <span className="font-medium text-[var(--color-heading)]">
                      {statement.filename}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                      {statement.date ? fmtDate(statement.date) : "Sherwin statement"}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-[var(--color-brand-strong)]">
                    Open source
                  </span>
                </a>
              ) : (
                <div key={statement.id} className="px-5 py-3.5 text-sm">
                  {statement.filename}
                </div>
              ),
            )}
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader title="Posted bank record" />
        <div className="grid gap-px bg-[var(--color-border)] sm:grid-cols-3">
          <div className="bg-[var(--color-surface)] px-4 py-3 text-sm">
            <div className="text-xs text-[var(--color-muted)]">Posted</div>
            <div className="mt-1 font-medium">{fmtDate(transaction.posted_on)}</div>
          </div>
          <div className="bg-[var(--color-surface)] px-4 py-3 text-sm">
            <div className="text-xs text-[var(--color-muted)]">Account</div>
            <div className="mt-1 font-medium">
              {transaction.account_name} •••• {transaction.account_last_four ?? "—"}
            </div>
          </div>
          <div className="bg-[var(--color-surface)] px-4 py-3 text-sm">
            <div className="text-xs text-[var(--color-muted)]">Import evidence</div>
            <div className="mt-1 truncate font-medium" title={transaction.source_filename}>
              {transaction.source_filename}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
