import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/kpi";
import { EmployeesTable, type CrewRow } from "@/components/employees-table";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const [profile, result] = await Promise.all([
    requireStaff(), createClient().then(client => client.rpc("get_crew_summary")),
  ]);
  if (result.error) throw new Error(`crew: ${result.error.message}`);
  const rows = result.data as CrewRow[];

  return (
    <>
      <PageHeader title="Crew" subtitle="Manage painters, pay rates, roles, and access" />
      <EmployeesTable
        rows={rows}
        canManage={profile.role === "admin"}
        canManageRates={["admin", "manager"].includes(profile.role)}
      />
    </>
  );
}
