import { JobCostingTable } from "@/components/job-costing-table";
import { PageHeader } from "@/components/kpi";
import { getJobCosting } from "@/lib/actions/crm";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function JobCostingPage() {
  await requireStaff();
  const jobs = await getJobCosting();
  return (
    <div className="page-fill">
      <PageHeader title="Job Costing" />
      <JobCostingTable jobs={jobs} />
    </div>
  );
}
