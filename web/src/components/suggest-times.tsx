"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { suggestTimes } from "@/lib/actions/booking";
import type { DayBlock, DrawnDay, SuggestedTimes } from "@/lib/booking-types";
import { Spinner, Tag, cn } from "./ui";
import { settingsHref } from "@/lib/settings-pages";

type Search = { address: string; minutes: number; userId: string | null; appointmentId: string | null };

/** Days listed before "Show more days". */
const SHOWN = 5;
/** A new location or length searches once typing pauses this long. */
const SEARCH_DELAY_MS = 600;
/** Height of a minute in an opened day. */
const PX_PER_MINUTE = 1.15;
/** Room above the first hour line for its label. */
const TOP = 8;
/** Shortest drive band, so its label fits. */
const MIN_BAND = 22;

const OPEN = "m18 15-6-6-6 6";
const CLOSED = "m6 9 6 6 6-6";
const CAR =
  "M5 17H4a1 1 0 0 1-1-1v-4l2-5h11l3 5h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1M7.5 15.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM16.5 15.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z";

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

/** "104 Stonewood Dr, Carleton Place" from "104 Stonewood Dr, Carleton Place ON K7C 3P2". */
const place = (address: string) =>
  address
    .split(",")
    .slice(0, 2)
    .map((part) => part.replace(/\s+[A-Z]{2}(\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)?\s*$/, "").trim())
    .filter(Boolean)
    .join(", ");

/** "16 min drive · 16 km". */
const driveLabel = (minutes: number, meters: number | null) =>
  `${minutes} min drive${meters === null ? "" : ` · ${Math.max(1, Math.round(meters / 1000))} km`}`;

/** Short drives green, up to half an hour amber, longer red. */
const driveTone = (minutes: number) => (minutes <= 15 ? "green" : minutes <= 30 ? "yellow" : "red");

/** A block's longer drive, in or out; null on a day with no other visits. */
const blockDrive = (block: DayBlock) => {
  const drives = [block.before, block.after].filter((drive) => drive !== null);
  return drives.length ? Math.max(...drives.map((drive) => drive.minutes)) : null;
};

/** The block to show on a closed day: the least driving, then the earliest. */
const bestBlock = (day: DrawnDay) =>
  day.blocks.reduce((best, block) => ((blockDrive(block) ?? 0) < (blockDrive(best) ?? 0) ? block : best), day.blocks[0]);

const ms = (at: string) => new Date(at).getTime();
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

type Band = { key: string; at: number; minutes: number; meters: number | null };

/**
 * An opened day drawn to scale over the person's hours: their visits in grey,
 * the drive between one place and the next as a striped band as long as the
 * drive, and the open blocks to pick.
 */
function DayDrawing({
  day,
  timezone,
  isPicked,
  onPick,
}: {
  day: DrawnDay;
  timezone: string;
  isPicked: (block: DayBlock) => boolean;
  onPick: (block: DayBlock) => void;
}) {
  const open = ms(day.open);
  const close = ms(day.close);
  const y = (at: number) => TOP + Math.round(((Math.min(Math.max(at, open), close) - open) / 60_000) * PX_PER_MINUTE);
  const hours: number[] = [];
  for (let at = open; at <= close; at += 3_600_000) hours.push(at);

  // A drive after each visit: to the next visit, or to the first open block
  // after it; and from the last open block before a visit to that visit.
  const bands: Band[] = [];
  day.visits.forEach((visit, index) => {
    const block = day.blocks.find((item) => item.before?.visit === index);
    if (block?.before) bands.push({ key: `v${index}`, at: ms(visit.end), minutes: block.before.minutes, meters: block.before.meters });
    else if (visit.next) bands.push({ key: `v${index}`, at: ms(visit.end), minutes: visit.next.minutes, meters: visit.next.meters });
  });
  day.blocks.forEach((block, index) => {
    const following = day.blocks[index + 1];
    if (block.after && following?.after?.visit !== block.after.visit) {
      bands.push({ key: `b${index}`, at: ms(block.end), minutes: block.after.minutes, meters: block.after.meters });
    }
  });

  return (
    <div className="border-t border-[var(--color-border)] px-3 pb-4 pt-3">
      <div className="relative" style={{ height: y(close) + TOP }}>
        {hours.map((at) => (
          <div key={at} className="absolute inset-x-0 border-t border-[var(--color-border)]" style={{ top: y(at) }}>
            <span className="absolute -top-2 left-0 w-12 text-[11px] tabular-nums text-[var(--color-muted)]">
              {clock(at, timezone).replace(":00", "")}
            </span>
          </div>
        ))}
        {bands
          .filter((band) => band.minutes > 0)
          .map((band) => (
            <div
              key={band.key}
              className="absolute left-14 right-0 flex items-center rounded-[var(--radius-control)] pl-2.5"
              style={{
                top: y(band.at) + 1,
                height: Math.max(MIN_BAND, y(band.at + band.minutes * 60_000) - y(band.at)),
                background: "repeating-linear-gradient(135deg, var(--color-surface-2) 0 6px, var(--color-selected) 6px 12px)",
              }}
            >
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-px text-xs font-semibold text-[var(--color-text)]">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-[var(--color-muted)]">
                  <path d={CAR} />
                </svg>
                {driveLabel(band.minutes, band.meters)}
              </span>
            </div>
          ))}
        {day.visits.map((visit, index) => (
          <div
            key={`${visit.start}-${index}`}
            className="absolute left-14 right-0 overflow-hidden rounded-[var(--radius-control)] border-l-4 border-[var(--color-faint)] bg-[var(--color-hover)] px-3 py-1.5"
            style={{ top: y(ms(visit.start)) + 1, height: Math.max(MIN_BAND, y(ms(visit.end)) - y(ms(visit.start)) - 2) }}
          >
            <span className="block truncate text-sm font-semibold text-[var(--color-heading)]">{visit.title ?? "Busy"}</span>
            <span className="block truncate text-xs text-[var(--color-muted)]">
              {timeRange(visit.start, visit.end, timezone)}
              {visit.address ? ` · ${place(visit.address)}` : ""}
            </span>
          </div>
        ))}
        {day.blocks.map((block) => {
          const picked = isPicked(block);
          return (
            <button
              key={block.start}
              type="button"
              aria-pressed={picked}
              onClick={() => onPick(block)}
              className={cn(
                "absolute left-14 right-0 flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 text-left outline-none focus-visible:shadow-[var(--focus-ring)]",
                picked
                  ? "border border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-ink)] shadow-[0_2px_8px_rgba(47,107,255,0.3)]"
                  : "border-[1.5px] border-dashed border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)] hover:bg-[var(--color-surface)]",
              )}
              style={{ top: y(ms(block.start)) + 2, height: y(ms(block.end)) - y(ms(block.start)) - 4 }}
            >
              <span className="text-sm font-semibold">{picked ? "This appointment" : "Open"}</span>
              <span className="text-xs tabular-nums">{timeRange(block.start, block.end, timezone)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The appointment dialog's suggested times: the days the person it's assigned
 * to (or anyone who takes appointments) has room over the next two weeks, best
 * first. Opening a day draws it to scale: the visits already in it, the drive
 * between each, and open blocks one appointment long. Picking a block fills in
 * the date and start, and the person when the days are split between several.
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
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const days = result?.days ?? [];
  // Names only when the days are split between people. Picking a time found
  // for anyone sets who goes, even when only one person takes appointments.
  const named = !result?.forUser && new Set(days.map((day) => day.userId)).size > 1;
  const isPicked = (day: DrawnDay, block: DayBlock) =>
    chosen !== null && (!chosen.userId || chosen.userId === day.userId) && ms(chosen.start) === ms(block.start);

  const row = (day: DrawnDay, timezone: string) => {
    const key = `${day.date}-${day.userId}`;
    const opened = expanded === key;
    const picked = day.blocks.find((block) => isPicked(day, block));
    const shownBlock = picked ?? bestBlock(day);
    const drive = blockDrive(shownBlock);
    const label = dayPart(day.date, { weekday: "short", month: "short", day: "numeric" });
    const summary = `${day.visits.length ? `${plural(day.visits.length, "visit")} booked` : "Nothing booked"} · ${plural(day.blocks.length, "open block")}`;
    return (
      <li
        key={key}
        className={cn(
          "rounded-[var(--radius)] border bg-[var(--color-surface)] transition-colors",
          picked
            ? "border-[var(--color-brand)] shadow-[0_0_0_1px_var(--color-brand)]"
            : opened
              ? "border-[var(--color-border-strong)]"
              : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
        )}
      >
        <button
          type="button"
          aria-expanded={opened}
          onClick={() => setExpanded(opened ? null : key)}
          className="flex min-h-12 w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-left outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[var(--color-heading)]">
              {named && day.name ? `${label} · ${day.name}` : label}
            </span>
            <span className="block truncate text-xs text-[var(--color-muted)]">{summary}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                picked ? "text-[var(--color-brand-strong)]" : "text-[var(--color-heading)]",
              )}
            >
              {picked ? "Picked " : ""}
              {clock(shownBlock.start, timezone)}
            </span>
            {drive === null ? (
              <Tag tone="gray">No other visits</Tag>
            ) : (
              <Tag tone={driveTone(drive)}>{drive} min drive</Tag>
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
        {opened ? (
          <DayDrawing
            day={day}
            timezone={timezone}
            isPicked={(block) => isPicked(day, block)}
            onPick={(block) => onPick({ start: block.start, userId: result?.forUser ? null : day.userId })}
          />
        ) : null}
      </li>
    );
  };

  const shown = showAll ? days : days.slice(0, SHOWN);
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
          {days.length ? (
            <ul className="space-y-2">{shown.map((day) => row(day, result.timezone))}</ul>
          ) : (
            <p className="text-[13px] text-[var(--color-muted)]">Nothing open in the next two weeks.</p>
          )}
          {days.length > shown.length ? (
            <button
              type="button"
              className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
              onClick={() => setShowAll(true)}
            >
              Show more days
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
