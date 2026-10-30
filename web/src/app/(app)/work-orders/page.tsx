import { PageHeader } from "@/components/kpi";
import { DataTable, RowLink, TablePanel, TableToolbar, Td, Th, Tr } from "@/components/table-ui";
import { EmptyState, Input } from "@/components/ui";
import { getJobCosting } from "@/lib/actions/crm";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  await requireStaff();
  const query = q.trim().toLocaleLowerCase("en-CA");
  const jobs = (await getJobCosting())
    .filter((job) => job.status !== "completed")
    .filter((job) => !query || job.name.toLocaleLowerCase("en-CA").includes(query));
  return (
    <div className="page-fill">
      <PageHeader title="Work Orders" />
      <TableToolbar>
        <form action="/work-orders" className="w-full sm:w-64">
          <Input
            type="search"
            name="q"
            defaultValue={q}
            aria-label="Search work orders"
            placeholder="Search jobs"
          />
        </form>
      </TableToolbar>
      <TablePanel fill>
        <DataTable minWidth={680}>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Stage</Th>
              <Th numeric>Amount</Th>
              <Th numeric>Paid</Th>
              <Th numeric>Balance</Th>
              <Th numeric>Started</Th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <Tr key={job.id}>
                <Td>
                  <RowLink href={`/jobs/${encodeURIComponent(job.id)}/work-order`}>{job.name}</RowLink>
                </Td>
                <Td muted>{job.stageName ?? job.status}</Td>
                <Td numeric>{fmtCents(job.revenueCents)}</Td>
                <Td numeric>{fmtCents(job.paidCents)}</Td>
                <Td numeric className="font-semibold">
                  {fmtCents(job.revenueCents - job.paidCents)}
                </Td>
                <Td numeric muted>
                  {job.startedOn ? fmtDate(job.startedOn) : "—"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        {jobs.length ? null : <EmptyState>{q ? "No open jobs match this search." : "No open jobs."}</EmptyState>}
      </TablePanel>
    </div>
  );
}
