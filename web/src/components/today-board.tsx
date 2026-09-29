import Link from "next/link";
import { ProjectMediaPreview } from "@/components/project-media-preview";
import { fmtDistance, fmtHours, fmtTime } from "@/lib/format";

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
  const painters = new Set(jobs.flatMap((job) => job.crew.map((c) => c.id))).size;
  const onClock = new Set(jobs.flatMap((job) => job.crew.filter((c) => c.onClock).map((c) => c.id))).size;
  const hours = jobs.reduce((sum, job) => sum + job.crew.reduce((s, c) => s + c.hours, 0), 0);

  return (
    <section className="workspace-page">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-2xl font-bold tracking-tight">Today</h1>
        <span className="text-sm text-slate-500">{date}</span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
        <span>{painters} {painters === 1 ? "painter" : "painters"}</span>
        <span className="text-slate-300">·</span>
        <span>{jobs.length} {jobs.length === 1 ? "job" : "jobs"}</span>
        <span className="text-slate-300">·</span>
        <span>{fmtHours(hours)} logged</span>
        {onClock ? (
          <>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-700"><Dot />{onClock} on the clock</span>
          </>
        ) : null}
      </p>

      <div className="mt-4 border-t border-slate-200">
        {jobs.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">No one has clocked in yet today.</p>
        ) : (
          jobs.map((job) => <JobRow key={job.key} job={job} />)
        )}
      </div>
    </section>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />;
}

function JobRow({ job }: { job: TodayJob }) {
  const href = job.id ? `/jobs/${job.id}` : null;
  const hours = job.crew.reduce((sum, c) => sum + c.hours, 0);
  return (
    <article className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-3 gap-y-1 border-b border-slate-200 py-2.5 md:grid-cols-[2.5rem_minmax(0,16rem)_1fr_9rem_4.5rem]">
      <div className="relative h-10 w-10 overflow-hidden rounded bg-slate-100">
        {job.preview && job.id ? (
          <ProjectMediaPreview src={`/api/jobs/${job.id}/media/${job.preview.id}`}
            video={job.preview.media_type === "video"} alt={job.name} />
        ) : null}
      </div>

      <div className="min-w-0">
        {href ? (
          <Link href={href} prefetch={false} className="block truncate text-sm font-semibold hover:text-blue-600">{job.name}</Link>
        ) : (
          <span className="block truncate text-sm font-semibold">{job.name}</span>
        )}
        {job.address ? <p className="truncate text-xs text-slate-500">{job.address}</p> : null}
      </div>

      <span className="text-right text-sm font-medium tabular-nums text-slate-700 md:order-last">{fmtHours(hours)}</span>

      <ul className="col-span-3 col-start-2 flex flex-wrap gap-x-4 gap-y-0.5 text-sm md:col-span-1 md:col-start-auto">
        {job.crew.map((c) => (
          <li key={c.id} className="flex items-center gap-1.5 whitespace-nowrap">
            {c.onClock ? <Dot /> : null}
            <span className={c.onClock ? "font-medium text-slate-900" : "text-slate-500"}>{shortName(c.name)}</span>
            <span className="text-xs text-slate-500">
              {c.onClock ? `since ${fmtTime(c.startedAt)}` : `${fmtTime(c.startedAt)}–${fmtTime(c.endedAt)}`}
            </span>
            {c.distanceMeters != null ? (
              <span className="text-xs text-amber-700">{fmtDistance(c.distanceMeters)} away</span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="col-span-3 col-start-2 md:col-span-1 md:col-start-auto">
        <Budget budget={job.budget} />
      </div>
    </article>
  );
}

function Budget({ budget }: { budget: TodayJob["budget"] }) {
  if (!budget) return <span className="text-xs text-slate-400">No budget</span>;
  const pct = Math.round((budget.usedHours / budget.budgetHours) * 100);
  const color = pct > 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2" title={`${budget.usedHours.toFixed(1)} of ${budget.budgetHours.toFixed(1)} budgeted hours`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={`w-9 text-right text-xs tabular-nums ${pct > 100 ? "font-semibold text-red-600" : "text-slate-600"}`}>{pct}%</span>
    </div>
  );
}

/** "Michael Matambo" → "Michael M." to keep crew on one line. */
function shortName(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest.at(-1)![0]}.` : first!;
}
