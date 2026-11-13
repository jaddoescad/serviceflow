import { AppointmentsCalendar } from "@/components/appointments-calendar";
import { getAppointmentsCalendarData } from "@/lib/appointments-calendar-data";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * ?month=YYYY-MM, or ?view=3day&start=YYYY-MM-DD; ?type= and ?user= filter by
 * appointment type and assignee; ?new=<project> opens a booking.
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string; start?: string; type?: string; user?: string; new?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const [, data, project] = await Promise.all([
    requireStaff(),
    getAppointmentsCalendarData(query),
    query.new
      ? supabase.from("project_directory").select("id,name,address").eq("id", query.new).maybeSingle()
      : null,
  ]);
  const target = project?.data;
  return (
    <AppointmentsCalendar
      {...data}
      newFor={target ? { id: target.id, name: target.name, address: target.address ?? "" } : null}
    />
  );
}
