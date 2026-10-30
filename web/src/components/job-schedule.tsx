"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleJob } from "@/lib/actions/crm";
import type { CrewOption, JobSchedule, ScheduledJob } from "@/lib/crm-types";
import { fmtRelativeTime } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import {
  CalendarDayHeader,
  CalendarFilter,
  CalendarHeader,
  CalendarMonthGrid,
  ConfirmationOption,
  DAY_NUMBER_HEIGHT,
  addDays,
  addMonths,
  daysBetween,
  monthLabel,
  monthWeeks,
  rangeLabel,
  tintStyle,
} from "./calendar-month-grid";
import { ProjectModal } from "./project-profile-panel";
import { Button, EmptyState, Field, Input, Select, Tag, cn, type TagTone } from "./ui";

export type JobScheduleViewKind = "month" | "5day";
type Editing = {
  id: string;
  name: string;
  startOn: string | null;
  endOn: string | null;
  startTime: string | null;
  endTime: string | null;
  crewId: string | null;
  completed: boolean;
};

const CREW_TINTS: TagTone[] = ["blue", "green", "orange", "purple", "yellow", "red"];
const DEFAULT_HOURS = { start: "08:00", end: "16:00" };
const CREWS_HREF = "/settings#crews";

/**
 * A job takes its crew's colour; finished jobs are grey. Without named crews
 * each lead person gets a tint so their jobs read together.
 */
function tintFor(job: ScheduledJob, hasCrews: boolean): TagTone {
  if (job.status === "completed") return "gray";
  if (job.crewColor) return job.crewColor;
  if (hasCrews) return "gray";
  const key = job.crew[0]?.id ?? job.id;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CREW_TINTS[hash % CREW_TINTS.length];
}

/** "08:30" → "8:30 AM". */
function fmtClock(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

const hoursLabel = (job: ScheduledJob) =>
  job.startTime && job.endTime ? `${fmtClock(job.startTime)} – ${fmtClock(job.endTime)}` : "";

const crewNames = (job: ScheduledJob) => job.crew.map((member) => member.name).join(", ");

/** The crew's name, else the people on the job. */
const crewLabel = (job: ScheduledJob) => job.crewName ?? crewNames(job);

type Bar = { job: ScheduledJob; lane: number; column: number; span: number; fromBefore: boolean; runsOn: boolean };

/** Jobs as bars across `days` columns from `from`, stacked in lanes so overlaps never collide. */
function layoutBars(jobs: ScheduledJob[], from: string, days: number): { bars: Bar[]; lanes: number } {
  const to = addDays(from, days - 1);
  const laneEnds: string[] = [];
  const bars = jobs
    .filter((job) => job.startOn <= to && job.endOn >= from && job.endOn >= job.startOn)
    .sort(
      (a, b) =>
        a.startOn.localeCompare(b.startOn) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
        b.endOn.localeCompare(a.endOn) ||
        a.name.localeCompare(b.name),
    )
    .map((job) => {
      const start = job.startOn < from ? from : job.startOn;
      const end = job.endOn > to ? to : job.endOn;
      let lane = laneEnds.findIndex((last) => last < start);
      if (lane === -1) lane = laneEnds.push(end) - 1;
      else laneEnds[lane] = end;
      return {
        job,
        lane,
        column: daysBetween(from, start) + 1,
        span: daysBetween(start, end) + 1,
        fromBefore: job.startOn < from,
        runsOn: job.endOn > to,
      };
    });
  return { bars, lanes: laneEnds.length };
}

/** Tinted bar; the ends a job continues past stay square and unmarked, so it reads as one bar across weeks. */
const barClass = (bar: Bar) =>
  cn(
    "pointer-events-auto text-left text-[var(--color-heading)] hover:brightness-[0.97]",
    !bar.fromBefore && "ml-1 rounded-l-[5px]",
    !bar.runsOn && "mr-1 rounded-r-[5px]",
  );

// Month bars: fixed height so each week row can reserve room for its lanes.
const BAR_HEIGHT = 22;
const BAR_GAP = 2;

function ScheduleDialog({
  job,
  today,
  crews,
  confirmations,
  onClose,
}: {
  job: Editing;
  today: string;
  crews: CrewOption[];
  /** Whether an enabled job confirmation is set up. */
  confirmations: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [startOn, setStartOn] = useState(job.startOn ?? today);
  const [endOn, setEndOn] = useState(job.endOn ?? job.startOn ?? today);
  const [timed, setTimed] = useState(Boolean(job.startTime));
  const [startTime, setStartTime] = useState(job.startTime ?? DEFAULT_HOURS.start);
  const [endTime, setEndTime] = useState(job.endTime ?? DEFAULT_HOURS.end);
  const [crewId, setCrewId] = useState(job.crewId ?? "");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const hours = timed ? { start: startTime, end: endTime } : { start: null, end: null };
  // The customer hears about new or moved dates or times of a job still to do.
  const confirmable =
    !job.completed &&
    (startOn !== job.startOn || endOn !== job.endOn || hours.start !== job.startTime || hours.end !== job.endTime);

  function save(unschedule = false) {
    startTransition(async () => {
      setError("");
      const result = await scheduleJob({
        jobId: job.id,
        startOn: unschedule ? null : startOn,
        endOn: unschedule ? null : endOn,
        startTime: unschedule ? null : hours.start,
        endTime: unschedule ? null : hours.end,
        crewId: crewId || null,
        notify: !unschedule && confirmable && confirmations && notify,
      });
      if (!result.ok) setError(result.error ?? "Could not schedule the job.");
      else {
        router.refresh();
        onClose();
      }
    });
  }
  return (
    <ProjectModal title={`Schedule ${job.name}`} onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start">
              <Input
                required
                type="date"
                value={startOn}
                onChange={(event) => {
                  setStartOn(event.target.value);
                  if (endOn < event.target.value) setEndOn(event.target.value);
                }}
              />
            </Field>
            <Field label="End">
              <Input required type="date" min={startOn} value={endOn} onChange={(event) => setEndOn(event.target.value)} />
            </Field>
          </div>
          {timed ? (
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Starts at">
                <Input required type="time" step={900} value={startTime} onChange={(event) => setStartTime(event.target.value)} />
              </Field>
              <Field label="Ends at">
                <Input
                  required
                  type="time"
                  step={900}
                  min={startTime}
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </Field>
              <Button type="button" variant="ghost" onClick={() => setTimed(false)}>
                All day
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTimed(true)}
              className="text-[13px] font-medium text-[var(--color-brand)] hover:text-[var(--color-brand-strong)]"
            >
              Add times
            </button>
          )}
          {crews.length ? (
            <Field label="Crew">
              <Select value={crewId} onChange={(event) => setCrewId(event.target.value)} className="w-full">
                <option value="">No crew</option>
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Link href={CREWS_HREF} className="block w-fit text-xs text-[var(--color-muted)] hover:text-[var(--color-heading)]">
              Set up crews
            </Link>
          )}
          {confirmable ? <ConfirmationOption available={confirmations} checked={notify} onChange={setNotify} /> : null}
          <Link
            href={`/jobs/${encodeURIComponent(job.id)}`}
            className="inline-block text-[13px] font-medium text-[var(--color-brand)] hover:text-[var(--color-brand-strong)]"
          >
            Open job
          </Link>
          {error ? <p role="alert" className="text-[13px] text-[var(--color-bad)]">{error}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-5 py-3">
          {job.startOn ? (
            <Button type="button" variant="danger" disabled={pending} onClick={() => save(true)}>
              Unschedule
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </ProjectModal>
  );
}

function MonthView({
  month,
  today,
  jobs,
  tint,
  dayHref,
  onOpen,
}: {
  month: string;
  today: string;
  jobs: ScheduledJob[];
  tint: (job: ScheduledJob) => TagTone;
  dayHref: (day: string) => string;
  onOpen: (job: ScheduledJob) => void;
}) {
  const layouts = monthWeeks(month).map((weekStart) => layoutBars(jobs, weekStart, 7));
  return (
    <CalendarMonthGrid
      month={month}
      today={today}
      dayHref={dayHref}
      rowMinHeights={layouts.map(({ lanes }) => DAY_NUMBER_HEIGHT + lanes * (BAR_HEIGHT + BAR_GAP) + 6)}
      renderWeek={(_, week) => (
        <div
          className="grid grid-cols-7"
          style={{ gridTemplateRows: `repeat(${Math.max(1, layouts[week].lanes)}, ${BAR_HEIGHT}px)`, rowGap: BAR_GAP }}
        >
          {layouts[week].bars.map((bar) => (
            <button
              key={bar.job.id}
              type="button"
              title={[bar.job.name, hoursLabel(bar.job), crewLabel(bar.job)].filter(Boolean).join(" · ")}
              onClick={() => onOpen(bar.job)}
              className={cn(barClass(bar), "truncate px-2 text-xs font-medium")}
              style={{
                ...tintStyle(tint(bar.job), !bar.fromBefore),
                gridColumn: `${bar.column} / span ${bar.span}`,
                gridRow: bar.lane + 1,
                lineHeight: `${BAR_HEIGHT}px`,
              }}
            >
              {bar.job.name}
            </button>
          ))}
        </div>
      )}
    />
  );
}

/** Five days side by side, each job a taller bar with its hours, crew and address. */
function DaysView({
  start,
  today,
  jobs,
  tint,
  onOpen,
}: {
  start: string;
  today: string;
  jobs: ScheduledJob[];
  tint: (job: ScheduledJob) => TagTone;
  onOpen: (job: ScheduledJob) => void;
}) {
  const days = Array.from({ length: 5 }, (_, index) => addDays(start, index));
  const { bars, lanes } = layoutBars(jobs, start, days.length);
  const columns = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };
  return (
    <>
      <CalendarDayHeader days={days} today={today} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative min-h-full">
          <div className="absolute inset-0 grid" style={columns}>
            {days.map((day) => (
              <div key={day} className="border-l border-[var(--color-border)] first:border-l-0" />
            ))}
          </div>
          <div className="relative grid gap-y-1 py-1.5" style={{ ...columns, gridTemplateRows: `repeat(${Math.max(1, lanes)}, 3.5rem)` }}>
            {bars.map((bar) => (
              <button
                key={bar.job.id}
                type="button"
                onClick={() => onOpen(bar.job)}
                className={cn(barClass(bar), "flex min-w-0 flex-col justify-center px-2.5 text-xs leading-4")}
                style={{
                  ...tintStyle(tint(bar.job), !bar.fromBefore),
                  gridColumn: `${bar.column} / span ${bar.span}`,
                  gridRow: bar.lane + 1,
                }}
              >
                <span className="truncate text-[13px] font-semibold">{bar.job.name}</span>
                <span className="truncate text-[var(--color-muted)]">
                  {[hoursLabel(bar.job), crewLabel(bar.job) || "No crew"].filter(Boolean).join(" · ")}
                </span>
                {bar.job.address ? <span className="truncate text-[var(--color-muted)]">{bar.job.address}</span> : null}
              </button>
            ))}
          </div>
          {!bars.length ? (
            <p className="relative py-16 text-center text-[13px] text-[var(--color-muted)]">No jobs scheduled these days.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * Full-page job schedule: a Sunday-first month grid or five days, with jobs as
 * bars across the days they run and accepted jobs waiting for dates beside it.
 */
export function JobScheduleView({
  view,
  month,
  start,
  today,
  crew: initialCrew,
  data,
  confirmations,
}: {
  view: JobScheduleViewKind;
  /** Shown month, YYYY-MM (month view). */
  month: string;
  /** First shown day, YYYY-MM-DD (5-day view). */
  start: string;
  /** Today in Ottawa, YYYY-MM-DD. */
  today: string;
  /** Crew or person filter; empty for everyone. */
  crew: string;
  data: JobSchedule;
  /** Whether an enabled job confirmation is set up. */
  confirmations: boolean;
}) {
  const [crew, setCrew] = useState(initialCrew);
  const [editing, setEditing] = useState<Editing | null>(null);

  const href = (target: { view: "month"; month: string } | { view: "5day"; start: string }, who = crew) => {
    const params = new URLSearchParams();
    if (target.view === "5day") {
      params.set("view", "5day");
      params.set("start", target.start);
    } else params.set("month", target.month);
    if (who) params.set("crew", who);
    return `/schedule?${params}`;
  };
  const here = (who = crew) => (view === "5day" ? href({ view, start }, who) : href({ view, month }, who));
  const shift = (delta: number) =>
    view === "5day" ? href({ view, start: addDays(start, delta * 5) }) : href({ view, month: addMonths(month, delta) });

  // The filter holds a crew id or a person's id.
  const jobs = crew ? data.jobs.filter((job) => job.crewId === crew || job.crew.some((member) => member.id === crew)) : data.jobs;
  const tint = (job: ScheduledJob) => tintFor(job, data.crews.length > 0);
  const open = (job: ScheduledJob) =>
    setEditing({
      id: job.id,
      name: job.name,
      startOn: job.startOn,
      endOn: job.endOn,
      startTime: job.startTime,
      endTime: job.endTime,
      crewId: job.crewId,
      completed: job.status === "completed",
    });

  return (
    <div className="page-fill">
      <CalendarHeader
        title="Job Schedule"
        view={view}
        views={[
          { value: "month", label: "Month", href: href({ view: "month", month: view === "5day" ? start.slice(0, 7) : month }) },
          {
            value: "5day",
            label: "5 Days",
            href: href({ view: "5day", start: view === "5day" ? start : today.startsWith(month) ? today : `${month}-01` }),
          },
        ]}
        label={view === "5day" ? rangeLabel(start, addDays(start, 4)) : monthLabel(month)}
        prevHref={shift(-1)}
        nextHref={shift(1)}
        todayHref={view === "5day" ? href({ view, start: today }) : href({ view, month: today.slice(0, 7) })}
        filter={
          <CalendarFilter
            label="Crew"
            allLabel="All crews"
            value={crew}
            groups={[
              { label: "Crews", options: data.crews },
              { label: "People", options: data.crew },
            ]}
            onChange={(value) => {
              setCrew(value);
              window.history.replaceState(null, "", here(value));
            }}
          />
        }
      />
      {/* Pending Schedule sits beside the calendar from lg up and under it below
          that; phones scroll the page, so the calendar keeps its own height there. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col max-md:h-[36rem] max-md:flex-none">
          {view === "5day" ? (
            <DaysView start={start} today={today} jobs={jobs} tint={tint} onOpen={open} />
          ) : (
            <MonthView
              month={month}
              today={today}
              jobs={jobs}
              tint={tint}
              dayHref={(day) => href({ view: "5day", start: day })}
              onOpen={open}
            />
          )}
        </div>

        <aside className="flex max-h-64 shrink-0 flex-col border-t border-[var(--color-border)] lg:max-h-none lg:w-64 lg:border-l lg:border-t-0 xl:w-72">
          {/* Same height as the calendar's weekday row, so their hairlines meet. */}
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4">
            <h2 className="text-[13px] font-semibold text-[var(--color-heading)]">Pending Schedule</h2>
            <Tag className="tabular-nums">{data.pending.length}</Tag>
          </div>
          {data.pending.length ? (
            <ul className="min-h-0 flex-1 divide-y divide-[var(--color-border)] overflow-y-auto">
              {data.pending.map((job) => (
                <li key={job.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/jobs/${encodeURIComponent(job.id)}`}
                      className="min-w-0 truncate text-[13px] font-semibold text-[var(--color-heading)] hover:text-[var(--color-brand-strong)]"
                    >
                      {job.name}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--color-faint)]">{fmtRelativeTime(job.acceptedAt)}</span>
                  </div>
                  {job.proposalName ? <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{job.proposalName}</div> : null}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium tabular-nums text-[var(--color-text)]">{fmtCents(job.valueCents)}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setEditing({
                          id: job.id,
                          name: job.name,
                          startOn: null,
                          endOn: null,
                          startTime: null,
                          endTime: null,
                          crewId: job.crewId,
                          completed: false,
                        })
                      }
                    >
                      Schedule
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Every accepted job has dates.</EmptyState>
          )}
        </aside>
      </div>
      {editing ? (
        <ScheduleDialog
          job={editing}
          today={today}
          crews={data.crews}
          confirmations={confirmations}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
