import { notFound } from "next/navigation";
import { BillingEditor } from "@/components/billing-editor";
import { requireStaff } from "@/lib/auth";
import { getChangeOrder } from "@/lib/billing";
import { getDocumentExtras } from "@/lib/documents";
import { getProjectShell } from "@/lib/project-data";
import { getCatalogItems } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export default async function ChangeOrderPage({
  params,
}: {
  params: Promise<{ id: string; changeOrderId: string }>;
}) {
  const { id, changeOrderId } = await params;
  const jobId = decodeURIComponent(id);
  const isNew = changeOrderId === "new";
  const [shell, order, catalog, extras] = await Promise.all([
    getProjectShell(jobId),
    isNew ? null : getChangeOrder(changeOrderId),
    getCatalogItems(),
    isNew ? null : getDocumentExtras("change_order", changeOrderId),
    requireStaff(),
  ]);
  if (!shell || shell.isLead || (!isNew && (!order || order.jobId !== jobId))) notFound();
  return (
    <BillingEditor
      key={order?.id ?? "new"}
      kind="change_order"
      id={order?.id ?? crypto.randomUUID()}
      jobId={jobId}
      isNew={isNew}
      changeOrder={order}
      catalog={catalog}
      extras={extras}
      initial={{
        name: order?.name ?? "Change order",
        items: order?.items ?? [],
        taxRatePercent: order?.taxRatePercent ?? 13,
        message: order?.intro ?? "",
        invoiceKind: "standard",
        issuedOn: "",
        dueOn: "",
      }}
      backHref={`/jobs/${encodeURIComponent(jobId)}/change-orders`}
      backLabel={shell.name}
    />
  );
}
