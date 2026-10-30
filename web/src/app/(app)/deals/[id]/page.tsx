import { notFound } from "next/navigation";
import { DealRecord } from "@/components/deal-record";
import { requireStaff } from "@/lib/auth";
import { getDealRecord } from "@/lib/pipeline";
import { isDealTab } from "@/lib/pipeline-types";
import { getProjectLabels } from "@/lib/project-workspace";

export const dynamic = "force-dynamic";

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [, record, labels] = await Promise.all([requireStaff(), getDealRecord(decodeURIComponent(id)), getProjectLabels()]);
  if (!record) notFound();
  return (
    <DealRecord
      key={record.deal.id}
      {...record}
      allLabels={labels}
      initialTab={isDealTab(query.tab) ? query.tab : "communications"}
    />
  );
}
