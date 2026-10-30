import { PageHeader } from "@/components/kpi";
import { DataTable, FilterPills, RowLink, TablePanel, TableToolbar, Td, Th, Tr, statusFilterOptions } from "@/components/table-ui";
import { Badge, EmptyState } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { listChangeOrders } from "@/lib/billing";
import { CHANGE_ORDER_STATUS, type ChangeOrderStatus } from "@/lib/billing-types";
import { fmtDate } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";

export const dynamic = "force-dynamic";

const FILTERS: ChangeOrderStatus[] = ["draft", "sent", "accepted", "declined", "cancelled"];

export default async function ChangeOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: requested } = await searchParams;
  const status = FILTERS.find((value) => value === requested) ?? null;
  const [, orders] = await Promise.all([requireStaff(), listChangeOrders(status)]);
  return (
    <div className="page-fill">
      <PageHeader title="Change Orders" />
      <TableToolbar>
        <FilterPills
          label="Change order status"
          value={status ?? "all"}
          options={statusFilterOptions("/change-orders", FILTERS, (value) => CHANGE_ORDER_STATUS[value].label)}
        />
      </TableToolbar>
      <TablePanel fill>
        <DataTable minWidth={640}>
          <thead>
            <tr>
              <Th>Change order</Th>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th numeric>Total</Th>
              <Th numeric>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <Tr key={order.id}>
                <Td>
                  <RowLink href={`/jobs/${encodeURIComponent(order.jobId)}/change-orders/${order.id}`}>
                    #{order.number} {order.name}
                  </RowLink>
                </Td>
                <Td muted>{order.customerName ?? "—"}</Td>
                <Td>
                  <Badge tone={CHANGE_ORDER_STATUS[order.status].tone}>{CHANGE_ORDER_STATUS[order.status].label}</Badge>
                </Td>
                <Td numeric>{fmtCents(order.amountCents)}</Td>
                <Td numeric muted>
                  {fmtDate(order.updatedAt)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        {orders.length ? null : (
          <EmptyState>
            {status ? "No change orders with this status." : "No change orders yet. Create them from a job's Change orders tab."}
          </EmptyState>
        )}
      </TablePanel>
    </div>
  );
}
