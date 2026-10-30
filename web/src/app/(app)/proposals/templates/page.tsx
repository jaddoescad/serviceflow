import Link from "next/link";
import { PageHeader } from "@/components/kpi";
import { DataTable, RowLink, TablePanel, Td, Th, Tr } from "@/components/table-ui";
import { EmptyState, buttonClassName } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { depositCents, documentTotals, fmtCents } from "@/lib/line-items";
import { getProposalTemplates } from "@/lib/proposals";
import { ProposalsTabs } from "../tabs";

export const dynamic = "force-dynamic";

export default async function ProposalTemplatesPage() {
  const [, templates] = await Promise.all([requireStaff(), getProposalTemplates()]);
  return (
    <div className="page-fill">
      <PageHeader
        title="Proposals"
        actions={
          <Link href="/proposals/templates/new" className={buttonClassName()}>
            + New Template
          </Link>
        }
      />
      <ProposalsTabs active="templates" />
      <TablePanel fill>
        <DataTable minWidth={560}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th numeric>Items</Th>
              <Th numeric>Deposit</Th>
              <Th numeric>Total</Th>
              <Th numeric>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => {
              const total = documentTotals(template.items, template.taxRatePercent, {
                percent: template.discountPercent,
                cents: template.discountCents,
              }).totalCents;
              return (
                <Tr key={template.id}>
                  <Td>
                    <RowLink href={`/proposals/templates/${template.id}`}>{template.name}</RowLink>
                  </Td>
                  <Td numeric>{template.items.length}</Td>
                  <Td numeric>
                    {template.depositPercent != null
                      ? `${template.depositPercent}%`
                      : template.depositCents != null
                        ? fmtCents(depositCents(total, { percent: null, cents: template.depositCents }))
                        : "—"}
                  </Td>
                  <Td numeric>{fmtCents(total)}</Td>
                  <Td numeric muted>
                    {fmtDate(template.updatedAt)}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
        {templates.length ? null : <EmptyState>No templates yet.</EmptyState>}
      </TablePanel>
    </div>
  );
}
