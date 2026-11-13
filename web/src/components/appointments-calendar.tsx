"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveAppointment } from "@/lib/actions/appointments";
import type { CalendarConnection } from "@/lib/actions/calendar";
import { createContact, getDealCustomer, updateCustomer, type DealCustomer } from "@/lib/actions/contacts";
import { createLead } from "@/lib/actions/pipeline";
import { searchProjects } from "@/lib/actions/project-search";
import {
  APPOINTMENT_KINDS,
  appointmentKindLabel,
  type Appointment,
  type AppointmentKind,
  type AppointmentStatus,
  type CalendarEvent,
  type TeamMember,
} from "@/lib/appointment-types";
import {
  CalendarDayHeader,
  CalendarFilter,
  CalendarHeader,
  CalendarMonthGrid,
  DAY_NUMBER_HEIGHT,
  GUTTER,
  addDays,
  addMonths,
  monthLabel,
  monthWeeks,
  rangeLabel,
  tintStyle,
} from "./calendar-month-grid";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { AddressInput } from "./address-input";
import { GoogleCalendarStatusLink } from "./settings/google-calendar-section";
import { SuggestTimes } from "./suggest-times";
import { Button, Field, Input, Select, StatusText, Textarea, cn, type TagTone } from "./ui";
import { dealHref } from "@/lib/pipeline-types";
import { REMINDERS_HREF, type BookingMessages, type ReminderRule } from "@/lib/reminder-types";
import { delayLabel } from "./drips-editor";

export type AppointmentsView = "month" | "3day";

/** An appointment, or an event from a connected Google Calendar shown in its place (read-only). */
type Item = Appointment & { event?: CalendarEvent };

type Draft = {
  isNew: boolean;
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  kind: AppointmentKind;
  date: string;
  start: string;
  minutes: number;
  assignedTo: string;
  /** Kept so an appointment of someone no longer taking appointments still shows who has it. */
  assigneeName: string;
  location: string;
  notes: string;
  status: AppointmentStatus;
  /** Ticked confirmations and reminders; null means its defaults (new) or every one (booked before the choice). */
  messageRuleIds: string[] | null;
};

/** A new appointment's title follows its type until someone writes their own. */
const KIND_TITLES: Record<AppointmentKind, string> = {
  estimate: "On-Site Estimate",
  walkthrough: "Project Walkthrough",
  punch_out: "Punch-out",
  quality_control: "Quality control",
  other: "",
};
const TITLE_SUGGESTIONS = [...Object.values(KIND_TITLES).filter(Boolean), "Phone Consult"];
const LENGTHS = [30, 45, 60, 90, 120, 180, 240, 480];

// Appointments are booked and shown on Ottawa time, whatever the browser's or
// server's time zone, so the server render and the browser always agree.
const wallFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Toronto",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const pad = (value: number) => String(value).padStart(2, "0");

/** Ottawa wall clock of an instant: its day and minutes after midnight. */
function wall(value: string | number) {
  const parts: Record<string, number> = {};
  for (const part of wallFormat.formatToParts(new Date(value))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { day: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, minutes: (parts.hour % 24) * 60 + parts.minute };
}

/** The instant an Ottawa wall-clock day and minute fall on. */
function instant(day: string, minutes: number): Date {
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year, month - 1, date, 0, minutes);
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = wall(guess);
    const [y, m, d] = shown.day.split("-").map(Number);
    guess += target - Date.UTC(y, m - 1, d, 0, shown.minutes);
  }
  return new Date(guess);
}

const inputTime = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
const lengthLabel = (minutes: number) =>
  [Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} hr` : "", minutes % 60 ? `${minutes % 60} min` : ""]
    .filter(Boolean)
    .join(" ");

/** "9 – 10 AM", "9:30 – 10:30 AM", or "11:30 AM – 12:30 PM" across noon. */
function timeRange(item: Item): string {
  if (item.event?.allDay) return "All day";
  const clock = (minutes: number) => ({
    time: `${Math.floor(minutes / 60) % 12 || 12}${minutes % 60 ? `:${pad(minutes % 60)}` : ""}`,
    period: minutes < 720 ? "AM" : "PM",
  });
  const start = clock(wall(item.startsAt).minutes);
  const end = clock(wall(item.endsAt).minutes);
  return start.period === end.period
    ? `${start.time} – ${end.time} ${end.period}`
    : `${start.time} ${start.period} – ${end.time} ${end.period}`;
}

/** "9 AM", "9:30 AM" or "All day": the month view's chips leave the rest of the room to the name. */
function startTime(item: Item): string {
  if (item.event?.allDay) return "All day";
  const minutes = wall(item.startsAt).minutes;
  return `${Math.floor(minutes / 60) % 12 || 12}${minutes % 60 ? `:${pad(minutes % 60)}` : ""} ${minutes < 720 ? "AM" : "PM"}`;
}

/** "Shared calendar (info@…)" or "Scott's Google Calendar (…)". */
const calendarName = ({ shared, personName, calendar }: CalendarEvent) =>
  `${shared ? "Shared calendar" : `${personName}'s Google Calendar`}${calendar ? ` (${calendar})` : ""}`;

const label = (item: Item) => (item.event ? item.title : `${item.projectName ?? "Project"} — ${item.title}`);

/** The deal's customer details, shown and corrected on the appointment form. */
type CustomerFields = Pick<DealCustomer, "name" | "phone" | "email">;
type CustomerLoad = { projectId: string; saved: DealCustomer | null; error?: string };
/** The form splits the customer's one stored name into first and last. */
type CustomerForm = { first: string; last: string; phone: string; email: string };
const CUSTOMER_INPUTS = [
  { key: "first", label: "First name", type: "text", maxLength: 80, required: true },
  { key: "last", label: "Last name", type: "text", maxLength: 80, required: false },
  { key: "phone", label: "Phone", type: "tel", maxLength: 60, required: false },
  { key: "email", label: "Email", type: "email", maxLength: 320, required: false },
] as const;
const EMPTY_CUSTOMER: CustomerForm = { first: "", last: "", phone: "", email: "" };
function splitName(name: string): Pick<CustomerForm, "first" | "last"> {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  return { first, last: rest.join(" ") };
}
const toForm = ({ name, phone, email }: CustomerFields): CustomerForm => ({ ...splitName(name), phone, email });
const fromForm = ({ first, last, phone, email }: CustomerForm): CustomerFields => ({
  name: [first.trim(), last.trim()].filter(Boolean).join(" "),
  phone: phone.trim(),
  email: email.trim(),
});

function describe(item: Item): string {
  if (item.event) {
    const { location } = item.event;
    return `${timeRange(item)} · ${item.title}${location ? ` · ${location}` : ""} · ${calendarName(item.event)}`;
  }
  const status = item.status === "cancelled" ? " · Cancelled" : item.status === "completed" ? " · Done" : "";
  return `${timeRange(item)} · ${label(item)} · ${appointmentKindLabel(item.kind)}${item.assigneeName ? ` · ${item.assigneeName}` : ""}${status}`;
}

/** Each appointment type has its own tint. */
const KIND_TINTS: Record<AppointmentKind, TagTone> = {
  estimate: "blue",
  walkthrough: "orange",
  punch_out: "purple",
  quality_control: "green",
  other: "gray",
};

function AppointmentButton({
  item,
  onOpen,
  className,
  style,
  children,
}: {
  item: Item;
  onOpen: (item: Item) => void;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // Google Calendar events open their details, read-only.
  if (item.event) {
    return (
      <button
        type="button"
        title={describe(item)}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(item);
        }}
        className={cn(
          "rounded-[5px] border border-dashed border-[var(--color-border-strong)] text-left text-xs hover:brightness-[0.97]",
          className,
        )}
        style={{ ...tintStyle(KIND_TINTS.other), ...style }}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      title={describe(item)}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      className={cn(
        "rounded-[5px] text-left text-xs hover:brightness-[0.97]",
        item.status === "cancelled" ? "line-through opacity-50" : item.status === "completed" && "opacity-60",
        className,
      )}
      style={{ ...tintStyle(KIND_TINTS[item.kind]), ...style }}
    >
      {children}
    </button>
  );
}

// Month chips have a fixed height, so each week row can be made tall enough for its busiest day.
const CHIP_HEIGHT = 22;
const CHIP_GAP = 2;

function MonthView({
  month,
  today,
  items,
  dayHref,
  onNew,
  onOpen,
}: {
  month: string;
  today: string;
  items: Item[];
  dayHref: (day: string) => string;
  onNew: (day: string) => void;
  onOpen: (item: Item) => void;
}) {
  const byDay = new Map<string, Item[]>();
  for (const item of items) {
    const day = wall(item.startsAt).day;
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  // Every appointment shows: a week with a busy day grows and the month scrolls.
  const rowMinHeights = monthWeeks(month).map((weekStart) => {
    const most = Math.max(0, ...Array.from({ length: 7 }, (_, index) => byDay.get(addDays(weekStart, index))?.length ?? 0));
    return DAY_NUMBER_HEIGHT + 6 + most * (CHIP_HEIGHT + CHIP_GAP);
  });

  return (
    <CalendarMonthGrid
      month={month}
      today={today}
      rowMinHeights={rowMinHeights}
      dayHref={dayHref}
      onDayClick={onNew}
      renderDay={(day) => {
        const list = byDay.get(day);
        if (!list) return null;
        return (
          <div className="flex min-h-0 flex-col gap-0.5 px-1 pb-1">
            {list.map((item) => (
              <AppointmentButton
                key={item.id}
                item={item}
                onOpen={onOpen}
                className="flex w-full shrink-0 items-center gap-1.5 pl-2 pr-1.5"
                style={{ height: CHIP_HEIGHT }}
              >
                <span className="shrink-0 tabular-nums text-[var(--color-muted)]">{startTime(item)}</span>
                <span className="truncate font-medium text-[var(--color-heading)]">{label(item)}</span>
              </AppointmentButton>
            ))}
          </div>
        );
      }}
    />
  );
}

type Block = { item: Item; from: number; to: number; lane: number; lanes: number };

/** A day's appointments as minute ranges, overlapping ones side by side. */
function layoutDay(day: string, items: Item[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    // All-day Google events would fill the column; the month view shows them.
    if (item.event?.allDay) continue;
    const start = wall(item.startsAt);
    const end = wall(item.endsAt);
    if (start.day > day || end.day < day) continue;
    const from = start.day === day ? start.minutes : 0;
    const to = end.day === day ? end.minutes : 24 * 60;
    if (to > from) blocks.push({ item, from, to, lane: 0, lanes: 1 });
  }
  blocks.sort((a, b) => a.from - b.from || b.to - a.to);
  let group: Block[] = [];
  let laneEnds: number[] = [];
  let groupEnd = 0;
  const close = () => {
    for (const block of group) block.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const block of blocks) {
    if (block.from >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= block.from);
    if (lane === -1) lane = laneEnds.push(block.to) - 1;
    else laneEnds[lane] = block.to;
    block.lane = lane;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.to);
  }
  close();
  return blocks;
}

const HOUR_HEIGHT = 48;

function DaysView({
  start,
  today,
  items,
  onNew,
  onOpen,
}: {
  start: string;
  today: string;
  items: Item[];
  onNew: (day: string, minutes: number) => void;
  onOpen: (item: Item) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = [start, addDays(start, 1), addDays(start, 2)];
  const columns = days.map((day) => layoutDay(day, items));
  const firstMinute = Math.min(8 * 60, ...columns.flat().map((block) => block.from));
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, ((firstMinute - 30) / 60) * HOUR_HEIGHT);
  }, [start, firstMinute]);

  return (
    <>
      <CalendarDayHeader days={days} today={today} gutter />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: `${GUTTER} repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_HEIGHT }}
        >
          <div className="relative">
            {Array.from({ length: 23 }, (_, index) => (
              <span
                key={index}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-[var(--color-faint)]"
                style={{ top: (index + 1) * HOUR_HEIGHT }}
              >
                {hourLabel(index + 1)}
              </span>
            ))}
          </div>
          {days.map((day, index) => (
            <div
              key={day}
              className="relative border-l border-[var(--color-border)]"
              onClick={(event) => {
                const offset = event.clientY - event.currentTarget.getBoundingClientRect().top;
                onNew(day, Math.min(23 * 60 + 30, Math.max(0, Math.floor(offset / (HOUR_HEIGHT / 2)) * 30)));
              }}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className="border-b border-[var(--color-border)]" style={{ height: HOUR_HEIGHT }} />
              ))}
              {columns[index].map((block) => (
                <AppointmentButton
                  key={block.item.id}
                  item={block.item}
                  onOpen={onOpen}
                  className="absolute overflow-hidden py-1 pl-2 pr-1.5 leading-4"
                  style={{
                    top: (block.from / 60) * HOUR_HEIGHT + 1,
                    height: Math.max(20, ((block.to - block.from) / 60) * HOUR_HEIGHT - 2),
                    left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / block.lanes}% - 4px)`,
                  }}
                >
                  <span className="block truncate font-medium text-[var(--color-heading)]">{label(block.item)}</span>
                  <span className="block truncate tabular-nums text-[var(--color-muted)]">{timeRange(block.item)}</span>
                  {block.item.assigneeName ? (
                    <span className="block truncate text-[var(--color-muted)]">{block.item.assigneeName}</span>
                  ) : null}
                </AppointmentButton>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Toronto",
  weekday: "long",
  month: "long",
  day: "numeric",
});

/**
 * A Google Calendar entry's details. It was booked outside ServiceFlow (for
 * example in DripJobs), so it is read-only here; deals named like it are
 * offered so the estimate can be opened.
 */
function CalendarEventDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [deals, setDeals] = useState<{ id: string; name: string; address: string | null }[] | null>(null);
  // "Jane Smith - On-Site Estimate" names Jane Smith.
  const name = item.title.split(/\s+[-–—|:]\s+/)[0].trim();
  useEffect(() => {
    let cancelled = false;
    if (name.length < 3) {
      setDeals([]);
      return;
    }
    searchProjects(name).then(
      (rows) => !cancelled && setDeals(rows.slice(0, 3)),
      () => !cancelled && setDeals([]),
    );
    return () => {
      cancelled = true;
    };
  }, [name]);
  if (!item.event) return null;
  const { location } = item.event;
  const row = "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3";
  const key = "text-[var(--color-muted)]";
  return (
    <ProjectModal title={item.title} subtitle={`${dayFormat.format(new Date(item.startsAt))} · ${timeRange(item)}`} narrow onClose={onClose}>
      <div className="space-y-3 px-5 py-4">
        {location ? (
          <div className={row}>
            <span className={key}>Address</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-brand-strong)] hover:underline"
            >
              {location}
            </a>
          </div>
        ) : null}
        <div className={row}>
          <span className={key}>Calendar</span>
          <span>{calendarName(item.event)}</span>
        </div>
        <div className={row}>
          <span className={key}>Deal</span>
          {deals === null ? (
            <span className={key}>Looking…</span>
          ) : deals.length ? (
            <span className="flex flex-col gap-1">
              {deals.map((deal) => (
                <Link key={deal.id} href={dealHref(deal.id)} className="text-[var(--color-brand-strong)] hover:underline">
                  {deal.name}
                  {deal.address ? <span className="text-[var(--color-muted)]"> · {deal.address}</span> : null}
                </Link>
              ))}
            </span>
          ) : (
            <span className={key}>No deal with this name</span>
          )}
        </div>
        <p className="text-xs text-[var(--color-muted)]">Booked outside ServiceFlow. Change or cancel it where it was booked.</p>
      </div>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </ProjectModal>
  );
}

const KIND_WORDS: Record<AppointmentKind, string> = {
  estimate: "estimate",
  walkthrough: "walkthrough",
  punch_out: "punch-out",
  quality_control: "quality check",
  other: "appointment",
};

/** "Text confirmation", "Email reminder · 1 day before". */
function messageLabel(rule: ReminderRule): string {
  const channel = rule.channel === "sms" ? "Text" : "Email";
  return rule.trigger === "confirmation"
    ? `${channel} confirmation`
    : `${channel} reminder · ${delayLabel(rule.offsetMinutes)} before`;
}

const previewDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric" });
const previewTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" });

/** The message as this customer would get it, filled the way the server fills it. */
function messagePreview(
  rule: ReminderRule,
  context: { firstName: string; company: string; kind: AppointmentKind; starts: Date | null; rescheduled: boolean },
): string {
  const values: Record<string, string> = {
    first_name: context.firstName || "there",
    company: context.company,
    appointment_type: KIND_WORDS[context.kind],
    date: context.starts ? previewDate.format(context.starts) : "{{date}}",
    end_date: context.starts ? previewDate.format(context.starts) : "{{end_date}}",
    time: context.starts ? previewTime.format(context.starts) : "{{time}}",
    scheduled_or_rescheduled: context.rescheduled ? "rescheduled" : "scheduled",
  };
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
  const body = fill(rule.body);
  return rule.channel === "email" && rule.subject ? `${fill(rule.subject)} — ${body}` : body;
}

function AppointmentDialog({
  draft: initial,
  team,
  messages,
  onClose,
}: {
  draft: Draft;
  team: TeamMember[];
  messages: BookingMessages;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  // Whose times to suggest: only a person chosen in "Assigned to" narrows them;
  // one filled in by picking a time leaves the list as it is.
  const [timesFor, setTimesFor] = useState(initial.assignedTo);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; address: string | null }[]>([]);
  const [loadedCustomer, setLoadedCustomer] = useState<CustomerLoad | null>(null);
  const [fields, setFields] = useState<CustomerForm>(EMPTY_CUSTOMER);
  // Booking for someone not in ServiceFlow yet: Save adds them and a deal first.
  const [newCustomer, setNewCustomer] = useState(false);
  // Kept across retries so a second press doesn't add a second customer or deal.
  const newIds = useRef({ contact: crypto.randomUUID(), deal: crypto.randomUUID() });
  const customer = loadedCustomer?.projectId === draft.projectId ? loadedCustomer : null;
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const isNew = initial.isNew;
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const people =
    initial.assignedTo && !team.some((member) => member.id === initial.assignedTo)
      ? [...team, { id: initial.assignedTo, name: initial.assigneeName || "Current assignee" }]
      : team;
  // The customer hears about a booking or a move, not other edits.
  const confirmable =
    draft.status !== "completed" &&
    (isNew ||
      initial.status === "cancelled" ||
      draft.date !== initial.date ||
      draft.start !== initial.start ||
      draft.minutes !== initial.minutes ||
      draft.kind !== initial.kind);
  // Every rule's tick is kept, so switching type and back doesn't lose one.
  const [ticked, setTicked] = useState<Set<string>>(
    () =>
      new Set(
        initial.messageRuleIds ??
          messages.rules.filter((rule) => !initial.isNew || rule.checkedByDefault).map((rule) => rule.id),
      ),
  );
  const applicable = messages.rules
    .filter((rule) => rule.appointmentKind === null || rule.appointmentKind === draft.kind)
    .sort(
      (a, b) =>
        Number(a.trigger === "reminder") - Number(b.trigger === "reminder") ||
        b.offsetMinutes - a.offsetMinutes ||
        Number(a.channel === "email") - Number(b.channel === "email"),
    );
  // Confirmations only go out when booking or moving it; reminders follow it while it's scheduled.
  const offered = draft.status === "completed" ? [] : applicable.filter((rule) => rule.trigger === "reminder" || confirmable);
  const [startHour, startMinute] = draft.start.split(":").map(Number);
  const chosen =
    draft.date && Number.isFinite(startHour)
      ? { start: instant(draft.date, startHour * 60 + startMinute).toISOString(), userId: draft.assignedTo || null }
      : null;

  useEffect(() => {
    if (draft.projectId || newCustomer || !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchProjects(query).then((rows) => !cancelled && setResults(rows), () => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, draft.projectId, newCustomer]);

  useEffect(() => {
    const projectId = draft.projectId;
    if (!projectId) return;
    let cancelled = false;
    getDealCustomer(projectId).then(
      (saved) => {
        if (cancelled) return;
        setLoadedCustomer({ projectId, saved });
        if (saved) setFields(toForm(saved));
      },
      () => !cancelled && setLoadedCustomer({ projectId, saved: null, error: "Could not load the customer's details." }),
    );
    return () => {
      cancelled = true;
    };
  }, [draft.projectId]);

  function startNewCustomer() {
    // What was typed in the search starts whichever field it looks like.
    const typed = query.trim();
    if (typed.includes("@")) setFields({ ...EMPTY_CUSTOMER, email: typed });
    else if (/^[\d\s()+.-]{7,}$/.test(typed)) setFields({ ...EMPTY_CUSTOMER, phone: typed });
    else setFields({ ...EMPTY_CUSTOMER, ...splitName(typed) });
    setNewCustomer(true);
  }

  function submit(status: AppointmentStatus) {
    startTransition(async () => {
      setError("");
      let projectId = draft.projectId;
      if (newCustomer && !projectId) {
        const { name } = fromForm(fields);
        const address = draft.location.trim();
        const contact = await createContact({
          id: newIds.current.contact,
          name,
          phone: fields.phone.trim(),
          email: fields.email.trim(),
          address,
        }).catch(() => ({ id: undefined, error: "Could not add the customer. Try again." }));
        if (!contact.id) {
          setError(contact.error ?? "Could not add the customer.");
          return;
        }
        const deal = await createLead({ id: newIds.current.deal, contactId: contact.id, address, source: "" }).catch(() => ({
          id: undefined,
          error: "Could not add the deal. Try again.",
        }));
        if (!deal.id) {
          setError(deal.error ?? "Could not add the deal.");
          return;
        }
        projectId = deal.id;
        // From here on it's an existing deal, so a retry books it without adding anyone again.
        setNewCustomer(false);
        patch({ projectId, projectName: name });
      }
      // Corrections save first, so a confirmation goes to the right phone and email.
      const saved = customer?.saved;
      const edited = fromForm(fields);
      if (saved && (["name", "phone", "email"] as const).some((key) => edited[key] !== saved[key].trim())) {
        const result = await updateCustomer({ ...edited, id: saved.id, address: saved.address, expectedUpdatedAt: saved.updatedAt }).catch(
          () => ({ error: "Could not save the customer's details. Try again." }),
        );
        if (result.error) {
          setError(result.error);
          return;
        }
        // Saved; a retry after a failed booking reads the new version itself.
        setLoadedCustomer({ projectId: draft.projectId, saved: { ...saved, ...edited, updatedAt: "" } });
      }
      const [hour, minute] = draft.start.split(":").map(Number);
      const starts = instant(draft.date, hour * 60 + minute);
      const ends = new Date(starts.getTime() + draft.minutes * 60_000);
      const result = await saveAppointment({
        id: draft.id,
        projectId,
        title: draft.title,
        kind: draft.kind,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        assignedTo: draft.assignedTo || null,
        location: draft.location,
        notes: draft.notes,
        status,
        notify:
          confirmable &&
          status === "scheduled" &&
          applicable.some((rule) => rule.trigger === "confirmation" && ticked.has(rule.id)),
        messageRuleIds: applicable.filter((rule) => ticked.has(rule.id)).map((rule) => rule.id).sort(),
      });
      if (!result.ok) setError(result.error ?? "Could not save the appointment.");
      else {
        router.refresh();
        onClose();
      }
    });
  }

  const lengths = LENGTHS.includes(draft.minutes) ? LENGTHS : [...LENGTHS, draft.minutes].sort((a, b) => a - b);

  return (
    <ProjectModal title={isNew ? "New appointment" : "Edit appointment"} onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft.status === "cancelled" ? "scheduled" : draft.status);
        }}
      >
        <div className="space-y-4 p-5">
          {draft.projectId ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Deal or job</span>
              <div className="flex h-8 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5">
                <Link
                  href={dealHref(draft.projectId)}
                  className="truncate text-[13px] font-medium text-[var(--color-heading)] hover:text-[var(--color-brand-strong)]"
                >
                  {draft.projectName}
                </Link>
                {isNew ? (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-heading)]"
                    onClick={() => patch({ projectId: "", projectName: "" })}
                  >
                    Change
                  </button>
                ) : null}
              </div>
            </div>
          ) : newCustomer ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Deal or job</span>
              <div className="flex h-8 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5">
                <span className="truncate text-[13px] font-medium text-[var(--color-heading)]">New customer</span>
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-heading)]"
                  onClick={() => setNewCustomer(false)}
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <div>
              <Field label="Deal or job">
                <Input
                  autoFocus
                  type="search"
                  placeholder="Find a customer or project…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </Field>
              {results.length || query.trim() ? (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-[var(--radius)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-pop)]">
                  {results.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() =>
                        patch({ projectId: result.id, projectName: result.name, location: draft.location || result.address || "" })
                      }
                      className="block w-full px-2.5 py-1.5 text-left hover:bg-[var(--color-hover)]"
                    >
                      <span className="block truncate text-[13px] font-medium text-[var(--color-heading)]">{result.name}</span>
                      {result.address ? (
                        <span className="block truncate text-xs text-[var(--color-muted)]">{result.address}</span>
                      ) : null}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={startNewCustomer}
                    className="block w-full px-2.5 py-1.5 text-left text-[13px] font-medium text-[var(--color-brand-strong)] hover:bg-[var(--color-hover)]"
                  >
                    + New customer
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startNewCustomer}
                  className="mt-1.5 text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
                >
                  + New customer
                </button>
              )}
            </div>
          )}
          {!newCustomer && (!draft.projectId || (customer && !customer.saved && !customer.error)) ? null : !newCustomer && customer?.error ? (
            <p role="alert" className="text-[13px] text-[var(--color-bad)]">
              {customer.error}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {CUSTOMER_INPUTS.map(({ key, label, ...input }) => (
                <Field key={key} label={label}>
                  <Input
                    {...input}
                    autoComplete="off"
                    disabled={!newCustomer && !customer}
                    value={newCustomer || customer ? fields[key] : ""}
                    onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))}
                  />
                </Field>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={draft.kind}
                onChange={(event) => {
                  const kind = event.target.value as AppointmentKind;
                  const titled = draft.title.trim() && draft.title !== KIND_TITLES[draft.kind];
                  patch({ kind, ...(titled ? {} : { title: KIND_TITLES[kind] }) });
                }}
                className="w-full"
              >
                {APPOINTMENT_KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assigned to">
              <span className="relative block">
                <Select
                  required
                  value={draft.assignedTo}
                  onChange={(event) => {
                    patch({ assignedTo: event.target.value });
                    setTimesFor(event.target.value);
                  }}
                  className={cn("w-full", !draft.assignedTo && "text-[var(--color-faint)]")}
                  // Room for the clear button beside the arrow.
                  style={draft.assignedTo ? { paddingRight: 56 } : undefined}
                >
                  <option value="">Choose someone</option>
                  {people.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
                {draft.assignedTo ? (
                  <button
                    type="button"
                    aria-label="Clear who it's with"
                    title="Clear"
                    onClick={(event) => {
                      event.preventDefault();
                      patch({ assignedTo: "" });
                      setTimesFor("");
                    }}
                    className="absolute right-7 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]"
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-3.5 w-3.5">
                      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
                    </svg>
                  </button>
                ) : null}
              </span>
            </Field>
          </div>
          <Field label="Title">
            <Input
              required
              maxLength={120}
              list="appointment-titles"
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
            <datalist id="appointment-titles">
              {TITLE_SUGGESTIONS.map((title) => (
                <option key={title} value={title} />
              ))}
            </datalist>
          </Field>
          <Field label="Location">
            <AddressInput maxLength={500} value={draft.location} onChange={(location) => patch({ location })} />
          </Field>
          {draft.status === "completed" ? null : (
            // Nobody chosen: each day offers whoever's closest, named in its row.
            <SuggestTimes
              search={{
                address: draft.location,
                minutes: draft.minutes,
                userId: timesFor || null,
                appointmentId: isNew ? null : draft.id,
              }}
              startOpen={isNew}
              chosen={chosen}
              onPick={(time) => {
                const starts = wall(time.start);
                patch({ date: starts.day, start: inputTime(starts.minutes), ...(time.userId ? { assignedTo: time.userId } : {}) });
              }}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem]">
            <Field label="Date">
              <Input required type="date" value={draft.date} onChange={(event) => patch({ date: event.target.value })} />
            </Field>
            <Field label="Start">
              <Input required type="time" step={900} value={draft.start} onChange={(event) => patch({ start: event.target.value })} />
            </Field>
            <Field label="Length">
              <Select value={draft.minutes} onChange={(event) => patch({ minutes: Number(event.target.value) })} className="w-full">
                {lengths.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {lengthLabel(minutes)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={3} maxLength={4000} value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} />
          </Field>
          {offered.length ? (
            <fieldset className="space-y-2.5">
              <legend className="mb-1.5 text-xs font-medium text-[var(--color-muted)]">Customer messages</legend>
              {offered.map((rule) => (
                <label key={rule.id} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={ticked.has(rule.id)}
                    onChange={(event) =>
                      setTicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(rule.id);
                        else next.delete(rule.id);
                        return next;
                      })
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-[var(--color-text)]">{messageLabel(rule)}</span>
                    <span className="line-clamp-2 text-xs leading-4 text-[var(--color-muted)]">
                      {messagePreview(rule, {
                        firstName: fields.first.trim(),
                        company: messages.companyName,
                        kind: draft.kind,
                        starts: draft.date && Number.isFinite(startHour) ? instant(draft.date, startHour * 60 + startMinute) : null,
                        rescheduled: !isNew && (draft.date !== initial.date || draft.start !== initial.start),
                      })}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : draft.status !== "completed" && !messages.rules.length ? (
            <Link href={REMINDERS_HREF} className="inline-block text-xs text-[var(--color-muted)] hover:text-[var(--color-heading)]">
              Set up customer confirmations and reminders
            </Link>
          ) : null}
          {error ? <p role="alert" className="text-[13px] text-[var(--color-bad)]">{error}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-5 py-3">
          {isNew ? null : draft.status === "scheduled" ? (
            <>
              <Button type="button" variant="danger" disabled={pending} onClick={() => submit("cancelled")}>
                Cancel appointment
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => submit("completed")}>
                Mark as done
              </Button>
            </>
          ) : (
            <StatusText tone={draft.status === "completed" ? "good" : "bad"}>
              {draft.status === "completed" ? "Done" : "Cancelled"}
            </StatusText>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || (!draft.projectId && !newCustomer)}>
              {pending ? "Saving…" : draft.status === "cancelled" ? "Reschedule" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </ProjectModal>
  );
}

type BookingProject = { id: string; name: string; address: string };

const newDraft = (day: string, minutes: number, kind: AppointmentKind, assignedTo: string, project?: BookingProject): Draft => ({
  isNew: true,
  id: crypto.randomUUID(),
  projectId: project?.id ?? "",
  projectName: project?.name ?? "",
  title: KIND_TITLES[kind],
  kind,
  date: day,
  start: inputTime(minutes),
  minutes: 60,
  assignedTo,
  assigneeName: "",
  location: project?.address ?? "",
  notes: "",
  status: "scheduled",
  messageRuleIds: null,
});

/** Booking a deal's estimate from outside the calendar (the sales pipeline), on the same form. */
export function BookAppointmentDialog({
  project,
  assignedTo,
  today,
  team,
  messages,
  onClose,
}: {
  project: BookingProject;
  assignedTo: string;
  /** Today in Ottawa, YYYY-MM-DD. */
  today: string;
  team: TeamMember[];
  messages: BookingMessages;
  onClose: () => void;
}) {
  // The deal's salesperson, when they take appointments.
  const [draft] = useState(() =>
    newDraft(addDays(today, 1), 9 * 60, "estimate", team.some((member) => member.id === assignedTo) ? assignedTo : "", project),
  );
  return <AppointmentDialog draft={draft} team={team} messages={messages} onClose={onClose} />;
}

/**
 * Full-page appointments calendar: a Sunday-first month grid or three days
 * hour by hour. The URL holds the view, the date and the type and person filters.
 */
export function AppointmentsCalendar({
  view,
  month,
  start,
  today,
  kind: initialKind,
  user: initialUser,
  appointments,
  events,
  team,
  messages,
  calendar,
  newFor,
  basePath = "/appointments",
  title = "Appointments",
  tabs,
}: {
  view: AppointmentsView;
  /** Shown month, YYYY-MM (month view). */
  month: string;
  /** First shown day, YYYY-MM-DD (3-day view). */
  start: string;
  /** Today in Ottawa, YYYY-MM-DD. */
  today: string;
  /** Type filter; empty for every type. */
  kind: AppointmentKind | "";
  /** Assignee filter; empty for everyone. */
  user: string;
  appointments: Appointment[];
  /** Events on the team's connected Google Calendars, such as estimates booked elsewhere. */
  events: CalendarEvent[];
  team: TeamMember[];
  messages: BookingMessages;
  calendar: CalendarConnection;
  newFor: BookingProject | null;
  /** Where the calendar lives; its views and filters are query params on it. */
  basePath?: string;
  title?: string;
  /** Shown before the header's buttons (Appointment workflows' tabs). */
  tabs?: ReactNode;
}) {
  const router = useRouter();
  const [kind, setKind] = useState(initialKind);
  const [user, setUser] = useState(initialUser);
  const blank = (day: string, minutes = 9 * 60, project?: BookingProject) => newDraft(day, minutes, kind || "estimate", user, project);
  const [draft, setDraft] = useState<Draft | null>(() => (newFor ? blank(addDays(today, 1), 9 * 60, newFor) : null));

  type Filters = { kind: string; user: string };
  const href = (target: { view: "month"; month: string } | { view: "3day"; start: string }, filters: Filters = { kind, user }) => {
    const params = new URLSearchParams();
    if (target.view === "3day") {
      params.set("view", "3day");
      params.set("start", target.start);
    } else params.set("month", target.month);
    if (filters.kind) params.set("type", filters.kind);
    if (filters.user) params.set("user", filters.user);
    return `${basePath}${basePath.includes("?") ? "&" : "?"}${params}`;
  };
  const here = (filters?: Filters) => (view === "3day" ? href({ view, start }, filters) : href({ view, month }, filters));
  const dayHref = (day: string) => href({ view: "3day", start: day });
  const shift = (delta: number) =>
    view === "3day" ? href({ view, start: addDays(start, delta * 3) }) : href({ view, month: addMonths(month, delta) });

  // Google events have no type, so a type filter hides them.
  const fromGoogle: Item[] = kind
    ? []
    : events
        // A shared calendar's events concern whoever is filtered for.
        .filter((event) => !user || event.shared || event.userId === user)
        .map((event, index) => ({
          id: `google-${index}-${event.startsAt}`,
          projectId: "",
          projectName: null,
          projectAddress: event.location,
          title: event.title ?? "Busy",
          kind: "other",
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          assignedTo: event.userId,
          assigneeName: event.personName,
          location: event.location,
          notes: null,
          status: "scheduled",
          messageRuleIds: null,
          event,
        }));
  const items: Item[] = [
    ...appointments.filter((item) => (!kind || item.kind === kind) && (!user || item.assignedTo === user)),
    ...fromGoogle,
  ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const [viewing, setViewing] = useState<Item | null>(null);
  const open = (item: Item) => {
    if (item.event) {
      setViewing(item);
      return;
    }
    const starts = wall(item.startsAt);
    setDraft({
      isNew: false,
      id: item.id,
      projectId: item.projectId,
      projectName: item.projectName ?? "Project",
      title: item.title,
      kind: item.kind,
      date: starts.day,
      start: inputTime(starts.minutes),
      minutes: Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000),
      assignedTo: item.assignedTo ?? "",
      assigneeName: item.assigneeName ?? "",
      location: item.location ?? "",
      notes: item.notes ?? "",
      status: item.status,
      messageRuleIds: item.messageRuleIds,
    });
  };

  return (
    <div className="page-fill">
      <CalendarHeader
        title={title}
        action={
          <>
            {tabs}
            <GoogleCalendarStatusLink connection={calendar} />
            <Button onClick={() => setDraft(blank(view === "3day" ? start : addDays(today, 1)))}>+ New Appointment</Button>
          </>
        }
        view={view}
        views={[
          { value: "month", label: "Month", href: href({ view: "month", month: view === "3day" ? start.slice(0, 7) : month }) },
          {
            value: "3day",
            label: "3 Days",
            href: href({ view: "3day", start: view === "3day" ? start : today.startsWith(month) ? today : `${month}-01` }),
          },
        ]}
        label={view === "3day" ? rangeLabel(start, addDays(start, 2)) : monthLabel(month)}
        prevHref={shift(-1)}
        nextHref={shift(1)}
        todayHref={view === "3day" ? href({ view, start: today }) : href({ view, month: today.slice(0, 7) })}
        filter={
          <>
            <CalendarFilter
              label="Type"
              allLabel="All types"
              value={kind}
              options={APPOINTMENT_KINDS}
              onChange={(value) => {
                setKind(value as AppointmentKind | "");
                window.history.replaceState(null, "", here({ kind: value, user }));
              }}
            />
            <CalendarFilter
              label="Assigned to"
              allLabel="All users"
              value={user}
              options={team}
              onChange={(value) => {
                setUser(value);
                window.history.replaceState(null, "", here({ kind, user: value }));
              }}
            />
          </>
        }
      />
      {/* Phones scroll the page, so the calendar keeps its own height there. */}
      <div className="flex min-h-0 flex-1 flex-col max-md:h-[36rem] max-md:flex-none">
        {view === "3day" ? (
          <DaysView start={start} today={today} items={items} onNew={(day, minutes) => setDraft(blank(day, minutes))} onOpen={open} />
        ) : (
          <MonthView month={month} today={today} items={items} dayHref={dayHref} onNew={(day) => setDraft(blank(day))} onOpen={open} />
        )}
      </div>
      {viewing ? <CalendarEventDialog item={viewing} onClose={() => setViewing(null)} /> : null}
      {draft ? (
        <AppointmentDialog
          key={draft.id}
          draft={draft}
          team={team}
          messages={messages}
          onClose={() => {
            setDraft(null);
            if (newFor) router.replace(here());
          }}
        />
      ) : null}
    </div>
  );
}
