import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getProjectLabels,
  type WorkspaceProject,
} from "@/lib/project-workspace";
import { ProjectDirectory } from "@/components/project-directory";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    view?: string;
    label?: string;
    sort?: string;
    direction?: string;
  }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 200);
  const sort = params.sort === "name" ? "name" : "updated_at";
  const direction =
    params.direction === "asc" || params.direction === "desc"
      ? params.direction
      : sort === "name"
        ? "asc"
        : "desc";
  const requestedPage = Number(params.page ?? 1);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const view = ["archived", "trash"].includes(params.view ?? "")
    ? params.view!
    : "all";
  const label = /^[0-9a-f-]{36}$/i.test(params.label ?? "")
    ? params.label!
    : "";
  const client = await createClient();
  let request = client
    .from("project_directory")
    .select("*", { count: "exact" });
  if (query)
    request = request.ilike("name", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  if (view === "trash")
    request = request
      .not("trashed_at", "is", null)
      .gt("trashed_at", new Date(Date.now() - 90 * 86400000).toISOString());
  else {
    request = request.is("trashed_at", null);
    request =
      view === "archived"
        ? request.not("archived_at", "is", null)
        : request.is("archived_at", null);
  }
  // labels is JSONB; a JavaScript array is encoded as a Postgres array by the client.
  if (label)
    request = request.contains("labels", JSON.stringify([{ id: label }]));
  const [profile, labels, initialResult] = await Promise.all([
    requireMember(),
    getProjectLabels(),
    request
      .order(sort, { ascending: direction === "asc" })
      .order("id")
      .range((page - 1) * 40, page * 40 - 1),
  ]);
  // A deletion or restore can empty the last page between visits. Recover its
  // current count without adding a second query to normal page requests.
  const result =
    initialResult.status === 416 && page > 1
      ? await request.range(0, 39)
      : initialResult;
  if (result.error)
    throw new Error(`Projects could not load: ${result.error.message}`);
  const lastPage = Math.max(1, Math.ceil((result.count ?? 0) / 40));
  if (page > lastPage) {
    const destination = new URLSearchParams();
    if (query) destination.set("q", query);
    if (view !== "all") destination.set("view", view);
    if (label) destination.set("label", label);
    destination.set("sort", sort);
    destination.set("direction", direction);
    if (lastPage > 1) destination.set("page", String(lastPage));
    redirect(`/projects${destination.size ? `?${destination}` : ""}`);
  }
  const projects = (result.data ?? []) as WorkspaceProject[];
  const previews: Record<string, { id: string; media_type: string }[]> = {};
  // Three indexed rows per project, fetched together by the database.
  if (projects.length && view !== "trash") {
    const { data, error } = await client.rpc("project_directory_previews", {
      requested_ids: projects.map((project) => project.id),
    });
    if (error) throw new Error("Project previews could not load.");
    for (const row of data ?? []) (previews[row.project_id] ??= []).push(row);
  }
  return (
    <ProjectDirectory
      projects={projects}
      total={result.count ?? 0}
      page={page}
      query={query}
      view={view}
      sort={sort}
      direction={direction}
      labels={labels}
      label={label}
      previews={previews}
      canManage={["admin", "manager"].includes(profile.role)}
    />
  );
}
