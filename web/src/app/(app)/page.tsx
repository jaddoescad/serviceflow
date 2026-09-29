import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTodayEntries } from "@/lib/queries";
import { ottawaStartOfDay } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { TodayBoard, type TodayPainter, type TodayProject } from "@/components/today-board";

export const dynamic = "force-dynamic";

/**
 * Home: the projects someone clocked in to today. Anyone who clocked in today
 * counts as active, even after clocking out (crews turn their phones off).
 */
export default async function HomePage() {
  const profile = await requireMember();
  if (!["admin", "manager"].includes(profile.role)) redirect("/projects");

  const today = (await getTodayEntries(ottawaStartOfDay().toISOString())).filter((e) => e.companycam_project_id);
  const ids = [...new Set(today.map((e) => e.companycam_project_id!))];
  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric",
  });
  if (!ids.length) return <TodayBoard date={date} projects={[]} />;

  const client = await createClient();
  const [feed, history, previews] = await Promise.all([
    client.from("job_feed").select("id,name,formatted_address,latitude,longitude,budget_minutes,used_minutes").in("id", ids),
    client.from("time_entries").select("job_id,employee_id,employee_name,started_at,ended_at")
      .in("job_id", ids).in("status", ["active", "completed"]),
    client.rpc("project_directory_previews", { requested_ids: ids }),
  ]);
  if (feed.error) throw new Error(`today's projects: ${feed.error.message}`);
  if (history.error) throw new Error(`project crews: ${history.error.message}`);

  const now = Date.now();
  const projects = new Map<string, TodayProject>();
  for (const row of feed.data ?? []) {
    const budgetMinutes = Number(row.budget_minutes ?? 0);
    projects.set(row.id, {
      id: row.id,
      name: row.name,
      address: row.formatted_address,
      preview: null,
      budget: budgetMinutes > 0 ? { usedHours: Number(row.used_minutes ?? 0) / 60, budgetHours: budgetMinutes / 60 } : null,
      location: row.latitude != null && row.longitude != null ? { lat: row.latitude, lng: row.longitude } : null,
      painters: [],
    });
  }

  // Everyone who has worked each project, with their total hours there.
  const crews = new Map<string, Map<string, TodayPainter>>();
  for (const row of history.data ?? []) {
    const crew = crews.get(row.job_id) ?? new Map<string, TodayPainter>();
    const painter = crew.get(row.employee_id) ?? { id: row.employee_id, name: row.employee_name ?? "Painter", hours: 0, todayAt: null };
    const end = row.ended_at ? Date.parse(row.ended_at) : now;
    painter.hours += Math.max(0, end - Date.parse(row.started_at)) / 3_600_000;
    crew.set(row.employee_id, painter);
    crews.set(row.job_id, crew);
  }
  for (const entry of today) {
    const painter = crews.get(entry.companycam_project_id!)?.get(entry.user_id ?? "");
    if (painter && (!painter.todayAt || entry.started_at < painter.todayAt)) painter.todayAt = entry.started_at;
  }

  for (const project of projects.values()) {
    project.painters = [...(crews.get(project.id)?.values() ?? [])].sort(
      (a, b) => Number(Boolean(b.todayAt)) - Number(Boolean(a.todayAt)) || b.hours - a.hours,
    );
    // No geocoded address: place the pin where today's crew clocked in closest to the site.
    if (!project.location) {
      const nearest = today
        .filter((e) => e.companycam_project_id === project.id && e.clock_in_latitude != null && e.clock_in_longitude != null)
        .sort((a, b) => (a.last_distance_meters ?? Infinity) - (b.last_distance_meters ?? Infinity))[0];
      if (nearest) project.location = { lat: nearest.clock_in_latitude!, lng: nearest.clock_in_longitude! };
    }
  }
  for (const row of previews.data ?? []) {
    const project = projects.get(row.project_id);
    if (project && !project.preview) project.preview = { id: row.id, media_type: row.media_type };
  }

  const sorted = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <AutoRefresh everyMs={60_000} />
      <TodayBoard date={date} projects={sorted} />
    </>
  );
}
