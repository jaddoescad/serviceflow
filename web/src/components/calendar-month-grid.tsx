import Link from "next/link";
import type { CSSProperties, ReactNode, Ref } from "react";
import { REMINDERS_HREF } from "@/lib/reminder-types";
import { PageHeader } from "./kpi";
import { FilterPills, TableToolbar } from "./table-ui";
import { Select, TAG_DOT, buttonClassName, cn, type TagTone } from "./ui";

// Shared full-page calendar pieces for Appointments and the Job Schedule.
// No "use client": the pages import the date helpers on the server.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Width of the hour labels in the day views. */
export const GUTTER = "3.5rem";
/** Height of the day-number strip at the top of each month cell, in px (h-7). */
export const DAY_NUMBER_HEIGHT = 28;
const MIN_ROW_HEIGHT = 88;

/** A soft tinted event or job bar, with a 2px bar of its tint's text colour on the left. */
export const tintStyle = (tone: TagTone, leftBar = true): CSSProperties => ({
  backgroundColor: `var(--tag-${tone}-bg)`,
  boxShadow: leftBar ? `inset 2px 0 0 ${TAG_DOT[tone]}` : undefined,
});

// Calendar arithmetic on YYYY-MM-DD strings, in UTC so no time zone shifts a day.
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

export function addDays(day: string, days: number): string {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) =>
  Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);

export function addMonths(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1 + delta, 1)).toISOString().slice(0, 7);
}

export const isDay = (value: string | undefined): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;

export const isMonth = (value: string | undefined): value is string =>
  !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** The Sunday that starts each week row covering the month (four to six rows). */
export function monthWeeks(month: string): string[] {
  const first = `${month}-01`;
  const lead = utc(first).getUTCDay();
  const [year, index] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((lead + length) / 7) }, (_, week) => addDays(first, week * 7 - lead));
}

export function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${MONTHS[index - 1]} ${year}`;
}

/** "Oct 23 – 25, 2026", "Oct 30 – Nov 1, 2026" or "Dec 30, 2026 – Jan 1, 2027". */
export function rangeLabel(from: string, to: string): string {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const short = (index: number) => MONTHS[index - 1].slice(0, 3);
  if (fromYear !== toYear) return `${short(fromMonth)} ${fromDay}, ${fromYear} – ${short(toMonth)} ${toDay}, ${toYear}`;
  if (fromMonth !== toMonth) return `${short(fromMonth)} ${fromDay} – ${short(toMonth)} ${toDay}, ${toYear}`;
  return `${short(fromMonth)} ${fromDay} – ${toDay}, ${toYear}`;
}

function Chevron({ left }: { left?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d={left ? "M12 5l-5 5 5 5" : "M8 5l5 5-5 5"} />
    </svg>
  );
}

const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]";

/** The page bar (title and action), then a sub-bar with the view switch, date navigation and filters. */
export function CalendarHeader({
  title,
  action,
  view,
  views,
  label,
  prevHref,
  nextHref,
  todayHref,
  filter,
}: {
  title: string;
  action?: ReactNode;
  view: string;
  views: { value: string; label: string; href: string }[];
  label: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  filter?: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} actions={action} />
      <TableToolbar>
        <FilterPills label="Calendar view" value={view} options={views} />
        <Link href={todayHref} className={buttonClassName({ variant: "secondary" })}>
          Today
        </Link>
        <div className="flex items-center">
          <Link href={prevHref} aria-label="Previous" className={iconButton}>
            <Chevron left />
          </Link>
          <Link href={nextHref} aria-label="Next" className={iconButton}>
            <Chevron />
          </Link>
        </div>
        <span className="text-sm font-semibold text-[var(--color-heading)]">{label}</span>
        {filter ? (
          // Phones give the filters their own full-width row.
          <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1">
            {filter}
          </div>
        ) : null}
      </TableToolbar>
    </>
  );
}

type FilterOption = { id: string; name: string };

export function CalendarFilter({
  label,
  allLabel,
  value,
  options = [],
  groups = [],
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options?: FilterOption[];
  /** Options under headings; groups without options are left out. */
  groups?: { label: string; options: FilterOption[] }[];
  onChange: (value: string) => void;
}) {
  const list = (items: FilterOption[]) =>
    items.map((option) => (
      <option key={option.id} value={option.id}>
        {option.name}
      </option>
    ));
  return (
    <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="min-w-36">
      <option value="">{allLabel}</option>
      {list(options)}
      {groups
        .filter((group) => group.options.length)
        .map((group) => (
          <optgroup key={group.label} label={group.label}>
            {list(group.options)}
          </optgroup>
        ))}
    </Select>
  );
}

/**
 * In a booking dialog: the choice to send the customer a confirmation, or,
 * until a confirmation is set up for it, a quiet link to set one up.
 */
export function ConfirmationOption({
  available,
  checked,
  onChange,
}: {
  available: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return available ? (
    <label className="flex w-fit items-center gap-2 text-[13px] text-[var(--color-text)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--color-brand)]"
      />
      Send confirmation to customer
    </label>
  ) : (
    <Link href={REMINDERS_HREF} className="inline-block text-xs text-[var(--color-muted)] hover:text-[var(--color-heading)]">
      Set up customer confirmations
    </Link>
  );
}

/** A day's number; today's sits in a filled brand circle. */
function DayNumber({ day, today, outside = false, href }: { day: string; today: string; outside?: boolean; href?: string }) {
  const className = cn(
    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums",
    day === today
      ? "bg-[var(--color-brand)] font-semibold text-[var(--color-brand-ink)]"
      : cn(
          outside ? "text-[var(--color-faint)]" : "font-medium text-[var(--color-text)]",
          href && "hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]",
        ),
  );
  const number = Number(day.slice(8));
  return href ? (
    <Link href={href} onClick={(event) => event.stopPropagation()} className={className}>
      {number}
    </Link>
  ) : (
    <span className={className}>{number}</span>
  );
}

/** Column headings for the day views: "Fri 23". */
export function CalendarDayHeader({ days, today, gutter = false }: { days: string[]; today: string; gutter?: boolean }) {
  return (
    <div
      className="grid shrink-0 border-b border-[var(--color-border)]"
      style={{ gridTemplateColumns: `${gutter ? `${GUTTER} ` : ""}repeat(${days.length}, minmax(0, 1fr))` }}
    >
      {gutter ? <div /> : null}
      {days.map((day) => (
        <div
          key={day}
          className={cn("flex h-9 items-center gap-1.5 border-l border-[var(--color-border)] px-2.5", !gutter && "first:border-l-0")}
        >
          <span className="text-xs font-medium text-[var(--color-muted)]">{WEEKDAYS[utc(day).getUTCDay()]}</span>
          <DayNumber day={day} today={today} />
        </div>
      ))}
    </div>
  );
}

/**
 * Edge-to-edge Sunday-first month grid of hairlines whose week rows share the
 * available height. Each row is at least `rowMinHeights[i]` px; the body
 * scrolls past that, and narrow screens scroll it sideways.
 */
export function CalendarMonthGrid({
  month,
  today,
  bodyRef,
  rowMinHeights,
  dayHref,
  onDayClick,
  renderDay,
  renderWeek,
}: {
  month: string;
  today: string;
  bodyRef?: Ref<HTMLDivElement>;
  rowMinHeights?: number[];
  /** Where a day number links to. */
  dayHref?: (day: string) => string;
  /** Click on a day's empty space. */
  onDayClick?: (day: string) => void;
  /** Content inside each day cell, under its number. */
  renderDay?: (day: string) => ReactNode;
  /** Content laid over a whole week row, under the day numbers. */
  renderWeek?: (weekStart: string, week: number) => ReactNode;
}) {
  const weeks = monthWeeks(month);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
      <div className="flex min-h-0 min-w-[32rem] flex-1 flex-col">
        <div className="grid h-8 shrink-0 grid-cols-7 items-center border-b border-[var(--color-border)]">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2.5 text-xs font-medium text-[var(--color-muted)]">
              {day}
            </div>
          ))}
        </div>
        <div
          ref={bodyRef}
          className="grid min-h-0 flex-1 overflow-y-auto"
          style={{
            gridTemplateRows: weeks
              .map((_, week) => `minmax(${Math.max(MIN_ROW_HEIGHT, rowMinHeights?.[week] ?? 0)}px, 1fr)`)
              .join(" "),
          }}
        >
          {weeks.map((weekStart, week) => (
            <div key={weekStart} className="relative grid min-h-0 grid-cols-7 border-b border-[var(--color-border)] last:border-b-0">
              {Array.from({ length: 7 }, (_, index) => {
                const day = addDays(weekStart, index);
                const outside = !day.startsWith(month);
                return (
                  <div
                    key={day}
                    onClick={onDayClick ? () => onDayClick(day) : undefined}
                    className={cn(
                      "flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-[var(--color-border)] last:border-r-0",
                      outside && "bg-[var(--color-surface-2)]/50",
                    )}
                  >
                    <div className="flex h-7 shrink-0 items-center px-1.5">
                      <DayNumber day={day} today={today} outside={outside} href={dayHref?.(day)} />
                    </div>
                    {renderDay?.(day)}
                  </div>
                );
              })}
              {renderWeek ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: DAY_NUMBER_HEIGHT }}>
                  {renderWeek(weekStart, week)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
