"use client";

import { CreateWorkspaceProject } from "./create-workspace-project";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useRef, useState, useTransition } from "react";
import type { ProjectLabel, ProjectPreviews, WorkspaceProject } from "@/lib/project-workspace";
import { photoLink } from "@/lib/photo-link";
import { changeProjectLifecycle } from "@/lib/actions/project-workspace";
import { ProjectMediaPreview } from "./project-media-preview";

import { PageHeader } from "./kpi";
import { LabelChip } from "./label-chip";
import { DataTable, FilterPills, RowLink, TablePanel, TableToolbar, Td, Th, Tr } from "./table-ui";
import { Button, EmptyState, Input, Select } from "./ui";

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
  /** Streams in after the list renders. */
  previews: Promise<ProjectPreviews>;
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
  const pages = Math.max(1, Math.ceil(total / 40));
  const ariaSort = (column: "name" | "updated_at") =>
    sort === column ? (direction === "asc" ? "ascending" : "descending") : "none";
  const sortLabel = (column: "name" | "updated_at", label: string) => (
    <button
      type="button"
      disabled={pending}
      onClick={() => sortBy(column)}
      className="inline-flex items-center gap-1 hover:text-[var(--color-heading)]"
      aria-label={`Sort by ${label.toLowerCase()}`}
    >
      {label}
      <span aria-hidden="true" className="text-[var(--color-faint)]">
        {sort === column ? (direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
  return (
    <div className="page-fill">
      <PageHeader
        title={view === "trash" ? "Project Trash" : "Projects"}
        subtitle={total.toLocaleString("en-CA")}
        actions={canManage && view !== "trash" ? <CreateWorkspaceProject /> : null}
      />
      <TableToolbar>
        <div className="w-full sm:w-64">
          <Input
            type="search"
            aria-label="Find a project"
            placeholder="Find a project…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <FilterPills
          label="Project status"
          value={view}
          onChange={(value) => navigate({ view: value })}
          options={[
            { value: "all", label: "All" },
            { value: "archived", label: "Archived" },
            { value: "trash", label: "Trash" },
          ]}
        />
        <Select
          aria-label="Filter by label"
          value={label}
          onChange={(event) => navigate({ label: event.target.value })}
        >
          <option value="">All labels</option>
          {labels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        {view === "trash" ? (
          <span className="text-xs text-[var(--color-muted)]">
            Projects can be restored for 90 days after deletion.
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-[var(--color-bad)]">
            {error}
          </span>
        ) : null}
      </TableToolbar>
      <TablePanel
        fill
        busy={pending}
        footer={
          <>
            <span>{total.toLocaleString("en-CA")} projects</span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={pending || page <= 1}
                onClick={() => navigate({ page: page - 1 })}
              >
                Previous
              </Button>
              <span className="tabular-nums">
                Page {page} of {pages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending || page >= pages}
                onClick={() => navigate({ page: page + 1 })}
              >
                Next
              </Button>
            </div>
          </>
        }
      >
        <DataTable>
          <thead>
            <tr>
              <Th sort={ariaSort("name")}>{sortLabel("name", "Project")}</Th>
              <Th sort={ariaSort("updated_at")} className="hidden lg:table-cell">
                {sortLabel("updated_at", "Last updated")}
              </Th>
              <Th className="hidden xl:table-cell">{view === "trash" ? "Retention" : "Recent photos"}</Th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const href = `/jobs/${project.id}`;
              return (
                <Tr key={project.id}>
                  <Td>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[var(--color-surface-2)]">
                        <Suspense fallback={null}>
                          <ProjectCover previews={previews} project={project} />
                        </Suspense>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <RowLink href={href}>{project.name}</RowLink>
                          {project.labels.map((item) => (
                            <LabelChip key={item.id} label={item} />
                          ))}
                        </div>
                        {project.address ? (
                          <p className="truncate text-xs font-normal text-[var(--color-muted)]">
                            {project.address}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Td>
                  <Td muted className="hidden whitespace-nowrap lg:table-cell">
                    <time dateTime={project.updated_at}>
                      {new Date(project.updated_at).toLocaleDateString("en-CA", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "America/Toronto",
                      })}
                    </time>
                  </Td>
                  <Td className="hidden xl:table-cell">
                    {view === "trash" ? (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-[var(--color-muted)]">
                          {Math.max(
                            0,
                            Math.ceil(
                              (Date.parse(project.trashed_at!) + 90 * 86400000 - Date.now()) /
                                86400000,
                            ),
                          )}{" "}
                          days remaining
                        </span>
                        {canManage ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={pending}
                            onClick={() => void restore(project.id)}
                          >
                            Restore
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <Suspense fallback={null}>
                          <ProjectPhotoStrip previews={previews} project={project} href={href} />
                        </Suspense>
                      </div>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
        {projects.length ? null : <EmptyState>No projects match.</EmptyState>}
      </TablePanel>
    </div>
  );
}

/** The row's cover photo, or a camera placeholder when the project has none. */
function ProjectCover({
  previews,
  project,
}: {
  previews: Promise<ProjectPreviews>;
  project: WorkspaceProject;
}) {
  const cover = use(previews)[project.id]?.[0];
  if (!cover) {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-[var(--color-faint)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M3 7h5l2-3h4l2 3h5v13H3z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </span>
    );
  }
  return (
    <ProjectMediaPreview
      src={`/api/jobs/${project.id}/media/${cover.id}`}
      video={cover.media_type === "video"}
      alt={project.name}
    />
  );
}

/** Up to three recent photos; each opens the project with that photo shown. */
function ProjectPhotoStrip({
  previews,
  project,
  href,
}: {
  previews: Promise<ProjectPreviews>;
  project: WorkspaceProject;
  href: string;
}) {
  const media = use(previews)[project.id] ?? [];
  return media.slice(0, 3).map((item) => (
    <Link
      key={item.id}
      href={photoLink(href, "", item.id)}
      prefetch={false}
      className="relative h-9 w-9 overflow-hidden rounded-md bg-[var(--color-surface-2)]"
      aria-label={`View media from ${project.name}`}
    >
      <ProjectMediaPreview
        src={`/api/jobs/${project.id}/media/${item.id}`}
        video={item.media_type === "video"}
        alt={project.name}
      />
    </Link>
  ));
}
