import Link from "next/link";
import { TodayMap } from "@/components/today-map";
import { ProjectMediaPreview } from "@/components/project-media-preview";
import { fmtHours, fmtTime } from "@/lib/format";

export type TodayPainter = {
  id: string;
  name: string;
  /** Hours on this project, all time. */
  hours: number;
  /** First clock-in today, when they clocked in today. */
  todayAt: string | null;
};

export type TodayProject = {
  id: string;
  name: string;
  address: string | null;
  preview: { id: string; media_type: string } | null;
  budget: { usedHours: number; budgetHours: number } | null;
  location: { lat: number; lng: number } | null;
  painters: TodayPainter[];
};

export function TodayBoard({ date, projects }: { date: string; projects: TodayProject[] }) {
  const active = new Set(projects.flatMap((p) => p.painters.filter((c) => c.todayAt).map((c) => c.id))).size;
  return (
    <section className="workspace-page">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-2xl font-bold tracking-tight">Today</h1>
        <span className="text-sm text-slate-500">{date}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {active} {active === 1 ? "painter" : "painters"} active on {projects.length} {projects.length === 1 ? "project" : "projects"}
      </p>

      {projects.length === 0 ? (
        <p className="mt-4 border-t border-slate-200 py-12 text-center text-sm text-slate-500">No one has clocked in yet today.</p>
      ) : (
        <>
          <TodayMap projects={projects} />
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
        </>
      )}
    </section>
  );
}

function ProjectCard({ project }: { project: TodayProject }) {
  const href = `/jobs/${project.id}`;
  return (
    <article id={`project-${project.id}`} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex gap-3">
        <Link href={href} prefetch={false} aria-label={`Open ${project.name}`}
          className="relative h-12 w-12 shrink-0 overflow-hidden rounded bg-slate-100">
          {project.preview ? (
            <ProjectMediaPreview src={`/api/jobs/${project.id}/media/${project.preview.id}`}
              video={project.preview.media_type === "video"} alt={project.name} />
          ) : null}
        </Link>
        <div className="min-w-0">
          <Link href={href} prefetch={false} className="block truncate font-semibold hover:text-blue-600">{project.name}</Link>
          {project.address ? <p className="truncate text-sm text-slate-500">{project.address}</p> : null}
        </div>
      </div>

      <Budget budget={project.budget} />

      <ul className="mt-3 border-t border-slate-100 pt-2">
        {project.painters.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-1 text-sm">
            <span className={`h-2 w-2 shrink-0 rounded-full ${c.todayAt ? "bg-emerald-500" : "bg-slate-200"}`} />
            <span className={`truncate ${c.todayAt ? "font-medium text-emerald-700" : "text-slate-500"}`}>{c.name}</span>
            {c.todayAt ? <span className="shrink-0 text-xs text-emerald-700">in at {fmtTime(c.todayAt)}</span> : null}
            <span className="ml-auto shrink-0 tabular-nums text-slate-500">{fmtHours(c.hours)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Budget({ budget }: { budget: TodayProject["budget"] }) {
  if (!budget) return <p className="mt-3 text-xs text-slate-400">No labour budget</p>;
  const pct = Math.round((budget.usedHours / budget.budgetHours) * 100);
  const color = pct > 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs">
        <span className="text-slate-500">Labour budget · {budget.usedHours.toFixed(1)} of {budget.budgetHours.toFixed(1)} h</span>
        <span className={`tabular-nums ${pct > 100 ? "font-semibold text-red-600" : "text-slate-700"}`}>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
