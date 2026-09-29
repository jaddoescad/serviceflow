import Link from "next/link";
import { TodayMap } from "@/components/today-map";
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
  /** Where they clocked in. */
  location: { lat: number; lng: number } | null;
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

export const TODAY_LAYOUTS = ["list", "crew", "map", "timeline"] as const;
export type TodayLayout = (typeof TODAY_LAYOUTS)[number];

export function TodayBoard({ date, jobs, layout }: { date: string; jobs: TodayJob[]; layout: TodayLayout }) {
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

      {/* Temporary: compare layouts, then keep one. */}
      <nav className="mt-4 flex gap-1 rounded-md bg-slate-100 p-1 text-sm sm:w-fit">
        {TODAY_LAYOUTS.map((value) => (
          <Link key={value} href={value === "list" ? "/" : `/?layout=${value}`} prefetch={false}
            className={`flex-1 rounded px-3 py-1.5 text-center capitalize ${layout === value ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>
            {value}
          </Link>
        ))}
      </nav>

      {jobs.length === 0 ? (
        <p className="mt-4 border-t border-slate-200 py-12 text-center text-sm text-slate-500">No one has clocked in yet today.</p>
      ) : layout === "crew" ? (
        <CrewGrid jobs={jobs} />
      ) : layout === "map" ? (
        <TodayMap jobs={jobs} />
      ) : layout === "timeline" ? (
        <Timeline jobs={jobs} />
      ) : (
        <div className="mt-4 border-t border-slate-200">
          {jobs.map((job) => <JobRow key={job.key} job={job} />)}
        </div>
      )}
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

type Shift = TodayCrew & { job: TodayJob };

/** One entry per painter per job, painters on the clock first. */
function shifts(jobs: TodayJob[]): Shift[] {
  return jobs.flatMap((job) => job.crew.map((c) => ({ ...c, job })))
    .sort((a, b) => Number(b.onClock) - Number(a.onClock) || a.name.localeCompare(b.name));
}

function CrewGrid({ jobs }: { jobs: TodayJob[] }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {shifts(jobs).map((s) => (
        <div key={`${s.id}-${s.job.key}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <span className="relative shrink-0">
            <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
              s.onClock ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{initials(s.name)}</span>
            {s.onClock ? <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" /> : null}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold">{s.name}</span>
              <span className="shrink-0 text-sm tabular-nums text-slate-600">{fmtHours(s.hours)}</span>
            </div>
            {s.job.id ? (
              <Link href={`/jobs/${s.job.id}`} prefetch={false} className="block truncate text-sm text-slate-600 hover:text-blue-600">{s.job.name}</Link>
            ) : <span className="block truncate text-sm text-slate-600">{s.job.name}</span>}
            <span className="block text-xs text-slate-500">
              {s.onClock ? `On the clock since ${fmtTime(s.startedAt)}` : `${fmtTime(s.startedAt)}–${fmtTime(s.endedAt)}`}
              {s.distanceMeters != null ? <span className="whitespace-nowrap text-amber-700"> · {fmtDistance(s.distanceMeters)} away</span> : null}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

const DAY_START = 6;
const DAY_END = 19;

/** Ottawa hour of day as a decimal, e.g. 8.5 for 8:30. */
function ottawaHour(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") + get("minute") / 60;
}

function Timeline({ jobs }: { jobs: TodayJob[] }) {
  const span = DAY_END - DAY_START;
  const pos = (hour: number) => `${(Math.min(Math.max(hour, DAY_START), DAY_END) - DAY_START) / span * 100}%`;
  const hours = Array.from({ length: span + 1 }, (_, i) => DAY_START + i);
  const now = ottawaHour(new Date().toISOString());
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[9rem_1fr] text-xs text-slate-400">
          <span />
          <div className="relative h-5">
            {hours.slice(0, -1).map((h) => (
              <span key={h} className="absolute -translate-x-1/2" style={{ left: pos(h) }}>
                {h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}
              </span>
            ))}
          </div>
        </div>
        {shifts(jobs).map((s) => (
          <div key={`${s.id}-${s.job.key}`} className="grid grid-cols-[9rem_1fr] items-center border-t border-slate-100 py-2">
            <span className="truncate pr-3 text-sm font-medium">{s.name}</span>
            <div className="relative h-7 rounded bg-slate-50">
              {hours.map((h) => <span key={h} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: pos(h) }} />)}
              <span className="absolute inset-y-0 w-px bg-red-400" style={{ left: pos(now) }} />
              <div
                className={`absolute inset-y-0.5 flex items-center overflow-hidden rounded px-2 text-xs font-medium text-white ${s.onClock ? "bg-blue-600" : "bg-slate-400"}`}
                style={{ left: pos(ottawaHour(s.startedAt)), right: `calc(100% - ${pos(s.onClock || !s.endedAt ? now : ottawaHour(s.endedAt))})` }}
                title={`${s.job.name} · ${fmtTime(s.startedAt)}–${s.onClock ? "now" : fmtTime(s.endedAt)}`}
              >
                <span className="truncate">{s.job.name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
