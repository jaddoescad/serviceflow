import { PageHeader } from "@/components/kpi";
import { LeadsTable } from "@/components/leads-table";
import { getDealsPage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const search = (params.q ?? "").slice(0, 200);
  const requestedPage = Math.max(1, Math.min(1000000, Number.parseInt(params.page ?? "1", 10) || 1));
  const { rows, total } = await getDealsPage(search, requestedPage);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / 50)));
  return <>
    <PageHeader title="Deals" subtitle={`${total.toLocaleString("en-CA")} deals`} />
    <LeadsTable leads={rows} total={total} currentPage={page} query={search} />
  </>;
}
