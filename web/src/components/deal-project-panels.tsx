import Link from "next/link";
import { Suspense } from "react";
import { PhotosSlot } from "@/components/project-photos-slot";
import { DocumentsSlot, OverviewSlot, TasksSlot } from "@/components/project-slots";
import { OverviewPanelSkeleton, PhotosPanelSkeleton, TasksPanelSkeleton } from "@/components/skeletons";
import { DataTable, RowLink, TablePanel, Td, Th, Tr } from "@/components/table-ui";
import { Badge, EmptyState, buttonClassName } from "@/components/ui";
import { getJobChangeOrders } from "@/lib/billing";
import { CHANGE_ORDER_STATUS } from "@/lib/billing-types";
import { fmtDate } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import type { DealProjectTab } from "@/lib/pipeline-types";

// The deal page's project tabs (photos, documents, change orders, labour
// budget, tasks). They load on the server only when opened, so the deal page
// stays quick.

async function ChangeOrders({ jobId }: { jobId: string }) {
  const orders = await getJobChangeOrders(jobId);
  const base = `/jobs/${encodeURIComponent(jobId)}/change-orders`;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link href={`${base}/new`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
          New change order
        </Link>
      </div>
      <TablePanel>
        <DataTable minWidth={520}>
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
    </div>
  );
}

/** One project tab's content. `projectId` is the job once there is one, else the deal. */
export function DealProjectPanel({
  tab,
  projectId,
  hasJob,
}: {
  tab: DealProjectTab;
  projectId: string;
  hasJob: boolean;
}) {
  switch (tab) {
    case "photos":
      return (
        <Suspense fallback={<PhotosPanelSkeleton />}>
          <PhotosSlot projectId={projectId} showProfile={false} />
        </Suspense>
      );
    case "documents":
      return (
        <Suspense fallback={<TasksPanelSkeleton />}>
          <DocumentsSlot projectId={projectId} />
        </Suspense>
      );
    case "change-orders":
      return hasJob ? (
        <Suspense fallback={<TasksPanelSkeleton />}>
          <ChangeOrders jobId={projectId} />
        </Suspense>
      ) : (
        <EmptyState>Change orders start once a proposal is accepted.</EmptyState>
      );
    case "labour":
      return (
        <Suspense fallback={<OverviewPanelSkeleton />}>
          <OverviewSlot projectId={projectId} />
        </Suspense>
      );
    case "tasks":
      return (
        <Suspense fallback={<TasksPanelSkeleton />}>
          <TasksSlot projectId={projectId} />
        </Suspense>
      );
  }
}
