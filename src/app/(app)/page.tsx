import {
  getAssignments,
  getBudgets,
  getEmployeeLocationPoints,
  getEmployeePayRates,
  getEmployees,
  getEmployeeTrackingStatuses,
  getProjects,
  getProjectLabourExpenses,
  getTimeEntries,
} from "@/lib/queries";
import {
  attentionLists,
  hoursByDay,
  LABOUR_ALERT_PERCENT,
  rollupEmployees,
  rollupProjects,
  summarizeLabour,
  sumHours,
} from "@/lib/metrics";
import { computeDurations } from "@/lib/hours";
import { PageHeader, Kpi } from "@/components/kpi";
import { Card, CardHeader, Badge, EmptyState } from "@/components/ui";
import { HoursByDayChart, HoursBarChart } from "@/components/charts";
import { BudgetHealth } from "@/components/budget-health";
import { ShiftBoard } from "@/components/shift-board";
import { ActivityTable } from "@/components/activity-table";
import { CrewOperationsMap, type CrewLocation } from "@/components/crew-operations-map";
import { dayKey, fmtHoursDecimal, fmtMoney, fmtDistance, fmtDateTime } from "@/lib/format";
import type { EmployeeLocationPoint, EmployeeTrackingStatus, Project, TimeEntry } from "@/lib/types";
import { getProjectLabourInvoiceSummaries } from "@/lib/invoice-queries";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
const LOCATION_MATCH_TOLERANCE_MS = 5 * 60 * 1000;

export default async function OverviewPage() {
  const now = Date.now();
  const since = new Date(now - 30 * DAY).toISOString();

  const [
    entries,
    employees,
    payRates,
    projects,
    budgets,
    assignments,
    labourExpenses,
    trackingStatuses,
    invoiceSummaries,
  ] = await Promise.all([
    getTimeEntries(since),
    getEmployees(),
    getEmployeePayRates(),
    getProjects(),
    getBudgets(),
    getAssignments(),
    getProjectLabourExpenses(),
    getEmployeeTrackingStatuses(),
    getProjectLabourInvoiceSummaries(),
  ]);

  const inWindow = (from: number, to: number) => (e: { started_at: string }) => {
    const t = new Date(e.started_at).getTime();
    return t >= from && t < to;
  };
  const thisWeek = entries.filter(inWindow(now - 7 * DAY, now + DAY));
  const lastWeek = entries.filter(inWindow(now - 14 * DAY, now - 7 * DAY));

  const hoursThisWeek = sumHours(thisWeek, now);
  const hoursLastWeek = sumHours(lastWeek, now);
  const weekDelta =
    hoursLastWeek > 0 ? Math.round(((hoursThisWeek - hoursLastWeek) / hoursLastWeek) * 100) : null;

  const activeShifts = entries.filter((e) => e.status === "active");
  const todayKey = dayKey(new Date(now));
  const movementShifts = entries
    .filter(
      (entry) =>
        entry.status === "active" ||
        dayKey(entry.started_at) === todayKey ||
        Boolean(entry.ended_at && dayKey(entry.ended_at) === todayKey),
    )
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "active" ? -1 : 1;
      const leftTime = Date.parse(left.ended_at ?? left.started_at);
      const rightTime = Date.parse(right.ended_at ?? right.started_at);
      return rightTime - leftTime;
    });
  const earliestMovementStart = movementShifts.reduce(
    (earliest, entry) => Math.min(earliest, new Date(entry.started_at).getTime()),
    now,
  );
  const locationPoints = await getEmployeeLocationPoints(
    movementShifts.flatMap((entry) => (entry.user_id ? [entry.user_id] : [])),
    new Date(earliestMovementStart - LOCATION_MATCH_TOLERANCE_MS).toISOString(),
  );
  const completedInWindow = entries.filter((e) => e.status === "complete");
  const pendingApprovals = completedInWindow.filter((e) => !e.approved_at);

  // On-site compliance across the window.
  let onSiteMs = 0;
  let totalMs = 0;
  for (const e of entries) {
    const d = computeDurations(e, now);
    onSiteMs += d.onSiteMs;
    totalMs += d.totalMs;
  }
  const onSitePct = totalMs > 0 ? Math.round((onSiteMs / totalMs) * 100) : 0;

  const activeEmployees = employees.filter((e) => e.is_active);
  const projectRollups = rollupProjects(
    entries,
    projects,
    budgets,
    assignments,
    payRates,
    labourExpenses,
    now,
    invoiceSummaries,
  );
  const employeeRollups = rollupEmployees(entries, employees, now).filter((r) => r.loggedHours > 0);

  const dayData = hoursByDay(entries, 14, now);
  const topEmployees = employeeRollups.slice(0, 8).map((r) => ({
    name: r.name,
    hours: Math.round(r.loggedHours * 10) / 10,
  }));
  const topProjects = projectRollups
    .filter((r) => r.loggedHours > 0)
    .slice(0, 8)
    .map((r) => ({ name: r.name, hours: Math.round(r.loggedHours * 10) / 10 }));

  // Jobs measurable at all: an amount is entered and some labour is recorded.
  // `summarizeLabour` then splits them into settled and in-flight, because a
  // part-spent job carries its full contract value and would otherwise drag the
  // headline percentage down.
  const jobsWithLabour = projectRollups.filter(
    (r) =>
      r.amountBeforeTax != null &&
      r.labourAllowanceLow != null &&
      r.labourAllowanceHigh != null &&
      r.wageSharePercent != null &&
      r.wageCost > 0,
  );
  const labourSummary = summarizeLabour(projectRollups, now);
  const budgetItems = jobsWithLabour.map((r) => ({
    projectId: r.projectId,
    name: r.name,
    amountBeforeTax: r.amountBeforeTax!,
    wageCost: r.wageCost,
    wageSharePercent: r.wageSharePercent!,
    allowanceLow: r.labourAllowanceLow!,
    allowanceHigh: r.labourAllowanceHigh!,
    unpricedHours: r.unpricedHours,
    status: r.status,
    settled: r.labourBucket === "settled",
  }));
  const budgetPct = labourSummary.settled.sharePercent;

  const attention = attentionLists(entries, now);
  const crewLocations = buildCrewLocations(movementShifts, projects, trackingStatuses, locationPoints);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Last 30 days · Ottawa time"
        actions={<Badge tone="brand">{activeShifts.length} on the clock</Badge>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Clocked in now" value={activeShifts.length} hint="live" tone={activeShifts.length ? "good" : "neutral"} />
        <Kpi
          label="Hours this week"
          value={fmtHoursDecimal(hoursThisWeek)}
          delta={weekDelta != null ? { value: weekDelta } : null}
          hint="vs last week"
        />
        <Kpi
          label="Pending approvals"
          value={pendingApprovals.length}
          hint="awaiting payroll"
          tone={pendingApprovals.length ? "warn" : "good"}
        />
        <Kpi label="Active crew" value={activeEmployees.length} hint={`${employees.length} total`} />
        <Kpi
          label="Labour share"
          value={budgetPct != null ? `${budgetPct.toFixed(1)}%` : "—"}
          hint={
            budgetPct != null
              ? `${fmtMoney(labourSummary.settled.labourCost)} on ${labourSummary.settled.count} completed`
              : "mark labour completed on a finished job"
          }
          tone={budgetPct == null ? "neutral" : budgetPct >= LABOUR_ALERT_PERCENT ? "bad" : "good"}
        />
        <Kpi
          label="On-site rate"
          value={`${onSitePct}%`}
          hint="of tracked hours"
          tone={onSitePct >= 90 ? "good" : onSitePct >= 75 ? "warn" : "bad"}
        />
      </div>

      <div className="mt-4">
        <CrewOperationsMap locations={crewLocations} snapshotNow={now} />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="Hours per day" subtitle="On site vs off site · last 14 days" />
          <div className="p-4">
            <HoursByDayChart data={dayData} />
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <BudgetHealth items={budgetItems} summary={labourSummary} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Hours by crew member" subtitle="Top 8 · 30 days" />
          <div className="p-4">
            {topEmployees.length ? <HoursBarChart data={topEmployees} /> : <EmptyState>No hours logged yet.</EmptyState>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Hours by job" subtitle="Top 8 · 30 days" />
          <div className="p-4">
            {topProjects.length ? <HoursBarChart data={topProjects} /> : <EmptyState>No hours logged yet.</EmptyState>}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ShiftBoard entries={entries} now={now} />
        <ActivityTable entries={entries} now={now} />
        <AttentionCard
          title="Off-site clock-ins"
          tone="warn"
          empty="No off-site clock-ins."
          items={attention.offSite.slice(0, 6).map((e) => ({
            key: e.id,
            primary: e.user_name ?? "Painter",
            secondary: `${e.project_name} · ${fmtDateTime(e.started_at)}`,
            badge: fmtDistance(e.last_distance_meters),
            badgeTone: "warn" as const,
          }))}
        />
      </div>
    </>
  );
}

function buildCrewLocations(
  shifts: TimeEntry[],
  projects: Project[],
  trackingStatuses: EmployeeTrackingStatus[],
  locationPoints: EmployeeLocationPoint[],
): CrewLocation[] {
  const projectsById = new Map(projects.map((project) => [project.companycam_id, project]));
  const trackingByUserId = new Map(trackingStatuses.map((status) => [status.user_id, status]));
  const pointsByUserId = new Map<string, EmployeeLocationPoint[]>();
  for (const point of locationPoints) {
    const points = pointsByUserId.get(point.user_id) ?? [];
    points.push(point);
    pointsByUserId.set(point.user_id, points);
  }

  return shifts.map((entry) => {
    const project = entry.companycam_project_id
      ? projectsById.get(entry.companycam_project_id)
      : undefined;
    const hasClockInCoordinates = validCoordinate(entry.clock_in_latitude, entry.clock_in_longitude);
    const hasJobCoordinates = validCoordinate(project?.latitude ?? null, project?.longitude ?? null);
    const candidateTracking = entry.user_id ? trackingByUserId.get(entry.user_id) : undefined;
    const tracking =
      candidateTracking && trackingMatchesEntry(candidateTracking, entry)
        ? candidateTracking
        : undefined;
    const storedPoints = (entry.user_id ? pointsByUserId.get(entry.user_id) : undefined)
      ?.filter((point) => locationPointMatchesEntry(point, entry))
      .sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at)) ?? [];
    const trailPoints = deduplicateTrailPoints(storedPoints.map(locationPointToTrailPoint));
    if (
      tracking &&
      validCoordinate(tracking.latitude, tracking.longitude) &&
      tracking.last_location_at
    ) {
      trailPoints.push({
        id: `status-${tracking.user_id}`,
        latitude: tracking.latitude!,
        longitude: tracking.longitude!,
        capturedAt: tracking.last_location_at,
        accuracyMeters: tracking.accuracy_meters,
        distanceMeters:
          typeof tracking.metadata?.distance_from_project_meters === "number"
            ? tracking.metadata.distance_from_project_meters
            : null,
        isOnSite:
          typeof tracking.metadata?.on_site === "boolean" ? tracking.metadata.on_site : null,
        eventTypes: ["latest_status"],
        trackingMode: tracking.tracking_mode,
      });
    }
    const uniqueTrailPoints = deduplicateTrailPoints(trailPoints).sort(
      (left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt),
    );
    const latestTrailPoint = uniqueTrailPoints.at(-1);
    const hasTrackedCoordinates = latestTrailPoint != null;
    const locationSource = hasTrackedCoordinates
      ? "tracking"
      : hasClockInCoordinates
        ? "clock_in"
        : "none";
    const distanceMeters = latestTrailPoint?.distanceMeters ?? entry.last_distance_meters;
    const status =
      typeof latestTrailPoint?.isOnSite === "boolean"
        ? latestTrailPoint.isOnSite
          ? "on_site"
          : "off_site"
        : distanceMeters != null
          ? distanceMeters > 250
            ? "off_site"
            : "on_site"
          : entry.is_on_site === true
            ? "on_site"
            : entry.is_on_site === false
              ? "off_site"
              : "unknown";

    return {
      entryId: entry.id,
      name: entry.user_name ?? entry.user_email ?? "Painter",
      projectId: entry.companycam_project_id,
      projectName: entry.project_name,
      projectAddress: project?.formatted_address ?? entry.project_address,
      startedAt: entry.started_at,
      endedAt: entry.ended_at,
      shiftStatus: entry.status,
      latitude: hasTrackedCoordinates
        ? (latestTrailPoint?.latitude ?? null)
        : hasClockInCoordinates
          ? entry.clock_in_latitude
          : null,
      longitude: hasTrackedCoordinates
        ? (latestTrailPoint?.longitude ?? null)
        : hasClockInCoordinates
          ? entry.clock_in_longitude
          : null,
      jobLatitude: hasJobCoordinates ? (project?.latitude ?? null) : null,
      jobLongitude: hasJobCoordinates ? (project?.longitude ?? null) : null,
      locationSource,
      status,
      distanceMeters,
      lastLocationAt: hasTrackedCoordinates ? (latestTrailPoint?.capturedAt ?? null) : null,
      lastSyncAt: tracking?.last_sync_at ?? null,
      accuracyMeters: hasTrackedCoordinates ? (latestTrailPoint?.accuracyMeters ?? null) : null,
      trackingMode: tracking?.tracking_mode ?? latestTrailPoint?.trackingMode ?? null,
      taskStatus: tracking?.task_status ?? null,
      trailPoints: uniqueTrailPoints,
      trailDistanceMeters: trailDistance(uniqueTrailPoints),
    } satisfies CrewLocation;
  });
}

function trackingMatchesEntry(tracking: EmployeeTrackingStatus, entry: TimeEntry): boolean {
  if (entry.status === "active" && tracking.tracking_mode === "clocked_out") return false;
  const observedAt = tracking.last_location_at ?? tracking.last_sync_at;
  if (!observedAt) return false;
  const capturedAt = new Date(observedAt).getTime();
  const shiftStartedAt = new Date(entry.started_at).getTime();
  if (
    !Number.isFinite(capturedAt) ||
    !Number.isFinite(shiftStartedAt) ||
    capturedAt < shiftStartedAt - LOCATION_MATCH_TOLERANCE_MS
  ) {
    return false;
  }
  const shiftEndedAt = entry.ended_at ? Date.parse(entry.ended_at) : null;
  if (
    shiftEndedAt != null &&
    Number.isFinite(shiftEndedAt) &&
    capturedAt > shiftEndedAt + LOCATION_MATCH_TOLERANCE_MS
  ) {
    return false;
  }

  const hasTrackingIdentity = Boolean(tracking.time_entry_id || tracking.client_entry_id);
  if (hasTrackingIdentity) {
    return (
      tracking.time_entry_id === entry.id ||
      Boolean(entry.client_entry_id && tracking.client_entry_id === entry.client_entry_id)
    );
  }

  if (entry.status === "complete") return false;
  return tracking.companycam_project_id === entry.companycam_project_id;
}

function locationPointMatchesEntry(point: EmployeeLocationPoint, entry: TimeEntry): boolean {
  if (point.user_id !== entry.user_id) return false;
  const capturedAt = Date.parse(point.captured_at);
  const shiftStartedAt = Date.parse(entry.started_at);
  if (
    !Number.isFinite(capturedAt) ||
    !Number.isFinite(shiftStartedAt) ||
    capturedAt < shiftStartedAt - LOCATION_MATCH_TOLERANCE_MS
  ) {
    return false;
  }
  const shiftEndedAt = entry.ended_at ? Date.parse(entry.ended_at) : null;
  if (
    shiftEndedAt != null &&
    Number.isFinite(shiftEndedAt) &&
    capturedAt > shiftEndedAt + LOCATION_MATCH_TOLERANCE_MS
  ) {
    return false;
  }
  if (point.time_entry_id === entry.id) return true;
  if (entry.client_entry_id && point.client_entry_id === entry.client_entry_id) return true;
  if (point.time_entry_id || entry.client_entry_id) return false;
  return point.companycam_project_id === entry.companycam_project_id;
}

function locationPointToTrailPoint(point: EmployeeLocationPoint): CrewLocation["trailPoints"][number] {
  return {
    id: point.id,
    latitude: point.latitude,
    longitude: point.longitude,
    capturedAt: point.captured_at,
    accuracyMeters: point.accuracy_meters,
    distanceMeters: point.distance_from_project_meters,
    isOnSite: point.is_on_site,
    eventTypes: [point.event_type],
    trackingMode: point.tracking_mode,
  };
}

function deduplicateTrailPoints(
  points: CrewLocation["trailPoints"],
): CrewLocation["trailPoints"] {
  const unique = new Map<string, CrewLocation["trailPoints"][number]>();
  for (const point of points) {
    if (!validCoordinate(point.latitude, point.longitude)) continue;
    const key = [
      point.capturedAt,
      point.latitude.toFixed(6),
      point.longitude.toFixed(6),
    ].join(":");
    const existing = unique.get(key);
    if (existing) {
      existing.eventTypes = [...new Set([...existing.eventTypes, ...point.eventTypes])];
      existing.accuracyMeters ??= point.accuracyMeters;
      existing.distanceMeters ??= point.distanceMeters;
      existing.isOnSite ??= point.isOnSite;
    } else {
      unique.set(key, { ...point, eventTypes: [...point.eventTypes] });
    }
  }
  return [...unique.values()];
}

function trailDistance(points: CrewLocation["trailPoints"]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetween(points[index - 1]!, points[index]!);
  }
  return total;
}

function distanceBetween(
  from: Pick<CrewLocation["trailPoints"][number], "latitude" | "longitude">,
  to: Pick<CrewLocation["trailPoints"][number], "latitude" | "longitude">,
): number {
  const earthRadius = 6_371_000;
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function validCoordinate(latitude: number | null, longitude: number | null): boolean {
  return (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

function AttentionCard({
  title,
  empty,
  items,
}: {
  title: string;
  tone: "warn" | "bad";
  empty: string;
  items: {
    key: string;
    primary: string;
    secondary: string;
    badge: string;
    badgeTone: "warn" | "bad";
  }[];
}) {
  return (
    <Card>
      <CardHeader title={title} right={<Badge tone="neutral">{items.length}</Badge>} />
      {items.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.primary}</div>
                <div className="truncate text-xs text-[var(--color-muted)]">{it.secondary}</div>
              </div>
              <Badge tone={it.badgeTone}>{it.badge}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
