"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { suggestTimes } from "@/lib/actions/booking";
import type { NearbyVisit, OpenWindow, SuggestedTimes, TimeOfDay } from "@/lib/booking-types";
import { Button, Segmented, Select, Spinner, Tag, cn } from "./ui";

type Search = { address: string; minutes: number; userId: string | null; appointmentId: string | null };

const DAYS_SHOWN = 14;
const WINDOWS: { value: TimeOfDay; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
];

function addDays(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD day's parts; the date is read as UTC so no zone shifts it. */
const dayPart = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(new Date(`${day}T00:00:00Z`));

const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** "9:00 – 10:00 AM", or "11:30 AM – 12:30 PM" across noon. */
function timeRange(time: { start: string; end: string }, timeZone: string): string {
  const parts = (iso: string) => {
    const shown = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
    const [clock, period] = shown.split(/\s+/);
    return { clock, period };
  };
  const start = parts(time.start);
  const end = parts(time.end);
  return start.period === end.period
    ? `${start.clock} – ${end.clock} ${end.period}`
    : `${start.clock} ${start.period} – ${end.clock} ${end.period}`;
}

/** Short drives green, up to half an hour amber, longer red. */
const driveTone = (minutes: number) => (minutes <= 15 ? "green" : minutes <= 30 ? "yellow" : "red");

/** The closer of the visits just before and just after a stretch. */
function nearestVisit(stretch: OpenWindow): NearbyVisit | null {
  const visits = [stretch.before, stretch.after].filter((visit): visit is NearbyVisit => visit !== null);
  return visits.sort((a, b) => a.minutes - b.minutes)[0] ?? null;
}

/**
 * The appointment dialog's suggested times. The customer's days and part of
 * the day go in; out come the free stretches of the person it's assigned to
 * (or anyone who takes appointments): the requested ones first and closest to
 * their other visits first, then the nearest other days. Picking one fills in
 * the date and a start next to their other visits, and the person when the
 * times are split between several; the start can be moved within the stretch.
 */
export function SuggestTimes({
  search,
  today,
  startOpen,
  chosen,
  onPick,
}: {
  search: Search;
  /** Today in company time, YYYY-MM-DD. */
  today: string;
  startOpen: boolean;
  /** The picked time's start and person (null when nobody is assigned), to mark it. */
  chosen: { start: string; userId: string | null } | null;
  /** `userId` null leaves the assignee as it is. */
  onPick: (pick: { start: string; userId: string | null }) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [days, setDays] = useState<string[]>([]);
  const [window, setWindow] = useState<TimeOfDay>("any");
  // With who it was for: picking a time for anyone sets the person.
  const [result, setResult] = useState<(SuggestedTimes & { forUser: string | null }) | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // Only the latest search's times are shown.
  const latest = useRef(0);
  const shownDays = Array.from({ length: DAYS_SHOWN }, (_, index) => addDays(today, index));

  // Times found for another address, length or request no longer apply. (Not
  // the person: picking a time for anyone sets it.)
  const searchKey = JSON.stringify([search.address.trim(), search.minutes, days, window]);
  useEffect(() => {
    latest.current += 1;
    setResult(null);
    setError("");
  }, [searchKey]);

  // Opening the panel, or picking days or a part of the day, looks right away;
  // a new address waits for Find times so typing doesn't search.
  const requestKey = JSON.stringify([days, window]);
  useEffect(() => {
    if (open && search.address.trim()) find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestKey]);

  function find() {
    const ticket = ++latest.current;
    startTransition(async () => {
      setError("");
      const found = await suggestTimes({ ...search, days, window });
      if (ticket !== latest.current) return;
      if ("error" in found) setError(found.error);
      else setResult({ ...found, forUser: search.userId });
    });
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

  const row = (stretch: OpenWindow) => {
    const picked = isPicked(stretch);
    const near = nearestVisit(stretch);
    const street = near?.address.split(",")[0];
    const details = [
      named ? stretch.name : "",
      near ? `Near ${street}` : "",
      near && near.meters ? `${(near.meters / 1000).toFixed(1)} km` : "",
    ].filter(Boolean);
    return (
      <li
        key={`${stretch.start}-${stretch.userId}`}
        className={cn(
          "rounded-[var(--radius)] border bg-[var(--color-surface)]",
          picked ? "border-[var(--color-brand)] shadow-[0_0_0_1px_var(--color-brand)]" : "border-[var(--color-border)]",
        )}
      >
        <button
          type="button"
          aria-pressed={picked}
          onClick={() => onPick({ start: stretch.suggested, userId: pickedBy(stretch) })}
          className="flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-left outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
              picked ? "border-[var(--color-brand)] bg-[var(--color-brand)]" : "border-[var(--color-border-strong)]",
            )}
          >
            {picked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-[var(--color-heading)]">
              <span className="font-semibold">{dayPart(stretch.date, { weekday: "short", month: "short", day: "numeric" })}</span>
              <span className="ml-2 tabular-nums">{timeRange(stretch, result!.timezone)}</span>
            </span>
            {details.length ? (
              <span className="mt-0.5 block truncate text-xs text-[var(--color-muted)]">{details.join(" · ")}</span>
            ) : null}
          </span>
          {near ? <Tag tone={driveTone(near.minutes)}>{near.minutes} min</Tag> : null}
        </button>
        {picked && stretch.starts.length > 1 ? (
          <label className="flex items-center gap-2 px-3 pb-2.5 pl-10 text-xs text-[var(--color-muted)]">
            Start at
            <Select
              aria-label="Start at"
              value={chosen!.start}
              onChange={(event) => onPick({ start: event.target.value, userId: pickedBy(stretch) })}
              className="h-7 text-xs"
            >
              {stretch.starts.map((start) => (
                <option key={start} value={start}>
                  {clock(start, result!.timezone)}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </li>
    );
  };

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <div className="mb-1.5 text-xs font-medium text-[var(--color-muted)]">Days the customer can do</div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {shownDays.map((day) => {
          const on = days.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              title={dayPart(day, { weekday: "long", month: "long", day: "numeric" })}
              onClick={() =>
                setDays((current) =>
                  current.includes(day) ? current.filter((other) => other !== day) : [...current, day].sort(),
                )
              }
              className={cn(
                "flex h-11 w-12 shrink-0 flex-col items-center justify-center rounded-[var(--radius-control)] border text-xs leading-4 outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]",
                on
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-heading)] hover:border-[var(--color-border-strong)]",
              )}
            >
              <span className={on ? "text-white/80" : "text-[var(--color-muted)]"}>
                {dayPart(day, { weekday: "short" })}
              </span>
              <span className="font-semibold">{dayPart(day, { day: "numeric" })}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Segmented label="Time of day" value={window} options={WINDOWS} onChange={setWindow} />
        <Button type="button" className="ml-auto" disabled={pending} onClick={find}>
          {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
          Find times
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-[var(--color-bad)]">
          {error}
        </p>
      ) : result?.reason === "no_hours" ? (
        <p className="mt-3 text-[13px] text-[var(--color-muted)]">
          {result.forUser ? "This person doesn't take appointments yet." : "Nobody takes appointments yet."} Set hours in{" "}
          <Link href="/settings#availability" className="font-medium text-[var(--color-brand-strong)] hover:underline">
            Settings › Availability
          </Link>
          .
        </p>
      ) : result ? (
        <div className="mt-3 space-y-2">
          {result.windows.length ? (
            // The list scrolls on its own so the date and notes stay close.
            <ul className="-mr-1.5 max-h-80 space-y-1.5 overflow-y-auto pr-1.5">
              {result.windows.map((stretch, index, list) => {
                // What the customer asked for comes first; the rest go under a label.
                const fits = (other: OpenWindow) => other.matchesDay && other.matchesTime;
                const firstOther = !fits(stretch) && (index === 0 || fits(list[index - 1]));
                return firstOther ? (
                  <Fragment key={`other-${stretch.start}`}>
                    <li className="px-1 pt-1.5 text-xs font-medium text-[var(--color-muted)]">Other times</li>
                    {row(stretch)}
                  </Fragment>
                ) : (
                  row(stretch)
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--color-muted)]">Nothing open in the next three weeks.</p>
          )}
          {result.driveTimes ? null : (
            <p className="text-xs text-[var(--color-muted)]">
              Drive times are a {result.fallbackDriveMinutes} min estimate until Google Maps is set up.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
