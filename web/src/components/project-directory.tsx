"use client";

import { CreateWorkspaceProject } from "./create-workspace-project";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ProjectLabel, WorkspaceProject } from "@/lib/project-workspace";
import { changeProjectLifecycle } from "@/lib/actions/project-workspace";
import { ProjectMediaPreview } from "./project-media-preview";

import { LabelChip } from "./label-chip";

export function ProjectDirectory({
  projects,
  total,
  page,
  query,
  view,
  labels,
  label,
  previews,
  canManage,
  sort,
  direction,
}: {
  projects: WorkspaceProject[];
  total: number;
  page: number;
  query: string;
  view: string;
  labels: ProjectLabel[];
  label: string;
  previews: Record<string, { id: string; media_type: string }[]>;
  canManage: boolean;
  sort: "name" | "updated_at";
  direction: "asc" | "desc";
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const previousQuery = useRef(query);
  useEffect(() => {
    const previous = previousQuery.current;
    previousQuery.current = query;
    setSearch((value) => (value === previous ? query : value));
  }, [query]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  function navigate(values: {
    q?: string;
    view?: string;
    label?: string;
    page?: number;
    sort?: "name" | "updated_at";
    direction?: "asc" | "desc";
  }) {
    const params = new URLSearchParams();
    const next = {
      q: search,
      view,
      label,
      sort,
      direction,
      page: 1,
      ...values,
    };
    if (next.q) params.set("q", next.q);
    if (next.view !== "all") params.set("view", next.view);
    if (next.label) params.set("label", next.label);
    if (next.page > 1) params.set("page", String(next.page));
    params.set("sort", next.sort);
    params.set("direction", next.direction);
    startTransition(() =>
      router.replace(`/projects?${params}`, { scroll: false }),
    );
  }
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => navigate({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, query]);
  async function restore(id: string) {
    setError("");
    startTransition(async () => {
      try {
        const result = await changeProjectLifecycle(id, "restore");
        if (result.error) setError(result.error);
        else router.refresh();
      } catch {
        setError("Could not restore project. Try again.");
      }
    });
  }
  function sortBy(column: "name" | "updated_at") {
    navigate({
      sort: column,
      direction:
        sort === column
          ? direction === "asc"
            ? "desc"
            : "asc"
          : column === "name"
            ? "asc"
            : "desc",
    });
  }
  return (
    <section className="workspace-page" aria-busy={pending}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {view === "trash" ? "Project Trash" : "Projects"}
        </h1>
        {canManage && view !== "trash" ? <CreateWorkspaceProject /> : null}
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-3 border-b border-slate-200 pb-5">
        <input
          type="search"
          aria-label="Find a project"
          placeholder="Find a project…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm sm:w-72"
        />
        <div
          className="flex gap-1 rounded-md bg-slate-100 p-1"
          aria-label="Project status"
        >
          {["all", "archived", "trash"].map((value) => (
            <button
              key={value}
              onClick={() => navigate({ view: value })}
              aria-pressed={view === value}
              className={`rounded px-3 py-1.5 text-sm ${view === value ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}
            >
              {value === "all"
                ? "All"
                : value === "archived"
                  ? "Archived"
                  : "Trash"}
            </button>
          ))}
        </div>
        <select
          aria-label="Filter by label"
          value={label}
          onChange={(event) => navigate({ label: event.target.value })}
          className="h-10 rounded-md border border-slate-300 px-3 text-sm"
        >
          <option value="">Labels</option>
          {labels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {view === "trash" ? (
        <p className="py-4 text-sm text-slate-500">
          Projects can be restored for 90 days after deletion.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div>
        <div className="flex items-center gap-5 border-b border-slate-200 py-4 text-sm text-slate-600">
          <button
            type="button"
            disabled={pending}
            onClick={() => sortBy("name")}
            className="flex-1 text-left font-medium"
            aria-label={`Sort by project name${sort === "name" ? `, currently ${direction === "asc" ? "ascending" : "descending"}` : ""}`}
          >
            Project Name{" "}
            <span aria-hidden="true">
              {sort === "name" ? (direction === "asc" ? "↑" : "↓") : "↕"}
            </span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => sortBy("updated_at")}
            className="w-32 shrink-0 text-left font-medium"
            aria-label={`Sort by last updated${sort === "updated_at" ? `, currently ${direction === "asc" ? "ascending" : "descending"}` : ""}`}
          >
            Last Updated{" "}
            <span aria-hidden="true">
              {sort === "updated_at" ? (direction === "asc" ? "↑" : "↓") : "↕"}
            </span>
          </button>
          <span className="hidden w-64 shrink-0 xl:block">
            {view === "trash" ? "Retention" : "Recent Photos"}
          </span>
        </div>
        {projects.map((project) => {
          const media = previews[project.id] ?? [];
          const href = `/jobs/${project.id}`;
          return (
            <article
              key={project.id}
              className="flex items-center gap-5 border-b border-slate-200 py-4"
            >
              <Link
                href={href}
                prefetch={false}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-slate-100"
                aria-label={`Open ${project.name}`}
              >
                {media[0] ? (
                  <ProjectMediaPreview
                    src={`/api/jobs/${project.id}/media/${media[0].id}`}
                    video={media[0].media_type === "video"}
                    alt={project.name}
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-slate-400">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M3 7h5l2-3h4l2 3h5v13H3z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </span>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={href}
                  prefetch={false}
                  className="text-base font-semibold hover:text-blue-600"
                >
                  {project.name}
                </Link>
                {project.address ? (
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {project.address}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {project.labels.map((item) => (
                    <LabelChip key={item.id} label={item} />
                  ))}
                </div>
              </div>
              <time
                className="hidden w-32 shrink-0 text-sm text-slate-500 lg:block"
                dateTime={project.updated_at}
              >
                {new Date(project.updated_at).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "America/Toronto",
                })}
              </time>
              {view === "trash" ? (
                <div className="text-right">
                  <p className="mb-2 text-xs text-slate-500">
                    {Math.max(
                      0,
                      Math.ceil(
                        (Date.parse(project.trashed_at!) +
                          90 * 86400000 -
                          Date.now()) /
                          86400000,
                      ),
                    )}{" "}
                    days remaining
                  </p>
                  {canManage ? (
                    <button
                      disabled={pending}
                      onClick={() => void restore(project.id)}
                      className="text-sm font-semibold text-blue-600"
                    >
                      Restore
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="hidden w-64 shrink-0 gap-2 xl:flex">
                  {media.slice(0, 3).map((item) => (
                    <Link
                      key={item.id}
                      href={`${href}?photo=${item.id}`}
                      prefetch={false}
                      className="relative h-20 w-20 overflow-hidden rounded-md bg-slate-100"
                      aria-label={`View media from ${project.name}`}
                    >
                      <ProjectMediaPreview
                        src={`/api/jobs/${project.id}/media/${item.id}`}
                        video={item.media_type === "video"}
                        alt={project.name}
                      />
                    </Link>
                  ))}
                </div>
              )}
            </article>
          );
        })}
        {!projects.length ? (
          <p className="py-20 text-center text-sm text-slate-500">
            No projects match.
          </p>
        ) : null}
      </div>
      <div className="mt-6 flex items-center justify-between text-sm text-slate-500">
        <span>{total.toLocaleString()} projects</span>
        <div className="flex items-center gap-4">
          <button
            disabled={pending || page <= 1}
            onClick={() => navigate({ page: page - 1 })}
            className="disabled:opacity-30"
          >
            Previous
          </button>
          <span>
            {page} / {Math.max(1, Math.ceil(total / 40))}
          </span>
          <button
            disabled={pending || page * 40 >= total}
            onClick={() => navigate({ page: page + 1 })}
            className="disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
