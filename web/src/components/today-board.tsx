import type { ReactNode } from "react";
import Link from "next/link";
import { ProjectMediaPreview } from "@/components/project-media-preview";
import { fmtDistance, fmtHours, fmtTime, initials } from "@/lib/format";

export type TodayCrew = {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  onClock: boolean;
  hours: number;
  /** Set when the latest location is well away from the job. */
  distanceMeters: number | null;
};

export type TodayJob = {
  key: string;
  id: string | null;
  name: string;
  address: string | null;
  preview: { id: string; media_type: string } | null;
  budget: { usedHours: number; budgetHours: number } | null;
  crew: TodayCrew[];
};

export function TodayBoard({ date, jobs }: { date: string; jobs: TodayJob[] }) {
  const painters = new Set(jobs.flatMap((job) => job.crew.map((c) => c.id)));
  const onClock = new Set(jobs.flatMap((job) => job.crew.filter((c) => c.onClock).map((c) => c.id)));
  const hours = jobs.reduce((sum, job) => sum + job.crew.reduce((s, c) => s + c.hours, 0), 0);
  const budgeted = jobs.filter((job) => job.budget);
  const over = budgeted.filter((job) => job.budget!.usedHours > job.budget!.budgetHours).length;

  return (
    <section className="workspace-page">
      <h1 className="text-3xl font-bold tracking-tight">Today</h1>
      <p className="mt-1 text-base text-slate-500">{date}</p>

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Painters working" value={painters.size}
          note={onClock.size ? `${onClock.size} on the clock now` : "All clocked out"} live={onClock.size > 0} />
        <Stat label="Jobs worked" value={jobs.length} />
        <Stat label="Hours logged" value={fmtHours(hours)} />
        <Stat label="Over budget" value={budgeted.length ? `${over} of ${budgeted.length}` : "—"}
          note={budgeted.length < jobs.length ? `${jobs.length - budgeted.length} without a budget` : undefined}
          tone={over ? "bad" : undefined} />
      </dl>

      {jobs.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 py-20 text-center">
          <p className="text-base font-semibold text-slate-700">No one has clocked in yet today</p>
          <p className="mt-1 text-sm text-slate-500">Jobs appear here as soon as a painter clocks in.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {jobs.map((job) => <JobCard key={job.key} job={job} />)}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, note, live, tone }: {
  label: string; value: ReactNode; note?: string; live?: boolean; tone?: "bad";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${tone === "bad" ? "text-red-600" : "text-slate-900"}`}>
        {value}
      </dd>
      {note ? (
        <dd className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
          {live ? <LiveDot /> : null}
          {note}
        </dd>
      ) : null}
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

function JobCard({ job }: { job: TodayJob }) {
  const href = job.id ? `/jobs/${job.id}` : null;
  const live = job.crew.filter((c) => c.onClock).length;
  const lastOut = job.crew.map((c) => c.endedAt).filter(Boolean).sort().at(-1) ?? null;
  const hours = job.crew.reduce((sum, c) => sum + c.hours, 0);

  const cover = (
    <div className="relative aspect-[16/7] overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200">
      {job.preview && job.id ? (
        <ProjectMediaPreview src={`/api/jobs/${job.id}/media/${job.preview.id}`}
          video={job.preview.media_type === "video"} alt={job.name} />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-slate-300">
          {initials(job.name)}
        </span>
      )}
      <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm ${
        live ? "bg-white text-emerald-700" : "bg-white/90 text-slate-600"}`}>
        {live ? <><LiveDot />{live} on site</> : `Wrapped up ${fmtTime(lastOut)}`}
      </span>
    </div>
  );

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {href ? <Link href={href} prefetch={false} aria-label={`Open ${job.name}`}>{cover}</Link> : cover}
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          {href ? (
            <Link href={href} prefetch={false} className="truncate text-lg font-semibold hover:text-blue-600">{job.name}</Link>
          ) : (
            <span className="truncate text-lg font-semibold">{job.name}</span>
          )}
          <span className="shrink-0 whitespace-nowrap text-sm font-medium tabular-nums text-slate-600">{fmtHours(hours)} today</span>
        </div>
        {job.address ? <p className="truncate text-sm text-slate-500">{job.address}</p> : null}

        <ul className="mt-3 divide-y divide-slate-100">
          {job.crew.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <span className="relative shrink-0">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                  c.onClock ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                  {initials(c.name)}
                </span>
                {c.onClock ? (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-medium ${c.onClock ? "text-slate-900" : "text-slate-600"}`}>{c.name}</span>
                <span className="block text-xs text-slate-500">
                  {c.onClock ? `On the clock since ${fmtTime(c.startedAt)}` : `${fmtTime(c.startedAt)} – ${fmtTime(c.endedAt)}`}
                  {c.distanceMeters != null ? (
                    <span className="text-amber-700"> · {fmtDistance(c.distanceMeters)} from job</span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-slate-600">{fmtHours(c.hours)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-3">
          <BudgetBar budget={job.budget} />
        </div>
      </div>
    </article>
  );
}

function BudgetBar({ budget }: { budget: TodayJob["budget"] }) {
  if (!budget) return <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">No labour budget</p>;
  const pct = Math.round((budget.usedHours / budget.budgetHours) * 100);
  const color = pct > 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="border-t border-slate-100 pt-3">
      <div className="flex justify-between text-xs">
        <span className="text-slate-500">
          Labour budget · {budget.usedHours.toFixed(1)} of {budget.budgetHours.toFixed(1)} h
        </span>
        <span className={`font-semibold tabular-nums ${pct > 100 ? "text-red-600" : "text-slate-700"}`}>{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
