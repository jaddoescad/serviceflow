import type { ReactNode } from "react";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { getEmployees, getTodayEntries } from "@/lib/queries";
import { computeDurations, isStaleActive } from "@/lib/hours";
import { fmtDistance, fmtHours, fmtTime, initials, ottawaStartOfDay } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { PageHeader } from "@/components/kpi";
import { Avatar, Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

type Person = {
  id: string;
  name: string;
  entries: TimeEntry[];
  current: TimeEntry | null;
  hours: number;
};

export default async function TodayPage() {
  await requireStaff();
  const startOfDay = ottawaStartOfDay();
  const [entries, employees] = await Promise.all([getTodayEntries(startOfDay.toISOString()), getEmployees()]);
  const now = Date.now();

  const people = new Map<string, Person>();
  for (const entry of entries) {
    const id = entry.user_id ?? entry.user_email ?? entry.id;
    const person = people.get(id) ?? { id, name: entry.user_name ?? "Painter", entries: [], current: null, hours: 0 };
    person.entries.push(entry);
    if (entry.status === "active") person.current = entry;
    // Only today's share of a shift left open since yesterday.
    const counted = { ...entry, started_at: new Date(Math.max(Date.parse(entry.started_at), startOfDay.getTime())).toISOString() };
    person.hours += computeDurations(counted, now).totalHours;
    people.set(id, person);
  }
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  const working = [...people.values()].filter((p) => p.current).sort(byName);
  const done = [...people.values()].filter((p) => !p.current).sort(byName);
  const notIn = employees
    .filter((e) => e.is_active && e.role === "painter" && !people.has(e.user_id))
    .map((e) => e.full_name || e.email || "Painter")
    .sort();

  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric",
  });

  return (
    <>
      <AutoRefresh everyMs={60_000} />
      <PageHeader title="Today" subtitle={date} />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title={`Clocked in · ${working.length}`} />
          {working.length === 0 ? (
            <EmptyState>Nobody is clocked in.</EmptyState>
          ) : (
            <PeopleTable
              rows={working.map((p) => {
                const entry = p.current!;
                const offSite = (entry.last_distance_meters ?? 0) > 250;
                return {
                  person: p,
                  jobs: p.entries,
                  time: isStaleActive(entry, now) ? (
                    <Badge tone="bad">missing clock-out</Badge>
                  ) : (
                    `Since ${fmtTime(entry.started_at)}`
                  ),
                  flag: offSite ? <Badge tone="warn">{fmtDistance(entry.last_distance_meters)} from job</Badge> : null,
                };
              })}
            />
          )}
        </Card>

        {done.length ? (
          <Card>
            <CardHeader title={`Done for the day · ${done.length}`} />
            <PeopleTable
              rows={done.map((p) => ({
                person: p,
                jobs: p.entries,
                time: `${fmtTime(p.entries[0]!.started_at)} – ${fmtTime(p.entries.at(-1)!.ended_at)}`,
                flag: null,
              }))}
            />
          </Card>
        ) : null}

        {notIn.length ? (
          <Card>
            <CardHeader title={`Not clocked in · ${notIn.length}`} />
            <p className="px-5 py-4 text-sm text-[var(--color-muted)]">{notIn.join(", ")}</p>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function PeopleTable({
  rows,
}: {
  rows: { person: Person; jobs: TimeEntry[]; time: ReactNode; flag: ReactNode }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
            <th className="px-4 py-2.5 font-medium">Painter</th>
            <th className="px-4 py-2.5 font-medium">Job</th>
            <th className="px-4 py-2.5 font-medium">Time</th>
            <th className="px-4 py-2.5 text-right font-medium">Today</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ person, jobs, time, flag }) => (
            <tr key={person.id} className="border-b border-[var(--color-border)] last:border-0">
              <td className="whitespace-nowrap px-4 py-2.5">
                <span className="flex items-center gap-2 font-medium">
                  <Avatar label={initials(person.name)} />
                  {person.name}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {uniqueJobs(jobs).map((job, index) => (
                    <span key={job.key} className="flex items-center gap-2">
                      {index > 0 ? <span className="text-[var(--color-muted)]">→</span> : null}
                      {job.id ? (
                        <Link href={`/jobs/${job.id}`} className="hover:underline">{job.name}</Link>
                      ) : (
                        job.name
                      )}
                    </span>
                  ))}
                  {flag}
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-muted)]">{time}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums">{fmtHours(person.hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Jobs in the order they were worked, without repeats. */
function uniqueJobs(entries: TimeEntry[]) {
  const seen = new Map<string, { key: string; id: string | null; name: string }>();
  for (const e of entries) {
    const key = e.companycam_project_id ?? e.project_name;
    if (!seen.has(key)) seen.set(key, { key, id: e.companycam_project_id, name: e.project_name });
  }
  return [...seen.values()];
}
