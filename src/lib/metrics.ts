import { computeDurations, isStaleActive, wasEdited } from "@/lib/hours";
import { dayKey } from "@/lib/format";
import {
  invoicedProjectHours,
  invoicedProjectWagesBeforeTax,
  isLabourExcludedProject,
  latestProjectActivity,
} from "@/lib/invoice-activity";
import type {
  Assignment,
  EmployeePayRate,
  EmployeeProfile,
  Project,
  ProjectBudget,
  ProjectLabourExpense,
  ProjectLabourTask,
  ProjectLabourTaskTimeEntry,
  TimeEntry,
} from "@/lib/types";

// A clock-in this far from the job site is worth flagging for review.
const OFFSITE_DISTANCE_METERS = 250;

export type BudgetStatus = "none" | "under" | "near" | "over";

export const HST_RATE = 0.13;
export const LABOUR_MIN_PERCENT = 35;
export const LABOUR_MAX_PERCENT = 38;
export const LABOUR_ALERT_PERCENT = 40;

export type ProjectRollup = {
  projectId: string;
  name: string;
  address: string | null;
  labourExcluded: boolean;
  loggedHours: number;
  budgetedHours: number | null;
  amountIncludingTax: number | null;
  amountBeforeTax: number | null;
  amountSource: "calculator" | "manual" | null;
  hourlyRate: number | null;
  remainingHours: number | null;
  percentUsed: number | null;
  status: BudgetStatus;
  laborCost: number | null;
  budgetCost: number | null;
  labourAllowanceLow: number | null;
  labourAllowanceHigh: number | null;
  wageCost: number;
  wageSharePercent: number | null;
  allowanceUsedLowPercent: number | null;
  allowanceUsedHighPercent: number | null;
  remainingLabourLow: number | null;
  remainingLabourHigh: number | null;
  unpricedHours: number;
  assignedCount: number;
  lastActivity: string | null;
  clockedHours: number;
  invoicedHours: number;
  fixedLabourCost: number;
  expenseCount: number;
};

export type ProjectCrewHours = {
  crewId: string;
  name: string;
  email: string | null;
  hours: number;
  entryCount: number;
  lastActivity: string;
  wageCost: number;
  unpricedHours: number;
  hourlyRates: number[];
};

export type ProjectEntryDetail = {
  id: string;
  userName: string;
  startedAt: string;
  endedAt: string | null;
  status: TimeEntry["status"];
  hours: number;
  approved: boolean;
  notes: string | null;
  hourlyRate: number | null;
  wageCost: number | null;
};

export type ProjectLabourExpenseDetail = {
  id: string;
  workerName: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountBeforeTax: number;
  taxAmount: number;
  notes: string | null;
};

export type ProjectDetail = {
  entryCount: number;
  activeEntryCount: number;
  crew: ProjectCrewHours[];
  recentEntries: ProjectEntryDetail[];
  labourExpenses: ProjectLabourExpenseDetail[];
};

export type ProjectTaskContributor = {
  userId: string;
  name: string;
  hours: number;
  active: boolean;
};

export type ProjectTaskProgress = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  budgetedHours: number;
  spentHours: number;
  contributors: ProjectTaskContributor[];
};

export type EmployeeRollup = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  loggedHours: number;
  entryCount: number;
  lastActivity: string | null;
};

export function budgetStatus(wageSharePercent: number | null): BudgetStatus {
  if (wageSharePercent == null) return "none";
  return wageSharePercent >= LABOUR_ALERT_PERCENT ? "over" : "under";
}

export function amountBeforeTax(amountIncludingTax: number | null | undefined): number | null {
  if (amountIncludingTax == null || !Number.isFinite(amountIncludingTax)) return null;
  return amountIncludingTax / (1 + HST_RATE);
}

type PayRateIndex = Map<string, EmployeePayRate[]>;

export function buildPayRateIndex(payRates: EmployeePayRate[]): PayRateIndex {
  const index: PayRateIndex = new Map();
  for (const rate of payRates) {
    const rates = index.get(rate.user_id) ?? [];
    rates.push(rate);
    index.set(rate.user_id, rates);
  }
  for (const rates of index.values()) {
    rates.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  }
  return index;
}

export function payRateAt(index: PayRateIndex, userId: string | null, at: string): number | null {
  if (!userId) return null;
  const entryDate = at.slice(0, 10);
  const rates = index.get(userId) ?? [];
  let applicable: number | null = null;
  for (const rate of rates) {
    if (rate.effective_from > entryDate) break;
    applicable = Number(rate.hourly_rate);
  }
  return applicable;
}

/** Per-project logged hours joined with budgets. */
export function rollupProjects(
  entries: TimeEntry[],
  projects: Project[],
  budgets: ProjectBudget[],
  assignments: Assignment[],
  payRates: EmployeePayRate[],
  labourExpenses: ProjectLabourExpense[],
  now = Date.now(),
  defaultCalculatorProjectIds: Iterable<string> = [],
): ProjectRollup[] {
  const budgetById = new Map(budgets.map((b) => [b.companycam_project_id, b]));
  const defaultCalculatorProjects = new Set(defaultCalculatorProjectIds);
  const assignedById = new Map<string, number>();
  for (const a of assignments) {
    assignedById.set(a.companycam_project_id, (assignedById.get(a.companycam_project_id) ?? 0) + 1);
  }

  const hoursById = new Map<string, number>();
  const wagesById = new Map<string, number>();
  const unpricedById = new Map<string, number>();
  const expenseCostById = new Map<string, number>();
  const expenseCountById = new Map<string, number>();
  const expenseLastById = new Map<string, string>();
  const payRateIndex = buildPayRateIndex(payRates);
  const lastById = new Map<string, string>();
  const nameById = new Map<string, string>();
  const addrById = new Map<string, string | null>();

  for (const p of projects) {
    nameById.set(p.companycam_id, p.name);
    addrById.set(p.companycam_id, p.formatted_address);
  }

  for (const e of entries) {
    const id = e.companycam_project_id;
    if (!id) continue;
    const hours = computeDurations(e, now).totalHours;
    hoursById.set(id, (hoursById.get(id) ?? 0) + hours);
    const payRate = payRateAt(payRateIndex, e.user_id, e.started_at);
    if (payRate == null) unpricedById.set(id, (unpricedById.get(id) ?? 0) + hours);
    else wagesById.set(id, (wagesById.get(id) ?? 0) + hours * payRate);
    if (!nameById.has(id)) nameById.set(id, e.project_name);
    const prev = lastById.get(id);
    if (!prev || new Date(e.started_at) > new Date(prev)) lastById.set(id, e.started_at);
  }

  for (const expense of labourExpenses) {
    const id = expense.companycam_project_id;
    const amount = Math.max(0, Number(expense.amount_before_tax) || 0);
    expenseCostById.set(id, (expenseCostById.get(id) ?? 0) + amount);
    expenseCountById.set(id, (expenseCountById.get(id) ?? 0) + 1);
    const activity = `${expense.invoice_date}T12:00:00.000Z`;
    const prev = expenseLastById.get(id);
    if (!prev || new Date(activity) > new Date(prev)) expenseLastById.set(id, activity);
  }

  // A budget can outlive the active CompanyCam project it belonged to. Keep
  // that record for audit, but do not turn it into a nameless job row.
  const ids = new Set<string>([...nameById.keys(), ...hoursById.keys()]);
  const rollups: ProjectRollup[] = [];

  for (const id of ids) {
    const budget = budgetById.get(id);
    const name = nameById.get(id)?.trim();
    if (!name) continue;
    const labourExcluded = isLabourExcludedProject(name);
    const clockedHours = labourExcluded ? 0 : (hoursById.get(id) ?? 0);
    const invoicedHours = labourExcluded ? 0 : invoicedProjectHours(name);
    // The two sources describe the same labour, so use the stronger total
    // instead of adding them and double-counting the job.
    const logged = Math.max(clockedHours, invoicedHours);
    const budgetedHours = budget?.budgeted_hours ?? null;
    const rate = budget?.hourly_rate ?? null;
    const invoiceAmount = budget?.amount_including_tax ?? null;
    const preTaxAmount = amountBeforeTax(invoiceAmount);
    const clockedWageCost = labourExcluded ? 0 : (wagesById.get(id) ?? 0);
    const invoicedWageCost = labourExcluded ? 0 : invoicedProjectWagesBeforeTax(name);
    const fixedLabourCost = labourExcluded ? 0 : (expenseCostById.get(id) ?? 0);
    // Clocked time and painter invoices can describe the same work. Use the
    // stronger total so HST is excluded and labour is never double-counted.
    // Fixed-price subcontractor invoices are a separate source and are added.
    const wageCost = Math.max(clockedWageCost, invoicedWageCost) + fixedLabourCost;
    const allowanceLow = preTaxAmount != null ? preTaxAmount * (LABOUR_MIN_PERCENT / 100) : null;
    const allowanceHigh = preTaxAmount != null ? preTaxAmount * (LABOUR_MAX_PERCENT / 100) : null;
    const wageSharePercent = labourExcluded
      ? null
      : preTaxAmount && preTaxAmount > 0
        ? (wageCost / preTaxAmount) * 100
        : null;
    const allowanceUsedLowPercent = allowanceLow && allowanceLow > 0 ? (wageCost / allowanceLow) * 100 : null;
    const allowanceUsedHighPercent = allowanceHigh && allowanceHigh > 0 ? (wageCost / allowanceHigh) * 100 : null;
    const percentUsed = allowanceUsedHighPercent;
    rollups.push({
      projectId: id,
      name,
      address: addrById.get(id) ?? null,
      labourExcluded,
      loggedHours: logged,
      budgetedHours,
      amountIncludingTax: invoiceAmount,
      amountBeforeTax: preTaxAmount,
      amountSource:
        invoiceAmount == null
          ? null
          : defaultCalculatorProjects.has(id)
            ? "calculator"
            : "manual",
      hourlyRate: rate,
      remainingHours: budgetedHours != null ? budgetedHours - logged : null,
      percentUsed,
      status: budgetStatus(wageSharePercent),
      laborCost: wageCost,
      budgetCost: allowanceHigh,
      labourAllowanceLow: allowanceLow,
      labourAllowanceHigh: allowanceHigh,
      wageCost,
      wageSharePercent,
      allowanceUsedLowPercent,
      allowanceUsedHighPercent,
      remainingLabourLow: allowanceLow != null ? allowanceLow - wageCost : null,
      remainingLabourHigh: allowanceHigh != null ? allowanceHigh - wageCost : null,
      unpricedHours: labourExcluded ? 0 : (unpricedById.get(id) ?? 0),
      assignedCount: assignedById.get(id) ?? 0,
      lastActivity: latestProjectActivity(name, latestActivity(lastById.get(id), expenseLastById.get(id))),
      clockedHours,
      invoicedHours,
      fixedLabourCost,
      expenseCount: expenseCountById.get(id) ?? 0,
    });
  }

  return rollups.sort(compareProjectsByActivity);
}

function compareProjectsByActivity(a: ProjectRollup, b: ProjectRollup): number {
  const aHasHours = a.loggedHours > 0;
  const bHasHours = b.loggedHours > 0;

  // Active jobs stay together at the top; jobs without time entries follow.
  if (aHasHours !== bHasHours) return aHasHours ? -1 : 1;

  if (aHasHours && bHasHours) {
    const activityDelta = activityTime(b.lastActivity) - activityTime(a.lastActivity);
    if (activityDelta !== 0) return activityDelta;

    const hoursDelta = b.loggedHours - a.loggedHours;
    if (hoursDelta !== 0) return hoursDelta;
  }

  return a.name.localeCompare(b.name, "en-CA");
}

function activityTime(value: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestActivity(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

/** Per-job painter task progress with per-painter contributions, matching the mobile app. */
export function projectTaskProgress(
  tasks: ProjectLabourTask[],
  taskEntries: ProjectLabourTaskTimeEntry[],
  employees: EmployeeProfile[],
  now = Date.now(),
): Record<string, ProjectTaskProgress[]> {
  const nameByUserId = new Map(
    employees.map((employee) => [employee.user_id, employee.full_name ?? employee.email ?? "Painter"]),
  );
  const entriesByTask = new Map<string, ProjectLabourTaskTimeEntry[]>();
  for (const entry of taskEntries) {
    const list = entriesByTask.get(entry.task_id) ?? [];
    list.push(entry);
    entriesByTask.set(entry.task_id, list);
  }

  const byProject: Record<string, ProjectTaskProgress[]> = {};
  for (const task of tasks) {
    const contributors = new Map<string, ProjectTaskContributor>();
    let spentHours = 0;
    for (const entry of entriesByTask.get(task.id) ?? []) {
      const startedAt = Date.parse(entry.started_at);
      const endedAt = entry.ended_at ? Date.parse(entry.ended_at) : now;
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) continue;
      const hours = Math.max(0, endedAt - startedAt) / 3_600_000;
      const active = entry.ended_at == null;
      spentHours += hours;
      const current = contributors.get(entry.user_id);
      if (current) {
        current.hours += hours;
        current.active = current.active || active;
      } else {
        contributors.set(entry.user_id, {
          userId: entry.user_id,
          name: nameByUserId.get(entry.user_id) ?? "Painter",
          hours,
          active,
        });
      }
    }
    (byProject[task.companycam_project_id] ??= []).push({
      id: task.id,
      title: task.title,
      notes: task.notes,
      status: task.status,
      budgetedHours: Math.max(0, task.budgeted_hours ?? 0),
      spentHours,
      contributors: [...contributors.values()].sort((a, b) => b.hours - a.hours),
    });
  }
  return byProject;
}

/** Compact drill-down data for the jobs table. */
export function projectDetails(
  entries: TimeEntry[],
  payRates: EmployeePayRate[],
  labourExpenses: ProjectLabourExpense[],
  now = Date.now(),
): Record<string, ProjectDetail> {
  const payRateIndex = buildPayRateIndex(payRates);
  const byProject = new Map<
    string,
    {
      entries: ProjectEntryDetail[];
      crew: Map<string, ProjectCrewHours>;
      ratesByCrew: Map<string, Set<number>>;
      activeEntryCount: number;
      labourExpenses: ProjectLabourExpenseDetail[];
    }
  >();

  for (const entry of entries) {
    if (isLabourExcludedProject(entry.project_name)) continue;
    const projectId = entry.companycam_project_id;
    if (!projectId) continue;

    let project = byProject.get(projectId);
    if (!project) {
      project = { entries: [], crew: new Map(), ratesByCrew: new Map(), activeEntryCount: 0, labourExpenses: [] };
      byProject.set(projectId, project);
    }

    const hours = computeDurations(entry, now).totalHours;
    const hourlyRate = payRateAt(payRateIndex, entry.user_id, entry.started_at);
    const wageCost = hourlyRate != null ? hours * hourlyRate : null;
    const crewId = entry.user_id ?? entry.user_email ?? entry.user_name ?? `unknown-${entry.id}`;
    const current = project.crew.get(crewId);
    if (current) {
      current.hours += hours;
      current.entryCount += 1;
      if (wageCost != null) current.wageCost += wageCost;
      else current.unpricedHours += hours;
      if (new Date(entry.started_at) > new Date(current.lastActivity)) {
        current.lastActivity = entry.started_at;
      }
    } else {
      project.crew.set(crewId, {
        crewId,
        name: entry.user_name ?? entry.user_email ?? "Unknown painter",
        email: entry.user_email,
        hours,
        entryCount: 1,
        lastActivity: entry.started_at,
        wageCost: wageCost ?? 0,
        unpricedHours: wageCost == null ? hours : 0,
        hourlyRates: [],
      });
    }
    if (hourlyRate != null) {
      const usedRates = project.ratesByCrew.get(crewId) ?? new Set<number>();
      usedRates.add(hourlyRate);
      project.ratesByCrew.set(crewId, usedRates);
    }

    project.entries.push({
      id: entry.id,
      userName: entry.user_name ?? entry.user_email ?? "Unknown painter",
      startedAt: entry.started_at,
      endedAt: entry.ended_at,
      status: entry.status,
      hours,
      approved: Boolean(entry.approved_at),
      notes: entry.notes,
      hourlyRate,
      wageCost,
    });
    if (entry.status === "active") project.activeEntryCount += 1;
  }

  for (const expense of labourExpenses) {
    const projectId = expense.companycam_project_id;
    let project = byProject.get(projectId);
    if (!project) {
      project = { entries: [], crew: new Map(), ratesByCrew: new Map(), activeEntryCount: 0, labourExpenses: [] };
      byProject.set(projectId, project);
    }
    project.labourExpenses.push({
      id: expense.id,
      workerName: expense.worker_name,
      supplierName: expense.supplier_name,
      invoiceNumber: expense.invoice_number,
      invoiceDate: expense.invoice_date,
      amountBeforeTax: Number(expense.amount_before_tax),
      taxAmount: Number(expense.tax_amount),
      notes: expense.notes,
    });
  }

  return Object.fromEntries(
    [...byProject.entries()].map(([projectId, detail]) => [
      projectId,
      {
        entryCount: detail.entries.length,
        activeEntryCount: detail.activeEntryCount,
        crew: [...detail.crew.values()]
          .map((member) => ({
            ...member,
            hourlyRates: [...(detail.ratesByCrew.get(member.crewId) ?? [])].sort((a, b) => a - b),
          }))
          .sort((a, b) => b.wageCost - a.wageCost || b.hours - a.hours),
        recentEntries: detail.entries
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
          .slice(0, 12),
        labourExpenses: detail.labourExpenses.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate)),
      },
    ]),
  );
}

export function rollupEmployees(
  entries: TimeEntry[],
  employees: EmployeeProfile[],
  now = Date.now(),
): EmployeeRollup[] {
  const byId = new Map<string, EmployeeRollup>();
  for (const emp of employees) {
    byId.set(emp.user_id, {
      userId: emp.user_id,
      name: emp.full_name ?? emp.email ?? "Unknown",
      email: emp.email,
      role: emp.role,
      isActive: emp.is_active,
      loggedHours: 0,
      entryCount: 0,
      lastActivity: null,
    });
  }

  for (const e of entries) {
    if (!e.user_id) continue;
    let row = byId.get(e.user_id);
    if (!row) {
      row = {
        userId: e.user_id,
        name: e.user_name ?? e.user_email ?? "Unknown",
        email: e.user_email,
        role: "painter",
        isActive: true,
        loggedHours: 0,
        entryCount: 0,
        lastActivity: null,
      };
      byId.set(e.user_id, row);
    }
    row.loggedHours += computeDurations(e, now).totalHours;
    row.entryCount += 1;
    if (!row.lastActivity || new Date(e.started_at) > new Date(row.lastActivity)) {
      row.lastActivity = e.started_at;
    }
  }

  return [...byId.values()].sort((a, b) => b.loggedHours - a.loggedHours);
}

/** Stacked on-site/off-site hours per local day, ascending, filled for range. */
export function hoursByDay(entries: TimeEntry[], days: number, now = Date.now()) {
  const buckets = new Map<string, { onSite: number; offSite: number }>();
  const today = new Date(now);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(dayKey(d), { onSite: 0, offSite: 0 });
  }
  for (const e of entries) {
    const key = dayKey(e.started_at);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const dur = computeDurations(e, now);
    bucket.onSite += dur.onSiteMs / 3_600_000;
    bucket.offSite += dur.offSiteMs / 3_600_000;
  }
  return [...buckets.entries()].map(([day, v]) => ({
    day,
    onSite: round1(v.onSite),
    offSite: round1(v.offSite),
    total: round1(v.onSite + v.offSite),
  }));
}

export function sumHours(entries: TimeEntry[], now = Date.now()): number {
  return entries.reduce((acc, e) => acc + computeDurations(e, now).totalHours, 0);
}

export type Attention = {
  missingClockOut: TimeEntry[];
  edited: TimeEntry[];
  offSite: TimeEntry[];
};

export function attentionLists(entries: TimeEntry[], now = Date.now()): Attention {
  const missingClockOut: TimeEntry[] = [];
  const edited: TimeEntry[] = [];
  const offSite: TimeEntry[] = [];
  for (const e of entries) {
    if (isStaleActive(e, now)) missingClockOut.push(e);
    if (wasEdited(e)) edited.push(e);
    if ((e.last_distance_meters ?? 0) > OFFSITE_DISTANCE_METERS) offSite.push(e);
  }
  return { missingClockOut, edited, offSite };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
