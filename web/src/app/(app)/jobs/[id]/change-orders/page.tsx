import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { JobShell } from "@/components/job-shell";
import { DataTable, RowLink, TablePanel, Td, Th, Tr } from "@/components/table-ui";
import { Badge, EmptyState, buttonClassName } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getJobChangeOrders } from "@/lib/billing";
import { CHANGE_ORDER_STATUS } from "@/lib/billing-types";
import { fmtDate } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import { getProjectShell } from "@/lib/project-data";

export const dynamic = "force-dynamic";

export default async function JobChangeOrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  const [shell, orders] = await Promise.all([getProjectShell(jobId), getJobChangeOrders(jobId), requireStaff()]);
  if (!shell) notFound();
  if (shell.canonicalJobId) redirect(`/jobs/${encodeURIComponent(shell.canonicalJobId)}/change-orders`);
  if (shell.isLead) redirect(`/jobs/${encodeURIComponent(jobId)}/proposals`);
  const base = `/jobs/${encodeURIComponent(jobId)}/change-orders`;
  return (
    <JobShell
      projectId={jobId}
      name={shell.name}
      address={shell.address}
      status={shell.status}
      photoCount={shell.photoCount}
      isLead={false}
      activeTab="change-orders"
      actions={
        <Link href={`${base}/new`} className={buttonClassName()}>
          + New Change Order
        </Link>
      }
    >
      <TablePanel>
        <DataTable minWidth={560}>
          <thead>
            <tr>
              <Th>Change order</Th>
              <Th>Status</Th>
              <Th numeric>Sent / updated</Th>
              <Th numeric>Total</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <Tr key={order.id}>
                <Td>
                  <RowLink href={`${base}/${order.id}`}>
                    #{order.number} {order.name}
                  </RowLink>
                </Td>
                <Td>
                  <Badge tone={CHANGE_ORDER_STATUS[order.status].tone}>{CHANGE_ORDER_STATUS[order.status].label}</Badge>
                </Td>
                <Td numeric muted>
                  {order.sentAt ? `Sent ${fmtDate(order.sentAt)}` : `Updated ${fmtDate(order.updatedAt)}`}
                </Td>
                <Td numeric>{fmtCents(order.amountCents)}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        {orders.length ? null : <EmptyState>No change orders yet.</EmptyState>}
      </TablePanel>
    </JobShell>
  );
}
