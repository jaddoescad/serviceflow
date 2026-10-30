import Link from "next/link";
import { TodayMap } from "@/components/today-map";
import { ProjectMediaPreview } from "@/components/project-media-preview";
import { fmtHours, fmtTime } from "@/lib/format";
import { PageHeader } from "@/components/kpi";
import { EmptyState } from "@/components/ui";

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
    <>
      <PageHeader
        title="Today"
        subtitle={
          projects.length
            ? `${date} · ${active} ${active === 1 ? "painter" : "painters"} active on ${projects.length} ${projects.length === 1 ? "project" : "projects"}`
            : date
        }
      />
      {projects.length === 0 ? (
        <EmptyState>No one has clocked in yet today.</EmptyState>
      ) : (
        <>
          <TodayMap projects={projects} />
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
        </>
      )}
    </>
  );
}

function ProjectCard({ project }: { project: TodayProject }) {
  const href = `/jobs/${project.id}`;
  return (
    <article
      id={`project-${project.id}`}
      className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-colors hover:border-[var(--color-border-strong)]"
    >
      <div className="flex gap-3">
        <Link href={href} prefetch={false} aria-label={`Open ${project.name}`}
          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[var(--color-surface-2)]">
          {project.preview ? (
            <ProjectMediaPreview src={`/api/jobs/${project.id}/media/${project.preview.id}`}
              video={project.preview.media_type === "video"} alt={project.name} />
          ) : null}
        </Link>
        <div className="min-w-0">
          <Link href={href} prefetch={false} className="block truncate text-[13px] font-semibold text-[var(--color-heading)] hover:underline">{project.name}</Link>
          {project.address ? <p className="truncate text-xs text-[var(--color-muted)]">{project.address}</p> : null}
        </div>
      </div>

      <Budget budget={project.budget} />

      <ul className="mt-3 border-t border-[var(--color-border)] pt-2">
        {project.painters.map((c) => (
          <li key={c.id} className="flex h-7 items-center gap-2 text-[13px]">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${c.todayAt ? "bg-[var(--tag-green-text)]" : "bg-[var(--color-border-strong)]"}`}
            />
            <span className={`truncate ${c.todayAt ? "font-medium text-[var(--color-heading)]" : "text-[var(--color-muted)]"}`}>{c.name}</span>
            {c.todayAt ? <span className="shrink-0 text-xs text-[var(--color-muted)]">in at {fmtTime(c.todayAt)}</span> : null}
            <span className="ml-auto shrink-0 tabular-nums text-[var(--color-muted)]">{fmtHours(c.hours)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Budget({ budget }: { budget: TodayProject["budget"] }) {
  if (!budget) return <p className="mt-3 text-xs text-[var(--color-faint)]">No labour budget</p>;
  const pct = Math.round((budget.usedHours / budget.budgetHours) * 100);
  const color =
    pct > 100 ? "bg-[var(--tag-red-text)]" : pct >= 85 ? "bg-[var(--tag-orange-text)]" : "bg-[var(--tag-green-text)]";
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs">
        <span className="text-[var(--color-muted)]">Labour budget · {budget.usedHours.toFixed(1)} of {budget.budgetHours.toFixed(1)} h</span>
        <span className={`tabular-nums ${pct > 100 ? "font-semibold text-[var(--tag-red-text)]" : "text-[var(--color-text)]"}`}>{pct}%</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
