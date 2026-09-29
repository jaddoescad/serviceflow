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
  crew: TodayCrew[];
};

export function TodayBoard({ date, jobs }: { date: string; jobs: TodayJob[] }) {
  const onClock = new Set(jobs.flatMap((job) => job.crew.filter((c) => c.onClock).map((c) => c.id))).size;
  const active = jobs.filter((job) => job.crew.some((c) => c.onClock)).length;
  return (
    <section className="workspace-page">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Today</h1>
        <span className="text-base text-slate-500">{date}</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {onClock
          ? `${onClock} ${onClock === 1 ? "painter" : "painters"} on ${active} ${active === 1 ? "job" : "jobs"} right now`
          : "No one is clocked in right now"}
      </p>

      <div className="mt-5 border-t border-slate-200">
        {jobs.length === 0 ? (
          <p className="py-20 text-center text-sm text-slate-500">No hours recorded today yet.</p>
        ) : (
          jobs.map((job) => <JobRow key={job.key} job={job} />)
        )}
      </div>
    </section>
  );
}

function JobRow({ job }: { job: TodayJob }) {
  const href = job.id ? `/jobs/${job.id}` : null;
  const hours = job.crew.reduce((sum, c) => sum + c.hours, 0);
  const thumbnail = (
    <>
      {job.preview && job.id ? (
        <ProjectMediaPreview
          src={`/api/jobs/${job.id}/media/${job.preview.id}`}
          video={job.preview.media_type === "video"}
          alt={job.name}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-slate-400">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M3 7h5l2-3h4l2 3h5v13H3z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </span>
      )}
    </>
  );
  return (
    <article className="flex gap-3 border-b border-slate-200 py-4 sm:gap-5">
      {href ? (
        <Link href={href} prefetch={false} aria-label={`Open ${job.name}`}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100 sm:h-20 sm:w-20">
          {thumbnail}
        </Link>
      ) : (
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100 sm:h-20 sm:w-20">{thumbnail}</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          {href ? (
            <Link href={href} prefetch={false} className="truncate text-base font-semibold hover:text-blue-600">
              {job.name}
            </Link>
          ) : (
            <span className="truncate text-base font-semibold">{job.name}</span>
          )}
          <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-slate-500">{fmtHours(hours)} today</span>
        </div>
        {job.address ? <p className="mt-0.5 truncate text-sm text-slate-500">{job.address}</p> : null}
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {job.crew.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <span
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  c.onClock ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {initials(c.name)}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2 pt-1">
                <span className={c.onClock ? "font-medium text-slate-900" : "text-slate-500"}>{c.name}</span>
                <span className="whitespace-nowrap text-slate-500">
                  {c.onClock ? `since ${fmtTime(c.startedAt)}` : `${fmtTime(c.startedAt)} – ${fmtTime(c.endedAt)}`}
                </span>
                {c.distanceMeters != null ? (
                  <span className="whitespace-nowrap text-amber-700">{fmtDistance(c.distanceMeters)} from job</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
