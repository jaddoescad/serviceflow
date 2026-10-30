"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAvailability, saveBookingRules } from "@/lib/actions/booking";
import { WEEKDAYS, type BookingPerson, type BookingSettings, type WeeklyHours } from "@/lib/booking-types";
import { Switch } from "@/components/pipeline-ui";
import { Button, Field, Input, Select, cn } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

// Monday first, as people read a work week.
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WORK_WEEK: WeeklyHours[] = [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" }));
const BREAKS = [0, 15, 30, 45];
const DRIVES = [15, 30, 45, 60];

function clock(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const suffix = hour < 12 || hour === 24 ? "AM" : "PM";
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${suffix}`;
}

/** "Mon–Fri 9 AM–5 PM, Sat 10 AM–2 PM". */
export function hoursSummary(hours: WeeklyHours[]): string {
  const byDay = new Map<number, string>();
  for (const day of WEEK) {
    const parts = hours.filter((item) => item.day === day).sort((a, b) => a.start.localeCompare(b.start));
    if (parts.length) byDay.set(day, parts.map((item) => `${clock(item.start)}–${clock(item.end)}`).join(", "));
  }
  const groups: { first: number; last: number; text: string }[] = [];
  for (const day of WEEK) {
    const text = byDay.get(day);
    if (!text) continue;
    const previous = groups.at(-1);
    if (previous && previous.text === text && WEEK.indexOf(previous.last) === WEEK.indexOf(day) - 1) previous.last = day;
    else groups.push({ first: day, last: day, text });
  }
  const short = (day: number) => WEEKDAYS[day].slice(0, 3);
  return groups
    .map((group) => `${short(group.first)}${group.last !== group.first ? `–${short(group.last)}` : ""} ${group.text}`)
    .join(", ");
}

function PersonHours({ person, onDone }: { person: BookingPerson; onDone: () => void }) {
  const router = useRouter();
  const [takes, setTakes] = useState(person.takesBookings);
  const [hours, setHours] = useState<WeeklyHours[]>(person.hours.length ? person.hours : WORK_WEEK);
  const [maxPerDay, setMaxPerDay] = useState(person.maxPerDay);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const dayHours = (day: number) => hours.find((item) => item.day === day);
  const setDay = (day: number, next: WeeklyHours | null) =>
    setHours((current) =>
      [...current.filter((item) => item.day !== day), ...(next ? [next] : [])].sort((a, b) => a.day - b.day),
    );

  function save() {
    startTransition(async () => {
      setError("");
      const result = await saveAvailability({ userId: person.id, takesBookings: takes, hours, maxPerDay });
      if (!result.ok) setError(result.error ?? "Could not save.");
      else {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <div className="space-y-3 pb-3">
      <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)]">
        <Switch label="Takes appointments" checked={takes} onChange={setTakes} />
        Takes appointments
      </label>
      {takes ? (
        <>
          <ul className="space-y-1.5">
            {WEEK.map((day) => {
              const current = dayHours(day);
              return (
                <li key={day} className="flex h-8 items-center gap-3 text-[13px]">
                  <label className="flex w-28 items-center gap-2 text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={Boolean(current)}
                      onChange={(event) =>
                        setDay(day, event.target.checked ? { day, start: "09:00", end: "17:00" } : null)
                      }
                    />
                    {WEEKDAYS[day]}
                  </label>
                  {current ? (
                    <span className="flex items-center gap-2">
                      <Input
                        type="time"
                        step={900}
                        aria-label={`${WEEKDAYS[day]} start`}
                        value={current.start}
                        onChange={(event) => setDay(day, { ...current, start: event.target.value })}
                        className="w-32"
                      />
                      <span className="text-[var(--color-muted)]">to</span>
                      <Input
                        type="time"
                        step={900}
                        aria-label={`${WEEKDAYS[day]} end`}
                        value={current.end}
                        onChange={(event) => setDay(day, { ...current, end: event.target.value })}
                        className="w-32"
                      />
                    </span>
                  ) : (
                    <span className="text-[var(--color-faint)]">Off</span>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)]">
            Up to
            <Select
              value={maxPerDay ?? ""}
              onChange={(event) => setMaxPerDay(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">any number of</option>
              {[1, 2, 3, 4, 5, 6, 8].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </Select>
            appointments a day
          </label>
        </>
      ) : null}
      <div className="flex items-center gap-2">
        <SaveStatus error={error} />
        <Button type="button" variant="secondary" className="ml-auto" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" disabled={pending || (takes && !hours.length)} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/** Settings › Availability: who takes appointments and when, and what
 * suggested times leave between visits. */
export function AvailabilitySettings({ settings }: { settings: BookingSettings }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [rules, setRules] = useState({ bufferMinutes: settings.bufferMinutes, travelMinutes: settings.travelMinutes });
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const minutes = (value: number) => (value ? `${value} min` : "None");

  // Saved as soon as one changes.
  function change(next: Partial<typeof rules>) {
    const updated = { ...rules, ...next };
    setRules(updated);
    startTransition(async () => {
      setStatus({});
      const result = await saveBookingRules(updated);
      if (!result.ok) setStatus({ error: result.error ?? "Could not save." });
      else {
        setStatus({ message: "Saved." });
        router.refresh();
      }
    });
  }

  return (
    <SettingsSection
      id="availability"
      title="Availability"
      description="When each person takes appointments. Suggested times in a new appointment fit these hours around their other visits, the drive between them and busy times on their Google Calendar."
    >
      <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {settings.people.map((person) => (
          <li key={person.id}>
            <div className="flex min-h-11 items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[var(--color-heading)]">{person.name}</div>
                <div
                  className={cn(
                    "truncate text-xs",
                    person.takesBookings ? "text-[var(--color-muted)]" : "text-[var(--color-faint)]",
                  )}
                >
                  {person.takesBookings
                    ? [
                        hoursSummary(person.hours),
                        person.maxPerDay ? `up to ${person.maxPerDay} a day` : "",
                        person.calendarConnected ? "Google Calendar" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Doesn't take appointments"}
                </div>
              </div>
              {editing === person.id ? null : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(person.id)}>
                  Edit
                </Button>
              )}
            </div>
            {editing === person.id ? <PersonHours person={person} onDone={() => setEditing(null)} /> : null}
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Break between visits">
          <Select
            value={rules.bufferMinutes}
            disabled={pending}
            onChange={(event) => change({ bufferMinutes: Number(event.target.value) })}
            className="w-full"
          >
            {[...new Set([...BREAKS, settings.bufferMinutes])].map((value) => (
              <option key={value} value={value}>
                {minutes(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Drive time when Google can't estimate it">
          <Select
            value={rules.travelMinutes}
            disabled={pending}
            onChange={(event) => change({ travelMinutes: Number(event.target.value) })}
            className="w-full"
          >
            {[...new Set([...DRIVES, settings.travelMinutes])].map((value) => (
              <option key={value} value={value}>
                {minutes(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-2 text-[13px]">
        <SaveStatus error={status.error} message={status.message} />
      </div>
    </SettingsSection>
  );
}
