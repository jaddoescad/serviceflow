import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTodayEntries } from "@/lib/queries";
import { computeDurations } from "@/lib/hours";
import { ottawaStartOfDay } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { TodayBoard, type TodayCrew, type TodayJob } from "@/components/today-board";

export const dynamic = "force-dynamic";

const OFF_SITE_METERS = 250;

/** Home: which jobs are being worked today and who is on each. */
export default async function HomePage() {
  const profile = await requireMember();
  if (!["admin", "manager"].includes(profile.role)) redirect("/projects");

  const startOfDay = ottawaStartOfDay();
  const entries = await getTodayEntries(startOfDay.toISOString());
  const now = Date.now();

  const jobs = new Map<string, TodayJob>();
  for (const entry of entries) {
    const key = entry.companycam_project_id ?? entry.project_name;
    const job = jobs.get(key) ?? {
      key, id: entry.companycam_project_id, name: entry.project_name, address: entry.project_address, preview: null, budget: null, crew: [],
    };
    const personId = entry.user_id ?? entry.user_email ?? entry.id;
    // Count only today's share of a shift left open since yesterday.
    const counted = { ...entry, started_at: new Date(Math.max(Date.parse(entry.started_at), startOfDay.getTime())).toISOString() };
    const hours = computeDurations(counted, now).totalHours;
    const onClock = entry.status === "active";
    const distance = onClock && (entry.last_distance_meters ?? 0) > OFF_SITE_METERS ? entry.last_distance_meters : null;
    const existing = job.crew.find((c) => c.id === personId);
    if (existing) {
      // Several shifts on one job today: first in, latest out, hours summed.
      existing.hours += hours;
      existing.endedAt = entry.ended_at;
      existing.onClock = onClock;
      existing.distanceMeters = distance;
    } else {
      const crew: TodayCrew = {
        id: personId, name: entry.user_name ?? "Painter", startedAt: entry.started_at, endedAt: entry.ended_at,
        onClock, hours, distanceMeters: distance,
      };
      job.crew.push(crew);
    }
    jobs.set(key, job);
  }

  const ids = [...jobs.values()].flatMap((job) => (job.id ? [job.id] : []));
  if (ids.length) {
    const client = await createClient();
    const [previews, feed] = await Promise.all([
      client.rpc("project_directory_previews", { requested_ids: ids }),
      client.from("job_feed").select("id,budget_minutes,used_minutes").in("id", ids),
    ]);
    for (const row of previews.data ?? []) {
      const job = jobs.get(row.project_id);
      if (job && !job.preview) job.preview = { id: row.id, media_type: row.media_type };
    }
    for (const row of feed.data ?? []) {
      const job = jobs.get(row.id);
      if (job && Number(row.budget_minutes) > 0) {
        job.budget = { usedHours: Number(row.used_minutes ?? 0) / 60, budgetHours: Number(row.budget_minutes) / 60 };
      }
    }
  }

  const live = (job: TodayJob) => job.crew.some((c) => c.onClock);
  const sorted = [...jobs.values()]
    .map((job) => ({ ...job, crew: job.crew.sort((a, b) => Number(b.onClock) - Number(a.onClock) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => Number(live(b)) - Number(live(a)) || a.name.localeCompare(b.name));

  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric",
  });

  return (
    <>
      <AutoRefresh everyMs={60_000} />
      <TodayBoard date={date} jobs={sorted} />
    </>
  );
}
