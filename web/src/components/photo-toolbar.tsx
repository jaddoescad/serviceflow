"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type MediaView = {
  type: "all" | "image" | "video";
  size: "compact" | "medium" | "comfortable";
  oldestFirst: boolean;
};

function Popover({
  label,
  active = false,
  align = "left",
  children,
  onClear,
  showChevron = true,
}: {
  label: string;
  active?: boolean;
  align?: "left" | "right";
  children: ReactNode;
  onClear?: () => void;
  showChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    function positionPanel() {
      if (!root.current || !panel.current) return;
      const anchor = root.current.getBoundingClientRect();
      const width = panel.current.getBoundingClientRect().width;
      const preferred = align === "right" ? anchor.right - width : anchor.left;
      const left = Math.max(16, Math.min(preferred, document.documentElement.clientWidth - width - 16));
      setHorizontalOffset(left - preferred);
    }
    positionPanel();
    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex h-8 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-[13px] font-medium outline-none transition-colors focus-visible:shadow-[var(--focus-ring)] ${onClear ? "pr-8" : ""} ${active ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-ink)]" : open ? "border-[var(--color-brand)] bg-[var(--color-surface)] text-[var(--color-heading)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-heading)] hover:bg-[var(--color-hover)]"}`}
      >
        {label}
        {showChevron && (
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )}
      </button>
      {onClear && (
        <button
          type="button"
          aria-label="Clear dates"
          onClick={() => {
            setOpen(false);
            onClear();
            trigger.current?.focus();
          }}
          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded text-[var(--color-primary-ink)] hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          ×
        </button>
      )}
      {open ? (
        <div
          ref={panel}
          style={{ transform: `translateX(${horizontalOffset}px)` }}
          className={`absolute top-full z-30 mt-1 max-w-[calc(100vw-32px)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[13px] shadow-[var(--shadow-pop)] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ChoiceFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: [string, string][];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = options.filter(([, name]) =>
    name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <Popover
      label={`${label}${selected.length ? ` (${selected.length})` : ""}`}
      active={selected.length > 0}
    >
      <div className="w-80 max-w-full p-4">
        <input
          type="search"
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-2 h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2.5 text-[13px] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-brand)] focus:shadow-[var(--focus-ring)]"
        />
        {selected.length ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-2 text-xs font-medium text-[var(--color-brand-strong)]"
          >
            Clear selection
          </button>
        ) : null}
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {matches.map(([id, name]) => (
            <label
              key={id}
              className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 text-[13px] hover:bg-[var(--color-hover)]"
            >
              <input
                type="checkbox"
                checked={selected.includes(id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, id]
                      : selected.filter((value) => value !== id),
                  )
                }
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
              />
              <span>{name}</span>
            </label>
          ))}
          {!matches.length ? (
            <p className="py-3 text-[13px] text-[var(--color-muted)]">No matches</p>
          ) : null}
        </div>
      </div>
    </Popover>
  );
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function CalendarRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const date = from ? new Date(`${from}T12:00:00`) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const year = month.getFullYear(),
    index = month.getMonth();
  const days = new Date(year, index + 1, 0).getDate();
  const today = new Date();
  function displayDate(value: string) {
    const date = new Date(`${value}T12:00:00`);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== today.getFullYear()
        ? { year: "numeric" as const }
        : {}),
    });
  }
  const todayKey = dateKey(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  function select(value: string) {
    if (!from || to) onChange(value, "");
    else onChange(value < from ? value : from, value < from ? from : value);
  }
  return (
    <Popover
      label={
        from
          ? `${displayDate(from)}${to && to !== from ? ` – ${displayDate(to)}` : ""}`
          : "Date Range"
      }
      active={Boolean(from)}
      showChevron={false}
      onClear={from ? () => onChange("", "") : undefined}
    >
      <div className="w-[260px] p-3">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(year, index - 1, 1))}
            className="h-7 w-7 rounded-md hover:bg-[var(--color-hover)]"
          >
            ‹
          </button>
          <span>
            {month.toLocaleDateString("en-CA", {
              month: "long",
              year: "numeric",
            })}
          </span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(new Date(year, index + 1, 1))}
            className="h-7 w-7 rounded-md hover:bg-[var(--color-hover)]"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-xs">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
            <span key={day} className="py-2 font-medium">
              {day}
            </span>
          ))}
          {Array.from({ length: month.getDay() }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const value = dateKey(year, index, i + 1);
            const selected = value === from || value === to;
            const inRange = from && to && value > from && value < to;
            return (
              <button
                type="button"
                key={value}
                aria-label={value}
                aria-pressed={selected}
                onClick={() => select(value)}
                className={`h-8 rounded-md ${selected ? "bg-[var(--color-primary)] text-[var(--color-primary-ink)]" : inRange ? "bg-[var(--color-brand-soft)]" : value === todayKey ? "font-semibold text-[var(--color-brand-strong)]" : "hover:bg-[var(--color-hover)]"}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

export function PhotoToolbar({
  projects,
  users,
  hideUsers = false,
  selectedProjects = [],
  selectedUsers,
  onProjects,
  onUsers,
  from,
  to,
  onDates,
  view,
  onView,
  tags,
  trailing,
}: {
  projects?: [string, string][];
  users: [string, string][];
  hideUsers?: boolean;
  selectedProjects?: string[];
  selectedUsers: string[];
  onProjects?: (values: string[]) => void;
  onUsers: (values: string[]) => void;
  from: string;
  to: string;
  onDates: (from: string, to: string) => void;
  view: MediaView;
  onView: (view: MediaView) => void;
  tags?: {
    options: string[];
    selected: string[];
    onChange: (values: string[]) => void;
  };
  trailing?: ReactNode;
}) {
  const filters = Boolean(
    from ||
    selectedProjects.length ||
    selectedUsers.length ||
    tags?.selected.length,
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarRange from={from} to={to} onChange={onDates} />
      {projects && onProjects ? (
        <ChoiceFilter
          label="Projects"
          options={projects}
          selected={selectedProjects}
          onChange={onProjects}
        />
      ) : null}
      {!hideUsers && (
        <ChoiceFilter
          label="Users"
          options={users}
          selected={selectedUsers}
          onChange={onUsers}
        />
      )}
      {tags ? (
        <ChoiceFilter
          label="Tags"
          options={tags.options.map((tag) => [tag, tag])}
          selected={tags.selected}
          onChange={tags.onChange}
        />
      ) : null}
      {filters ? (
        <button
          type="button"
          onClick={() => {
            onDates("", "");
            onProjects?.([]);
            tags?.onChange([]);
            onUsers([]);
          }}
          className="h-8 rounded-md px-2 text-[13px] font-medium text-[var(--color-brand-strong)] hover:bg-[var(--color-hover)]"
        >
          Clear filters
        </button>
      ) : null}
      <div className="ml-auto">
        <Popover label="View" align="right">
          <div className="w-72 space-y-4 p-4">
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-[var(--color-muted)]">
                Type
              </legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    ["image", "Photos Only"],
                    ["video", "Videos Only"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-1 text-xs"
                  >
                    <input
                      type="radio"
                      name="media-type"
                      checked={view.type === value}
                      onChange={() => onView({ ...view, type: value })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-[var(--color-muted)]">
                Photo Size
              </legend>
              <div className="flex gap-4">
                {(
                  [
                    ["compact", "Small"],
                    ["medium", "Medium"],
                    ["comfortable", "Large"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-1 text-xs"
                  >
                    <input
                      type="radio"
                      name="media-size"
                      checked={view.size === value}
                      onChange={() => onView({ ...view, size: value })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-[var(--color-muted)]">
                Order
              </legend>
              <div className="flex gap-4">
                {[false, true].map((oldestFirst) => (
                  <label
                    key={String(oldestFirst)}
                    className="flex cursor-pointer items-center gap-1 text-xs"
                  >
                    <input
                      type="radio"
                      name="media-order"
                      checked={view.oldestFirst === oldestFirst}
                      onChange={() => onView({ ...view, oldestFirst })}
                    />
                    {oldestFirst ? "Oldest First" : "Newest First"}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Popover>
      </div>
      {trailing}
    </div>
  );
}
