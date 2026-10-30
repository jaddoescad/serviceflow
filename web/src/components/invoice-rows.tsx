import { INVOICE_STATUS, type InvoiceSummary } from "@/lib/billing-types";
import { fmtDate } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import { DataTable, RowLink, Td, Th, Tr } from "./table-ui";
import { Badge } from "./ui";

/** Invoice table; less important columns drop away on narrow screens, so it
 * fits without sideways scrolling wherever it is placed. */
export function InvoiceRows({
  invoices,
  showCustomer = true,
}: {
  invoices: InvoiceSummary[];
  showCustomer?: boolean;
}) {
  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Invoice</Th>
          {showCustomer ? <Th className="hidden md:table-cell">Customer</Th> : null}
          <Th>Status</Th>
          <Th numeric>Amount</Th>
          <Th numeric className="hidden sm:table-cell">Paid</Th>
          <Th numeric>Balance</Th>
          <Th numeric className="hidden lg:table-cell">Issued</Th>
          <Th numeric className="hidden lg:table-cell">Due</Th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <Tr key={invoice.id}>
            <Td>
              <RowLink href={`/jobs/${encodeURIComponent(invoice.jobId)}/invoices/${invoice.id}`}>
                #{invoice.number} {invoice.name}
              </RowLink>
            </Td>
            {showCustomer ? (
              <Td muted className="hidden md:table-cell">
                {invoice.customerName ?? invoice.jobName}
              </Td>
            ) : null}
            <Td>
              <Badge tone={INVOICE_STATUS[invoice.status].tone}>{INVOICE_STATUS[invoice.status].label}</Badge>
            </Td>
            <Td numeric>{fmtCents(invoice.amountCents)}</Td>
            <Td numeric className="hidden sm:table-cell">
              {fmtCents(invoice.paidCents)}
            </Td>
            <Td numeric className="font-semibold">
              {invoice.status === "void" ? "—" : fmtCents(invoice.balanceCents)}
            </Td>
            <Td numeric muted className="hidden lg:table-cell">
              {fmtDate(invoice.issuedOn)}
            </Td>
            <Td numeric muted className="hidden lg:table-cell">
              {invoice.dueOn ? fmtDate(invoice.dueOn) : "—"}
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}
