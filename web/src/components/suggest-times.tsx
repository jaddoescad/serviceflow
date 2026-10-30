"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { suggestTimes } from "@/lib/actions/booking";
import type { SuggestedTime, SuggestedTimes, TimeOfDay } from "@/lib/booking-types";
import { Button, Segmented, Spinner, Tag, cn } from "./ui";

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

/** "9:00 – 10:00 AM", or "11:30 AM – 12:30 PM" across noon. */
function timeRange(time: SuggestedTime, timeZone: string): string {
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

function fit(time: SuggestedTime, asked: boolean): { tone: "green" | "orange" | "gray"; label: string } | null {
  if (!time.matchesDay) {
    const days = Math.abs(time.daysAway);
    return { tone: "gray", label: `${days} day${days === 1 ? "" : "s"} ${time.daysAway > 0 ? "later" : "earlier"}` };
  }
  if (!time.matchesTime) return { tone: "orange", label: "Different time of day" };
  return asked ? { tone: "green", label: "Requested" } : null;
}

function route(time: SuggestedTime): string {
  if (!time.nearby) return "No other visits that day";
  const street = time.nearby.address.split(",")[0];
  if (time.nearby.meters === 0) return `Same address as the visit ${time.nearby.side}`;
  const distance = time.nearby.meters != null ? ` · ${(time.nearby.meters / 1000).toFixed(1)} km` : "";
  return `${time.nearby.minutes} min ${time.nearby.side === "before" ? "from" : "to"} ${street}${distance}`;
}

/**
 * The appointment dialog's suggested times. The customer's days and part of
 * the day go in; out come open times for the person it's assigned to (or
 * anyone who takes appointments), the requested ones first and closest to
 * their other visits first, then the nearest other times. Picking one fills
 * in the date, start and person.
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
  /** The picked time's start and person, to mark it. */
  chosen: { start: string; userId: string } | null;
  onPick: (time: SuggestedTime) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [days, setDays] = useState<string[]>([]);
  const [window, setWindow] = useState<TimeOfDay>("any");
  // With who it was for: picking a time for anyone sets the person.
  const [result, setResult] = useState<(SuggestedTimes & { forUser: string | null }) | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const shownDays = Array.from({ length: DAYS_SHOWN }, (_, index) => addDays(today, index));
  const asked = days.length > 0 || window !== "any";

  // Times found for another address, length or request no longer apply. (Not
  // the person: picking a time for anyone sets it.)
  const searchKey = JSON.stringify([search.address.trim(), search.minutes, days, window]);
  useEffect(() => {
    setResult(null);
    setError("");
  }, [searchKey]);

  function find() {
    startTransition(async () => {
      setError("");
      const found = await suggestTimes({ ...search, days, window });
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

  const row = (time: SuggestedTime, top: boolean) => {
    const picked = chosen?.start === time.start && chosen.userId === time.userId;
    const tag = fit(time, asked);
    return (
      <li key={`${time.start}-${time.userId}`}>
        <button
          type="button"
          aria-pressed={picked}
          onClick={() => onPick(time)}
          className={cn(
            "flex w-full items-start gap-3 rounded-[var(--radius)] border bg-[var(--color-surface)] px-3 py-2 text-left outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]",
            picked
              ? "border-[var(--color-brand)] shadow-[0_0_0_1px_var(--color-brand)]"
              : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
              picked ? "border-[var(--color-brand)] bg-[var(--color-brand)]" : "border-[var(--color-border-strong)]",
            )}
          >
            {picked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[13px] font-semibold text-[var(--color-heading)]">
                {dayPart(time.date, { weekday: "short", month: "short", day: "numeric" })}
                <span className="font-normal text-[var(--color-muted)]"> · </span>
                <span className="tabular-nums">{timeRange(time, result!.timezone)}</span>
              </span>
              {top ? <Tag tone="blue">Top pick</Tag> : null}
              {tag ? <Tag tone={tag.tone}>{tag.label}</Tag> : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-muted)]">
              {[result!.forUser ? "" : time.name, route(time)].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
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
        <div className="mt-3 space-y-3">
          {result.best.length ? (
            <ul className="space-y-1.5">{result.best.map((time, index) => row(time, index === 0))}</ul>
          ) : (
            <p className="text-[13px] text-[var(--color-muted)]">
              {asked ? "Nothing open then." : "Nothing open in the next two weeks."}
            </p>
          )}
          {result.other.length ? (
            <div>
              <div className="mb-1.5 text-xs font-medium text-[var(--color-muted)]">
                {result.best.length ? "Other times close to the request" : "Closest open times"}
              </div>
              <ul className="space-y-1.5">{result.other.map((time, index) => row(time, !result.best.length && index === 0))}</ul>
            </div>
          ) : null}
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
