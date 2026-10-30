"use client";

import { useState } from "react";
import type { JobCost } from "@/lib/crm-types";
import { fmtCents } from "@/lib/line-items";
import { DataTable, FilterPills, RowLink, TablePanel, TableToolbar, Td, Th, Tr } from "./table-ui";
import { EmptyState, Stat, StatGrid, cn } from "./ui";

const STATUSES = [
  { value: "", label: "All jobs" },
  { value: "active", label: "In progress" },
  { value: "scheduled", label: "Not started" },
  { value: "completed", label: "Finished" },
];

const margin = (revenue: number, labour: number) => (revenue > 0 ? ((revenue - labour) / revenue) * 100 : null);

export function JobCostingTable({ jobs }: { jobs: JobCost[] }) {
  const [status, setStatus] = useState("");
  const rows = status ? jobs.filter((job) => job.status === status) : jobs;
  const total = rows.reduce(
    (sum, job) => ({
      revenue: sum.revenue + job.revenueCents,
      labour: sum.labour + job.labourCents,
    }),
    { revenue: 0, labour: 0 },
  );
  const overall = margin(total.revenue, total.labour);
  return (
    <>
      <StatGrid columns={4} flush className="shrink-0">
        <Stat label="Revenue" value={fmtCents(total.revenue)} hint={`${rows.length} jobs`} />
        <Stat label="Crew wages" value={fmtCents(total.labour)} hint="Clocked hours × pay rate" />
        <Stat label="Profit after labour" value={fmtCents(total.revenue - total.labour)} tone={total.revenue - total.labour < 0 ? "bad" : "good"} />
        <Stat label="Margin" value={overall == null ? "—" : `${overall.toFixed(0)}%`} />
      </StatGrid>
      <TableToolbar>
        <FilterPills label="Job status" value={status} options={STATUSES} onChange={setStatus} />
      </TableToolbar>
      <TablePanel
        fill
        footer={<span>* Some hours have no pay rate on file, so wages are understated. Materials are not included.</span>}
      >
        <DataTable minWidth={820}>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Stage</Th>
              <Th numeric>Revenue</Th>
              <Th numeric>Paid</Th>
              <Th numeric>Hours</Th>
              <Th numeric>Wages</Th>
              <Th numeric>Profit</Th>
              <Th numeric>Margin</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((job) => {
              const profit = job.revenueCents - job.labourCents;
              const jobMargin = margin(job.revenueCents, job.labourCents);
              return (
                <Tr key={job.id}>
                  <Td>
                    <RowLink href={`/jobs/${encodeURIComponent(job.id)}/labour`}>{job.name}</RowLink>
                  </Td>
                  <Td muted>{job.stageName ?? job.status}</Td>
                  <Td numeric>{fmtCents(job.revenueCents)}</Td>
                  <Td numeric>{fmtCents(job.paidCents)}</Td>
                  <Td numeric>
                    {job.hours.toFixed(1)}
                    {job.unpricedHours ? <span title="Hours with no pay rate on file" className="text-[var(--color-warn)]"> *</span> : null}
                  </Td>
                  <Td numeric>{fmtCents(job.labourCents)}</Td>
                  <Td numeric className={cn("font-semibold", profit < 0 && "text-[var(--color-bad)]")}>
                    {fmtCents(profit)}
                  </Td>
                  <Td numeric className={cn(jobMargin != null && jobMargin < 50 && "text-[var(--color-warn)]")}>
                    {jobMargin == null ? "—" : `${jobMargin.toFixed(0)}%`}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
        {rows.length ? null : <EmptyState>{jobs.length ? "No jobs with this status." : "No jobs yet."}</EmptyState>}
      </TablePanel>
    </>
  );
}
