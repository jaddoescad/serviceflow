"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { listAppointments } from "@/lib/actions/appointments";
import { suggestTimes } from "@/lib/actions/booking";
import { appointmentKindLabel, type Appointment } from "@/lib/appointment-types";
import type { NearbyVisit, OpenWindow, SuggestedTimes } from "@/lib/booking-types";
import { Spinner, Tag, cn } from "./ui";
import { settingsHref } from "@/lib/settings-pages";

type Search = { address: string; minutes: number; userId: string | null; appointmentId: string | null };

/** Times listed before "Show more times". */
const SHOWN = 5;
/** A new location or length searches once typing pauses this long. */
const SEARCH_DELAY_MS = 600;

const UP = "M12 19V5M5 12l7-7 7 7";
const DOWN = "M12 5v14M19 12l-7 7-7-7";
const DASH = "M5 12h14";
const OPEN = "m18 15-6-6-6 6";
const CLOSED = "m6 9 6 6 6-6";

/** A YYYY-MM-DD day's parts; the date is read as UTC so no zone shifts it. */
const dayPart = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(new Date(`${day}T00:00:00Z`));

const clock = (at: string | number, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at));

/** "9:00 – 10:30 AM", or "11:00 AM – 12:00 PM" across noon. */
function timeRange(start: string | number, end: string | number, timeZone: string): string {
  const [startClock, startPeriod] = clock(start, timeZone).split(/\s+/);
  const [endClock, endPeriod] = clock(end, timeZone).split(/\s+/);
  return startPeriod === endPeriod
    ? `${startClock} – ${endClock} ${endPeriod}`
    : `${startClock} ${startPeriod} – ${endClock} ${endPeriod}`;
}

/** An instant's YYYY-MM-DD in the company's zone. */
const dayOf = (at: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

/** "30 min", "1 hr", "3 hr 30 min". */
function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

const minutesBetween = (from: string | number, to: string | number) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);

/** Short drives green, up to half an hour amber, longer red. */
const driveTone = (minutes: number) => (minutes <= 15 ? "green" : minutes <= 30 ? "yellow" : "red");

/** One line about what comes before or after a time, with its drive. */
function Line({ icon, drive, children }: { icon: string; drive?: number; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3 shrink-0 text-[var(--color-muted)]"
      >
        <path d={icon} />
      </svg>
      <span className={cn("truncate", drive === undefined ? "text-[var(--color-muted)]" : "text-[var(--color-text)]")}>
        {children}
      </span>
      {drive === undefined ? null : <Tag tone={driveTone(drive)}>{drive} min drive</Tag>}
    </span>
  );
}

/** An opened day: its visits in order with this appointment slotted in, and the gaps between them. */
function DayAgenda({
  visits,
  start,
  end,
  before,
  after,
  timezone,
}: {
  visits: Appointment[];
  start: number;
  end: number;
  before: NearbyVisit | null;
  after: NearbyVisit | null;
  timezone: string;
}) {
  const items = [
    ...visits.map((visit) => ({ key: visit.id, start: Date.parse(visit.startsAt), end: Date.parse(visit.endsAt), visit })),
    { key: "this", start, end, visit: null },
  ].sort((a, b) => a.start - b.start);
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 border-t border-[var(--color-border)] px-3 pb-3.5 pt-3">
      {items.map((item, index) => {
        const next = items[index + 1];
        // The drive only matters next to this appointment.
        const drive = !next ? undefined : !item.visit ? after?.minutes : !next.visit ? before?.minutes : undefined;
        const gap = next ? minutesBetween(item.end, next.start) : 0;
        return (
          <Fragment key={item.key}>
            <span
              className={cn(
                "pt-2 text-xs tabular-nums",
                item.visit ? "text-[var(--color-muted)]" : "font-semibold text-[var(--color-brand-strong)]",
              )}
            >
              {clock(item.start, timezone)}
            </span>
            {item.visit ? (
              <div className="min-w-0 rounded-[var(--radius-control)] bg-[var(--color-hover)] px-2.5 py-1.5">
                <span className="block truncate font-semibold text-[var(--color-heading)]">
                  {item.visit.projectName ?? item.visit.title} · {appointmentKindLabel(item.visit.kind)}
                </span>
                <span className="block truncate text-xs text-[var(--color-muted)]">
                  {timeRange(item.start, item.end, timezone)} · {item.visit.assigneeName ?? "Unassigned"}
                </span>
              </div>
            ) : (
              <div className="min-w-0 rounded-[var(--radius-control)] border border-[var(--color-brand)] bg-[var(--color-surface)] px-2.5 py-1.5">
                <span className="block font-semibold text-[var(--color-heading)]">This appointment</span>
                <span className="block text-xs text-[var(--color-brand-strong)]">{timeRange(item.start, item.end, timezone)}</span>
              </div>
            )}
            {next ? (
              <>
                <span />
                <span
                  className={cn(
                    "ml-2.5 flex items-center gap-2 border-l-2 border-dotted border-[var(--color-border-strong)] py-1.5 pl-3 text-xs",
                    drive === undefined ? "text-[var(--color-muted)]" : "font-semibold text-[var(--color-text)]",
                  )}
                >
                  {gap > 0 ? `${duration(gap)} gap` : "Back to back"}
                  {drive === undefined ? null : <Tag tone={driveTone(drive)}>{drive} min drive</Tag>}
                </span>
              </>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The appointment dialog's suggested times: the free stretches of the person
 * it's assigned to (or anyone who takes appointments) over the next two weeks,
 * closest to their other visits first. Each shows its start and the gap and
 * drive to the visits before and after it. Picking one fills in the date and
 * start, and the person when the times are split between several, and opens
 * that day's schedule.
 */
export function SuggestTimes({
  search,
  startOpen,
  chosen,
  onPick,
}: {
  search: Search;
  startOpen: boolean;
  /** The picked time's start and person (null when nobody is assigned), to mark it. */
  chosen: { start: string; userId: string | null } | null;
  /** `userId` null leaves the assignee as it is. */
  onPick: (pick: { start: string; userId: string | null }) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [showAll, setShowAll] = useState(false);
  // With who it was for: picking a time for anyone sets the person.
  const [result, setResult] = useState<(SuggestedTimes & { forUser: string | null }) | null>(null);
  const [error, setError] = useState("");
  // The opened stretch, and each opened day's appointments as they load.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dayVisits, setDayVisits] = useState<Record<string, Appointment[] | "error">>({});
  const [, startTransition] = useTransition();
  // Only the latest search's times are shown.
  const latest = useRef(0);
  const address = search.address.trim();

  // Times for anyone already cover whoever gets picked, so only a person
  // chosen while their own times are shown searches again.
  const userKey = result && result.forUser === null ? null : search.userId;
  const searchKey = JSON.stringify([address, search.minutes, search.appointmentId, userKey]);
  useEffect(() => {
    latest.current += 1;
    setResult(null);
    setError("");
    setShowAll(false);
    setExpanded(null);
    if (!open || !address) return;
    const timer = setTimeout(find, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchKey]);

  function find() {
    const ticket = ++latest.current;
    startTransition(async () => {
      const found = await suggestTimes(search);
      if (ticket !== latest.current) return;
      if ("error" in found) setError(found.error);
      else setResult({ ...found, forUser: search.userId });
    });
  }

  async function loadDay(day: string, timezone: string) {
    // A day either side covers any zone; the visits are then cut to the company's day.
    const midnight = Date.parse(`${day}T00:00:00Z`);
    const found = await listAppointments({
      from: new Date(midnight - 86_400_000).toISOString(),
      to: new Date(midnight + 2 * 86_400_000).toISOString(),
    }).catch(() => null);
    setDayVisits((current) => ({
      ...current,
      [day]: found ? found.filter((visit) => dayOf(visit.startsAt, timezone) === day) : "error",
    }));
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-[13px] font-medium text-[var(--color-brand-strong)] hover:underline"
        onClick={() => setOpen(true)}
      >
        Suggest times
      </button>
    );
  }

  // Names only when the stretches are split between people; only then does
  // picking one set who goes.
  const named = !result?.forUser && new Set(result?.windows.map((stretch) => stretch.userId)).size > 1;
  const pickedBy = (stretch: OpenWindow) => (named ? stretch.userId : null);
  const isPicked = (stretch: OpenWindow) =>
    chosen !== null && (!chosen.userId || chosen.userId === stretch.userId) && stretch.starts.includes(chosen.start);

  const row = (stretch: OpenWindow, timezone: string, minutes: number) => {
    const key = `${stretch.start}-${stretch.userId}`;
    const picked = isPicked(stretch);
    const opened = expanded === key;
    const start = picked ? chosen!.start : stretch.suggested;
    const end = new Date(start).getTime() + minutes * 60_000;
    const { before, after } = stretch;
    const day = dayPart(stretch.date, { weekday: "short", month: "short", day: "numeric" });
    // The same visits the times were worked out around.
    const loaded = dayVisits[stretch.date];
    const visits =
      loaded && loaded !== "error"
        ? loaded.filter(
            (visit) =>
              visit.status === "scheduled" &&
              visit.id !== search.appointmentId &&
              (visit.assignedTo === stretch.userId || visit.assignedTo === null),
          )
        : null;
    return (
      <li
        key={key}
        className={cn(
          "rounded-[var(--radius)] border transition-colors",
          picked
            ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] shadow-[0_0_0_1px_var(--color-brand)]"
            : "border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)]",
        )}
      >
        <button
          type="button"
          aria-pressed={picked}
          aria-expanded={opened}
          onClick={() => {
            onPick({ start, userId: pickedBy(stretch) });
            setExpanded(opened ? null : key);
            if (!opened && !loaded) void loadDay(stretch.date, timezone);
          }}
          className="flex w-full items-center gap-3.5 rounded-[var(--radius)] px-3 py-2.5 text-left outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <span className="w-[92px] shrink-0">
            <span
              className={cn(
                "block truncate text-xs",
                picked ? "text-[var(--color-brand-strong)]" : "text-[var(--color-muted)]",
              )}
            >
              {named && stretch.name ? `${day} · ${stretch.name}` : day}
            </span>
            <span className="block text-base font-semibold tabular-nums text-[var(--color-heading)]">
              {clock(start, timezone)}
            </span>
          </span>
          <span className="min-w-0 flex-1 space-y-1.5">
            {before || after ? (
              <>
                {before ? (
                  <Line icon={UP} drive={before.minutes}>
                    {duration(minutesBetween(before.at, start))} after previous visit
                  </Line>
                ) : (
                  <Line icon={UP}>First visit of the day</Line>
                )}
                {after ? (
                  <Line icon={DOWN} drive={after.minutes}>
                    {duration(minutesBetween(end, after.at))} before next visit
                  </Line>
                ) : (
                  <Line icon={DOWN}>Free until {clock(stretch.end, timezone)}</Line>
                )}
              </>
            ) : (
              <Line icon={DASH}>No other visits that day</Line>
            )}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0 text-[var(--color-muted)]"
          >
            <path d={opened ? OPEN : CLOSED} />
          </svg>
        </button>
        {!opened ? null : loaded === "error" ? (
          <p role="alert" className="border-t border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-bad)]">
            {"This day's visits couldn't load."}
          </p>
        ) : visits ? (
          <DayAgenda
            visits={visits}
            start={new Date(start).getTime()}
            end={end}
            before={before}
            after={after}
            timezone={timezone}
          />
        ) : (
          <p className="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-muted)]">
            <Spinner className="h-3.5 w-3.5" />
            Loading the day…
          </p>
        )}
      </li>
    );
  };

  const windows = result?.windows ?? [];
  const shown = showAll ? windows : windows.slice(0, SHOWN);
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">When</span>
      {!address ? (
        <p className="text-[13px] text-[var(--color-muted)]">Add the location to see open times.</p>
      ) : error ? (
        <p role="alert" className="text-[13px] text-[var(--color-bad)]">
          {error}
        </p>
      ) : result?.reason === "no_hours" ? (
        <p className="text-[13px] text-[var(--color-muted)]">
          {result.forUser ? "This person doesn't take appointments yet." : "Nobody takes appointments yet."} Set hours in{" "}
          <Link href={settingsHref("availability")} className="font-medium text-[var(--color-brand-strong)] hover:underline">
            Settings › Availability
          </Link>
          .
        </p>
      ) : result ? (
        <div className="space-y-2">
          {windows.length ? (
            <ul className="space-y-2">{shown.map((stretch) => row(stretch, result.timezone, result.minutes))}</ul>
          ) : (
            <p className="text-[13px] text-[var(--color-muted)]">Nothing open in the next two weeks.</p>
          )}
          {windows.length > shown.length ? (
            <button
              type="button"
              className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
              onClick={() => setShowAll(true)}
            >
              Show more times
            </button>
          ) : null}
          {result.driveTimes ? null : (
            <p className="text-xs text-[var(--color-muted)]">
              Drive times are a {result.fallbackDriveMinutes} min estimate until Google Maps is set up.
            </p>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
          <Spinner className="h-3.5 w-3.5" />
          Finding times…
        </p>
      )}
    </div>
  );
}
