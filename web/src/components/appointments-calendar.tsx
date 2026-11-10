"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveAppointment } from "@/lib/actions/appointments";
import type { CalendarConnection } from "@/lib/actions/calendar";
import { getDealCustomer, updateCustomer, type DealCustomer } from "@/lib/actions/contacts";
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
  ConfirmationOption,
  DAY_NUMBER_HEIGHT,
  GUTTER,
  addDays,
  addMonths,
  monthLabel,
  monthWeeks,
  rangeLabel,
  tintStyle,
} from "./calendar-month-grid";
import { ProjectModal } from "./project-profile-panel";
import { AddressInput } from "./address-input";
import { GoogleCalendarStatusLink } from "./settings/google-calendar-section";
import { SuggestTimes } from "./suggest-times";
import { Button, Field, Input, Select, StatusText, Textarea, cn, type TagTone } from "./ui";
import { dealHref } from "@/lib/pipeline-types";

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
  location: string;
  notes: string;
  status: AppointmentStatus;
  notify: boolean;
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

const label = (item: Item) => (item.event ? item.title : `${item.projectName ?? "Project"} — ${item.title}`);

/** The deal's customer details, shown and corrected on the appointment form. */
type CustomerFields = Pick<DealCustomer, "name" | "phone" | "email">;
type CustomerLoad = { projectId: string; saved: DealCustomer | null; error?: string };
const CUSTOMER_INPUTS = [
  { key: "name", label: "Customer", type: "text", maxLength: 160, required: true },
  { key: "phone", label: "Phone", type: "tel", maxLength: 60, required: false },
  { key: "email", label: "Email", type: "email", maxLength: 320, required: false },
] as const;
const customerFields = ({ name, phone, email }: CustomerFields): CustomerFields => ({ name, phone, email });

function describe(item: Item): string {
  if (item.event) {
    const { personName, calendar, location } = item.event;
    return `${timeRange(item)} · ${item.title}${location ? ` · ${location}` : ""} · ${personName}'s Google Calendar${calendar ? ` (${calendar})` : ""}`;
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
  onOpen: (item: Appointment) => void;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // Google Calendar events are shown, not edited here.
  if (item.event) {
    return (
      <div
        title={describe(item)}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "cursor-default rounded-[5px] border border-dashed border-[var(--color-border-strong)] text-left text-xs",
          className,
        )}
        style={{ ...tintStyle(KIND_TINTS.other), ...style }}
      >
        {children}
      </div>
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
  onOpen: (item: Appointment) => void;
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
                <span className="shrink-0 tabular-nums text-[var(--color-muted)]">{timeRange(item)}</span>
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
  onOpen: (item: Appointment) => void;
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

function AppointmentDialog({
  draft: initial,
  team,
  confirmationKinds,
  onClose,
}: {
  draft: Draft;
  team: TeamMember[];
  /** Types an enabled confirmation is set up for. */
  confirmationKinds: AppointmentKind[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; address: string | null }[]>([]);
  const [loadedCustomer, setLoadedCustomer] = useState<CustomerLoad | null>(null);
  const [fields, setFields] = useState<CustomerFields>({ name: "", phone: "", email: "" });
  const customer = loadedCustomer?.projectId === draft.projectId ? loadedCustomer : null;
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const isNew = initial.isNew;
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  // The customer hears about a booking or a move, not other edits.
  const confirmable =
    draft.status !== "completed" &&
    (isNew ||
      initial.status === "cancelled" ||
      draft.date !== initial.date ||
      draft.start !== initial.start ||
      draft.minutes !== initial.minutes ||
      draft.kind !== initial.kind);
  const canConfirm = confirmable && confirmationKinds.includes(draft.kind);
  const [startHour, startMinute] = draft.start.split(":").map(Number);
  const chosen =
    draft.date && Number.isFinite(startHour)
      ? { start: instant(draft.date, startHour * 60 + startMinute).toISOString(), userId: draft.assignedTo || null }
      : null;

  useEffect(() => {
    if (draft.projectId || !query.trim()) {
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
  }, [query, draft.projectId]);

  useEffect(() => {
    const projectId = draft.projectId;
    if (!projectId) return;
    let cancelled = false;
    getDealCustomer(projectId).then(
      (saved) => {
        if (cancelled) return;
        setLoadedCustomer({ projectId, saved });
        if (saved) setFields(customerFields(saved));
      },
      () => !cancelled && setLoadedCustomer({ projectId, saved: null, error: "Could not load the customer's details." }),
    );
    return () => {
      cancelled = true;
    };
  }, [draft.projectId]);

  function submit(status: AppointmentStatus) {
    startTransition(async () => {
      setError("");
      // Corrections save first, so a confirmation goes to the right phone and email.
      const saved = customer?.saved;
      const edited = customerFields({ name: fields.name.trim(), phone: fields.phone.trim(), email: fields.email.trim() });
      if (saved && CUSTOMER_INPUTS.some(({ key }) => edited[key] !== saved[key].trim())) {
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
        projectId: draft.projectId,
        title: draft.title,
        kind: draft.kind,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        assignedTo: draft.assignedTo || null,
        location: draft.location,
        notes: draft.notes,
        status,
        notify: canConfirm && draft.notify && status === "scheduled",
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
              {results.length ? (
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
                </div>
              ) : null}
            </div>
          )}
          {!draft.projectId || (customer && !customer.saved && !customer.error) ? null : customer?.error ? (
            <p role="alert" className="text-[13px] text-[var(--color-bad)]">
              {customer.error}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1.4fr)]">
              {CUSTOMER_INPUTS.map(({ key, label, ...input }) => (
                <Field key={key} label={label}>
                  <Input
                    {...input}
                    autoComplete="off"
                    disabled={!customer}
                    value={customer ? fields[key] : ""}
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
              <Select value={draft.assignedTo} onChange={(event) => patch({ assignedTo: event.target.value })} className="w-full">
                <option value="">Unassigned</option>
                {team.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
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
            <SuggestTimes
              search={{
                address: draft.location,
                minutes: draft.minutes,
                userId: draft.assignedTo || null,
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
          {confirmable ? (
            <ConfirmationOption
              available={canConfirm}
              checked={draft.notify}
              onChange={(notify) => patch({ notify })}
            />
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
            <Button type="submit" disabled={pending || !draft.projectId}>
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
  location: project?.address ?? "",
  notes: "",
  status: "scheduled",
  notify: true,
});

/** Booking a deal's estimate from outside the calendar (the sales pipeline), on the same form. */
export function BookAppointmentDialog({
  project,
  assignedTo,
  today,
  team,
  confirmationKinds,
  onClose,
}: {
  project: BookingProject;
  assignedTo: string;
  /** Today in Ottawa, YYYY-MM-DD. */
  today: string;
  team: TeamMember[];
  /** Types an enabled confirmation is set up for. */
  confirmationKinds: AppointmentKind[];
  onClose: () => void;
}) {
  const [draft] = useState(() => newDraft(addDays(today, 1), 9 * 60, "estimate", assignedTo, project));
  return <AppointmentDialog draft={draft} team={team} confirmationKinds={confirmationKinds} onClose={onClose} />;
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
  confirmationKinds,
  calendar,
  newFor,
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
  /** Types an enabled confirmation is set up for. */
  confirmationKinds: AppointmentKind[];
  calendar: CalendarConnection;
  newFor: BookingProject | null;
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
    return `/appointments?${params}`;
  };
  const here = (filters?: Filters) => (view === "3day" ? href({ view, start }, filters) : href({ view, month }, filters));
  const dayHref = (day: string) => href({ view: "3day", start: day });
  const shift = (delta: number) =>
    view === "3day" ? href({ view, start: addDays(start, delta * 3) }) : href({ view, month: addMonths(month, delta) });

  // Google events have no type, so a type filter hides them.
  const fromGoogle: Item[] = kind
    ? []
    : events
        .filter((event) => !user || event.userId === user)
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
          event,
        }));
  const items: Item[] = [
    ...appointments.filter((item) => (!kind || item.kind === kind) && (!user || item.assignedTo === user)),
    ...fromGoogle,
  ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const open = (item: Appointment) => {
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
      location: item.location ?? "",
      notes: item.notes ?? "",
      status: item.status,
      notify: true,
    });
  };

  return (
    <div className="page-fill">
      <CalendarHeader
        title="Appointments"
        action={
          <>
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
      {draft ? (
        <AppointmentDialog
          key={draft.id}
          draft={draft}
          team={team}
          confirmationKinds={confirmationKinds}
          onClose={() => {
            setDraft(null);
            if (newFor) router.replace(here());
          }}
        />
      ) : null}
    </div>
  );
}
