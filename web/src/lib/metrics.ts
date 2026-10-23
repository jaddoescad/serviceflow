import { computeDurations, isStaleActive, wasEdited } from "@/lib/hours";
import { dayKey } from "@/lib/format";
import type {
  Assignment,
  EmployeePayRate,
  EmployeeProfile,
  Project,
  ProjectBudget,
  ProjectLabourTask,
  TimeEntry,
} from "@/lib/types";

// A clock-in this far from the job site is worth flagging for review.
const OFFSITE_DISTANCE_METERS = 250;

export type BudgetStatus = "none" | "under" | "near" | "over";
export type LabourCostSource = "clocked_hours";

export const LABOUR_MIN_PERCENT = 35;
export const LABOUR_MAX_PERCENT = 37;
export const LABOUR_ALERT_PERCENT = 40;
// Budget hours count painters without a pay rate at this rate, as job_feed does.
export const DEFAULT_PAY_RATE = 30;

// An open job this quiet is almost certainly finished on site and just waiting
// for someone to confirm completion.
export const LABOUR_IDLE_NUDGE_DAYS = 30;

export type ProjectRollup = {
  projectId: string;
  name: string;
  address: string | null;
  jobStartedOn: string | null;
  productionMonth: string | null;
  labourExcluded: boolean;
  loggedHours: number;
  budgetedHours: number | null;
  amountBeforeTax: number | null;
  hourlyRate: number | null;
  remainingHours: number | null;
  percentUsed: number | null;
  status: BudgetStatus;
  /** Crew hours % and labour cost target % this job was budgeted with. */
  crewHoursPercent: number;
  costTargetPercent: number;
  laborCost: number | null;
  budgetCost: number | null;
  labourAllowanceLow: number | null;
  labourAllowanceHigh: number | null;
  /** Dollar cost of priced clocked hours only, using the effective employee pay rate. */
  clockedWageCost: number;
  labourCostSource: LabourCostSource;
  wageCost: number;
  wageSharePercent: number | null;
  allowanceUsedLowPercent: number | null;
  allowanceUsedHighPercent: number | null;
  remainingLabourLow: number | null;
  remainingLabourHigh: number | null;
  unpricedHours: number;
  assignedCount: number;
  lastActivity: string | null;
  /** Latest real clock-in; based on recorded time entries. */
  lastClockIn: string | null;
  clockedHours: number;
  labourClosedAt: string | null;
  labourBucket: LabourBucket;
};

/**
 * Which side of the accounting line a job sits on.
 *
 * `settled` jobs have a final labour cost against a final contract value, so
 * their ratio is true and they alone drive the headline labour share. Every
 * other bucket is reported on its own line: blending a part-spent job into the
 * average drags the percentage down and makes an unfinished book look healthy.
 */
export type LabourBucket =
  | "settled"
  | "in_flight"
  | "not_costed"
  | "missing_amount"
  | "excluded"
  | "idle";

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

export type ProjectDetail = {
  entryCount: number;
  activeEntryCount: number;
  crew: ProjectCrewHours[];
  entries: ProjectEntryDetail[];
};

/** A job's budget as the crew app shows it (`job_feed`): used hours count each painter's pay ÷ `rate`. */
export type BudgetUse = {
  budgetHours: number | null;
  usedHours: number;
  rate: number | null;
};

export type ProjectTaskProgress = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  completedAt: string | null;
  completedByName: string | null;
  budgetedHours: number;
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

export function budgetStatus(
  wageSharePercent: number | null,
  targetPercent: number = LABOUR_ALERT_PERCENT,
): BudgetStatus {
  if (wageSharePercent == null) return "none";
  return wageSharePercent >= targetPercent ? "over" : "under";
}

function classifyLabour(input: {
  labourExcluded: boolean;
  amountBeforeTax: number | null;
  wageCost: number;
  labourClosedAt: string | null;
}): LabourBucket {
  if (input.labourExcluded) return "excluded";
  const hasAmount = input.amountBeforeTax != null && input.amountBeforeTax > 0;
  const hasLabour = input.wageCost > 0;
  if (!hasAmount) return hasLabour ? "missing_amount" : "idle";
  if (!hasLabour) return "not_costed";
  return input.labourClosedAt ? "settled" : "in_flight";
}

export type LabourPool = {
  count: number;
  jobValue: number;
  labourCost: number;
  sharePercent: number | null;
};

export type LabourSummary = {
  /** Final numbers. This pool alone produces the headline percentage. */
  settled: LabourPool;
  /** Costs to date against full contract values — always incomplete. */
  inFlight: LabourPool;
  /** Job amount entered, no hours against it yet. */
  notCosted: LabourPool;
  /** Labour recorded but no job amount, so the job cannot be measured at all. */
  missingAmount: LabourPool;
  /** Settled or in-flight jobs already at or above the 40% alert line. */
  overCount: number;
  /** In-flight jobs with no activity for LABOUR_IDLE_NUDGE_DAYS — likely done. */
  readyToCloseCount: number;
};

function emptyPool(): LabourPool {
  return { count: 0, jobValue: 0, labourCost: 0, sharePercent: null };
}

function addToPool(pool: LabourPool, jobValue: number, labourCost: number): void {
  pool.count += 1;
  pool.jobValue += jobValue;
  pool.labourCost += labourCost;
}

function finishPool(pool: LabourPool): LabourPool {
  pool.sharePercent = pool.jobValue > 0 ? (pool.labourCost / pool.jobValue) * 100 : null;
  return pool;
}

/** True when an open job has gone quiet long enough to prompt closing it. */
export function readyToCloseLabour(rollup: ProjectRollup, now = Date.now()): boolean {
  if (rollup.labourBucket !== "in_flight") return false;
  if (!rollup.lastActivity) return false;
  const last = new Date(rollup.lastActivity).getTime();
  if (!Number.isFinite(last)) return false;
  return now - last >= LABOUR_IDLE_NUDGE_DAYS * 86_400_000;
}

/**
 * Split every job into its accounting bucket and total each one separately.
 *
 * Deliberately never returns a combined percentage across settled and in-flight
 * work: that blended figure is the one this replaces.
 */
export function summarizeLabour(rollups: ProjectRollup[], now = Date.now()): LabourSummary {
  const summary: LabourSummary = {
    settled: emptyPool(),
    inFlight: emptyPool(),
    notCosted: emptyPool(),
    missingAmount: emptyPool(),
    overCount: 0,
    readyToCloseCount: 0,
  };

  for (const rollup of rollups) {
    const jobValue = rollup.amountBeforeTax ?? 0;
    switch (rollup.labourBucket) {
      case "settled":
        addToPool(summary.settled, jobValue, rollup.wageCost);
        break;
      case "in_flight":
        addToPool(summary.inFlight, jobValue, rollup.wageCost);
        if (readyToCloseLabour(rollup, now)) summary.readyToCloseCount += 1;
        break;
      case "not_costed":
        addToPool(summary.notCosted, jobValue, 0);
        break;
      case "missing_amount":
        addToPool(summary.missingAmount, 0, rollup.wageCost);
        break;
      default:
        continue;
    }
    if (rollup.status === "over") summary.overCount += 1;
  }

  finishPool(summary.settled);
  finishPool(summary.inFlight);
  finishPool(summary.notCosted);
  finishPool(summary.missingAmount);
  return summary;
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

export type JobWorkSummary = { projectId: string; hours: number; wages: number; unpricedHours: number; lastClockIn: string | null; name: string | null; assignedCount: number };

/** Per-project logged hours joined with budgets. */
export function rollupProjects(
  entries: TimeEntry[],
  projects: Project[],
  budgets: ProjectBudget[],
  assignments: Assignment[],
  payRates: EmployeePayRate[],
  now = Date.now(),
  workSummary?: JobWorkSummary[],
): ProjectRollup[] {
  const budgetById = new Map(budgets.map((b) => [b.companycam_project_id, b]));
  const assignedById = new Map<string, number>();
  for (const a of assignments) {
    assignedById.set(a.companycam_project_id, (assignedById.get(a.companycam_project_id) ?? 0) + 1);
  }

  const hoursById = new Map<string, number>();
  const wagesById = new Map<string, number>();
  const unpricedById = new Map<string, number>();
  const payRateIndex = buildPayRateIndex(payRates);
  const lastById = new Map<string, string>();
  const nameById = new Map<string, string>();
  const addrById = new Map<string, string | null>();
  const startedOnById = new Map<string, string | null>();
  const productionMonthById = new Map<string, string | null>();

  for (const p of projects) {
    nameById.set(p.companycam_id, p.name);
    addrById.set(p.companycam_id, p.formatted_address);
    startedOnById.set(p.companycam_id, p.started_on);
    productionMonthById.set(p.companycam_id, p.production_month);
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

  for (const summary of workSummary ?? []) {
    const id = summary.projectId;
    hoursById.set(id, summary.hours);
    wagesById.set(id, summary.wages);
    unpricedById.set(id, summary.unpricedHours);
    assignedById.set(id, summary.assignedCount);
    if (summary.lastClockIn) lastById.set(id, summary.lastClockIn);
    if (!nameById.has(id) && summary.name) nameById.set(id, summary.name);
  }

  // A budget can outlive the active CompanyCam project it belonged to. Keep
  // that record for audit, but do not turn it into a nameless job row.
  const ids = new Set<string>([...nameById.keys(), ...hoursById.keys()]);
  const rollups: ProjectRollup[] = [];

  for (const id of ids) {
    const budget = budgetById.get(id);
    const name = nameById.get(id)?.trim();
    if (!name) continue;
    const labourExcluded = false;
    const clockedHours = labourExcluded ? 0 : (hoursById.get(id) ?? 0);
    const logged = clockedHours;
    const budgetedHours = budget?.budgeted_hours ?? null;
    const rate = budget?.hourly_rate ?? null;
    // `amount_including_tax` is the legacy database column name. The dashboard
    // now stores and reads it as the manually entered pre-HST job amount.
    const storedAmount = budget?.amount_including_tax ?? null;
    const preTaxAmount = storedAmount == null ? null : Number(storedAmount);
    const clockedWageCost = labourExcluded ? 0 : (wagesById.get(id) ?? 0);
    const wageCost = clockedWageCost;
    const labourCostSource = "clocked_hours" as const;
    // Budgets made before labour settings existed use the original 37% / 40%.
    const crewHoursPercent = budget?.crew_hours_percent ?? LABOUR_MAX_PERCENT;
    const costTargetPercent = budget?.cost_target_percent ?? LABOUR_ALERT_PERCENT;
    const allowanceLow = preTaxAmount != null
      ? preTaxAmount * (Math.min(LABOUR_MIN_PERCENT, crewHoursPercent) / 100)
      : null;
    const allowanceHigh = preTaxAmount != null ? preTaxAmount * (crewHoursPercent / 100) : null;
    const wageSharePercent = labourExcluded
      ? null
      : preTaxAmount && preTaxAmount > 0
        ? (wageCost / preTaxAmount) * 100
        : null;
    const allowanceUsedLowPercent = allowanceLow && allowanceLow > 0 ? (wageCost / allowanceLow) * 100 : null;
    const allowanceUsedHighPercent = allowanceHigh && allowanceHigh > 0 ? (wageCost / allowanceHigh) * 100 : null;
    const percentUsed = budgetedHours ? (clockedHours / budgetedHours) * 100 : null;
    const labourClosedAt = budget?.labour_closed_at ?? null;
    const lastActivity = lastById.get(id) ?? null;
    rollups.push({
      projectId: id,
      name,
      address: addrById.get(id) ?? null,
      jobStartedOn: startedOnById.get(id) ?? null,
      productionMonth: productionMonthById.get(id) ?? null,
      labourExcluded,
      loggedHours: logged,
      budgetedHours,
      amountBeforeTax: preTaxAmount,
      hourlyRate: rate,
      remainingHours: budgetedHours != null ? budgetedHours - logged : null,
      percentUsed,
      status: budgetStatus(wageSharePercent, costTargetPercent),
      crewHoursPercent,
      costTargetPercent,
      laborCost: wageCost,
      budgetCost: allowanceHigh,
      labourAllowanceLow: allowanceLow,
      labourAllowanceHigh: allowanceHigh,
      clockedWageCost,
      labourCostSource,
      wageCost,
      wageSharePercent,
      allowanceUsedLowPercent,
      allowanceUsedHighPercent,
      remainingLabourLow: allowanceLow != null ? allowanceLow - wageCost : null,
      remainingLabourHigh: allowanceHigh != null ? allowanceHigh - wageCost : null,
      unpricedHours: labourExcluded ? 0 : (unpricedById.get(id) ?? 0),
      assignedCount: assignedById.get(id) ?? 0,
      lastActivity,
      lastClockIn: lastById.get(id) ?? null,
      clockedHours,
      labourClosedAt,
      labourBucket: classifyLabour({ labourExcluded, amountBeforeTax: preTaxAmount, wageCost, labourClosedAt }),
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

/** Per-job painter task checklist and planned hours. */
export function projectTaskProgress(
  tasks: ProjectLabourTask[],
  employees: EmployeeProfile[],
): Record<string, ProjectTaskProgress[]> {
  const nameByUserId = new Map(
    employees.map((employee) => [employee.user_id, employee.full_name ?? employee.email ?? "Painter"]),
  );

  const byProject: Record<string, ProjectTaskProgress[]> = {};
  for (const task of tasks) {
    (byProject[task.companycam_project_id] ??= []).push({
      id: task.id,
      title: task.title,
      notes: task.notes,
      status: task.status,
      completedAt: task.completed_at ?? null,
      completedByName: task.completed_by ? nameByUserId.get(task.completed_by) ?? "Painter" : null,
      budgetedHours: Math.max(0, task.budgeted_hours ?? 0),
    });
  }
  return byProject;
}

/** Compact drill-down data for the jobs table. */
export function projectDetails(
  entries: TimeEntry[],
  payRates: EmployeePayRate[],
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
        }
  >();

  for (const entry of entries) {
    const projectId = entry.companycam_project_id;
    if (!projectId) continue;

    let project = byProject.get(projectId);
    if (!project) {
      project = { entries: [], crew: new Map(), ratesByCrew: new Map(), activeEntryCount: 0 };
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
        entries: detail.entries
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
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
