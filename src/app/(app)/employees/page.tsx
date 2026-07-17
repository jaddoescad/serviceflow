import { getTimeEntries, getEmployees, getEmployeePayRates, getAssignments } from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { buildPayRateIndex, payRateAt, rollupEmployees } from "@/lib/metrics";
import { PageHeader } from "@/components/kpi";
import { EmployeesTable, type CrewRow } from "@/components/employees-table";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function EmployeesPage() {
  const now = Date.now();
  const [profile, entries, employees, payRates, assignments] = await Promise.all([
    requireStaff(),
    getTimeEntries(new Date(now - 30 * DAY).toISOString()),
    getEmployees(),
    getEmployeePayRates(),
    getAssignments(),
  ]);

  const assignedByUser = new Map<string, number>();
  for (const a of assignments) {
    assignedByUser.set(a.user_id, (assignedByUser.get(a.user_id) ?? 0) + 1);
  }

  const rollups = rollupEmployees(entries, employees, now);
  const byId = new Map(rollups.map((r) => [r.userId, r]));
  const payRateIndex = buildPayRateIndex(payRates);
  const today = new Date(now).toISOString();

  const rows: CrewRow[] = employees.map((emp) => {
    const r = byId.get(emp.user_id);
    return {
      userId: emp.user_id,
      name: emp.full_name ?? emp.email ?? "Unknown",
      email: emp.email,
      role: emp.role,
      isActive: emp.is_active,
      loggedHours: r?.loggedHours ?? 0,
      lastActivity: r?.lastActivity ?? null,
      assignedCount: assignedByUser.get(emp.user_id) ?? 0,
      currentPayRate: payRateAt(payRateIndex, emp.user_id, today),
      payRates: payRates.filter((rate) => rate.user_id === emp.user_id),
    };
  });

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
