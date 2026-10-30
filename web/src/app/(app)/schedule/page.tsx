import { addDays, isDay, isMonth, monthWeeks } from "@/components/calendar-month-grid";
import { JobScheduleView } from "@/components/job-schedule";
import { getJobSchedule } from "@/lib/actions/crm";
import { getReminderRules } from "@/lib/actions/reminders";
import { requireStaff } from "@/lib/auth";
import { dayKey } from "@/lib/format";
import { sendsConfirmation } from "@/lib/reminder-types";

export const dynamic = "force-dynamic";

/** ?month=YYYY-MM, or ?view=5day&start=YYYY-MM-DD; ?crew= filters by a crew or a person. */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string; start?: string; crew?: string }>;
}) {
  const query = await searchParams;
  const today = dayKey(new Date());
  const view = query.view === "5day" ? "5day" : "month";
  const start = isDay(query.start) ? query.start : today;
  const month = isMonth(query.month) ? query.month : (view === "5day" ? start : today).slice(0, 7);
  const weeks = monthWeeks(month);
  const [from, to] = view === "5day" ? [start, addDays(start, 4)] : [weeks[0], addDays(weeks[weeks.length - 1], 6)];
  await requireStaff();
  const [data, rules] = await Promise.all([getJobSchedule(from, to), getReminderRules()]);
  return (
    <JobScheduleView
      view={view}
      month={month}
      start={start}
      today={today}
      crew={query.crew ?? ""}
      data={data}
      confirmations={sendsConfirmation(rules, "job")}
    />
  );
}
