"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveAvailability } from "@/lib/actions/booking";
import { saveWorkflowSettings } from "@/lib/actions/workflows";
import type { CalendarConnection } from "@/lib/actions/calendar";
import type { BookingPerson } from "@/lib/booking-types";
import type { WorkflowSettings, WorkflowSkill } from "@/lib/workflow-types";
import { PersonHours, hoursSummary } from "./settings/availability-settings";
import { SaveStatus, SettingsSection } from "./settings/settings-section";
import { Button, Field, Input, Select, Tag, Textarea, buttonClassName } from "./ui";

const LENGTHS = [30, 45, 60, 90, 120];
// Google sends you back to this tab.
const CONNECT_URL = "/api/google-calendar/connect?from=workflows";

/** Appointment workflows › Settings: the salespeople it books, the prompt and skills, the visit length. */
export function WorkflowSettingsForm({
  settings,
  team,
  me,
  myCalendar,
  calendarFailed,
}: {
  settings: WorkflowSettings;
  /** Everyone, with their hours (get_booking_settings). */
  team: BookingPerson[];
  /** The signed-in person. */
  me: string;
  myCalendar: CalendarConnection;
  /** Google came back without connecting. */
  calendarFailed: boolean;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(settings.prompt);
  const [skills, setSkills] = useState<WorkflowSkill[]>(settings.skills);
  const [minutes, setMinutes] = useState(settings.minutes);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveWorkflowSettings(prompt, skills, minutes);
      setStatus(result.ok ? { message: "Saved" } : { error: result.error ?? "Couldn't save." });
      if (result.ok) router.refresh();
    });
  }

  const editSkill = (index: number, patch: Partial<WorkflowSkill>) =>
    setSkills((current) => current.map((skill, at) => (at === index ? { ...skill, ...patch } : skill)));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Salespeople settings={settings} team={team} me={me} myCalendar={myCalendar} calendarFailed={calendarFailed} />

      <SettingsSection
        id="prompt"
        title="Prompt"
        description="Everything the AI is told: its job, when to text, book, wait, close or send to Needs you, how texts should sound, and what to know about your company. It reads each card's conversation, history and open times, and answers in a fixed format."
      >
        <Textarea
          aria-label="Prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={28}
          maxLength={20000}
          className="font-mono text-[12.5px] leading-5"
          placeholder="You help a painting company's office book on-site estimates…"
        />
      </SettingsSection>

      <SettingsSection id="skills" title="Skills" description="Extra instructions for specific situations.">
        <div className="flex flex-col gap-4">
          {skills.map((skill, index) => (
            <div key={index} className="flex flex-col gap-2 border-b border-[var(--color-border)] pb-4 last:border-b-0">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Title">
                    <Input value={skill.title} maxLength={80} onChange={(event) => editSkill(index, { title: event.target.value })} />
                  </Field>
                </div>
                <Button type="button" variant="ghost" onClick={() => setSkills((current) => current.filter((_, at) => at !== index))}>
                  Remove
                </Button>
              </div>
              <Field label="Prompt">
                <Textarea
                  value={skill.prompt}
                  rows={4}
                  maxLength={4000}
                  onChange={(event) => editSkill(index, { prompt: event.target.value })}
                />
              </Field>
            </div>
          ))}
          <div>
            <Button type="button" variant="secondary" onClick={() => setSkills((current) => [...current, { title: "", prompt: "" }])}>
              Add skill
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="length"
        title="Estimate length"
        description="How long a booked estimate takes."
        footer={
          <>
            <SaveStatus {...status} />
            <Button type="button" className="ml-auto" disabled={pending} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        <Select aria-label="Estimate length" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
          {LENGTHS.map((value) => (
            <option key={value} value={value}>
              {value < 60 ? `${value} min` : value === 60 ? "1 hour" : `${value / 60} hours`}
            </option>
          ))}
        </Select>
      </SettingsSection>
    </div>
  );
}

/**
 * The people the AI books: their hours, and their own Google Calendar (busy
 * times come from it). You connect your own calendar here; everyone else
 * connects theirs when signed in.
 */
function Salespeople({
  settings,
  team,
  me,
  myCalendar,
  calendarFailed,
}: {
  settings: WorkflowSettings;
  team: BookingPerson[];
  me: string;
  myCalendar: CalendarConnection;
  calendarFailed: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const [removing, startRemoving] = useTransition();

  // Keeps their hours, in case they're added back.
  function remove(person: BookingPerson) {
    setError("");
    startRemoving(async () => {
      const result = await saveAvailability({ userId: person.id, takesBookings: false, hours: person.hours, maxPerDay: person.maxPerDay });
      if (!result.ok) setError(result.error ?? "Couldn't remove them.");
      else router.refresh();
    });
  }
  const calendars = new Map(settings.people.map((person) => [person.id, person]));
  const selling = team.filter((person) => person.takesBookings);
  const others = team.filter((person) => !person.takesBookings);
  const added = others.find((person) => person.id === adding);

  return (
    <SettingsSection
      id="salespeople"
      title="Salespeople"
      description="The AI only offers times for these people, within their hours, when their Google Calendar shows them free."
    >
      {error ? (
        <p role="alert" className="mb-3 text-[13px] text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
      {calendarFailed ? (
        <p role="alert" className="mb-3 text-[13px] text-[var(--color-bad)]">
          Google Calendar wasn&apos;t connected. Try again.
        </p>
      ) : null}
      <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {selling.map((person) => {
          const calendar = calendars.get(person.id);
          const mine = person.id === me;
          return (
            <li key={person.id}>
              <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[var(--color-heading)]">
                    {person.name}
                    {mine ? <span className="font-normal text-[var(--color-muted)]"> (you)</span> : null}
                  </div>
                  <div className="truncate text-xs text-[var(--color-muted)]">{hoursSummary(person.hours) || "No hours set"}</div>
                </div>
                {calendar?.connected ? (
                  <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span className="truncate">{calendar.calendar}</span>
                    <Tag tone="green">Calendar connected</Tag>
                  </span>
                ) : calendar?.calendarError ? (
                  <Tag tone="red">Calendar needs reconnecting</Tag>
                ) : mine ? (
                  <a href={CONNECT_URL} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                    Connect my calendar
                  </a>
                ) : (
                  <span title="They connect it when they sign in, in Appointment workflows › Settings.">
                    <Tag tone="yellow">No calendar yet</Tag>
                  </span>
                )}
                {editing === person.id ? null : (
                  <span className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(person.id)}>
                      Edit hours
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={removing} onClick={() => remove(person)}>
                      Remove
                    </Button>
                  </span>
                )}
              </div>
              {editing === person.id ? <PersonHours person={person} onDone={() => setEditing(null)} /> : null}
            </li>
          );
        })}
        {!selling.length ? (
          <li className="py-3 text-[13px] text-[var(--color-muted)]">Nobody yet. Add the people who go out to estimates.</li>
        ) : null}
      </ul>

      {added ? (
        <div className="mt-3">
          <p className="mb-2 text-[13px] font-medium text-[var(--color-heading)]">{added.name}</p>
          <PersonHours person={{ ...added, takesBookings: true }} onDone={() => setAdding("")} />
        </div>
      ) : others.length ? (
        <div className="mt-3">
          <Select aria-label="Add salesperson" value="" onChange={(event) => setAdding(event.target.value)}>
            <option value="">Add salesperson…</option>
            {others.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.id === me ? " (you)" : ""}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {myCalendar.connected && !selling.some((person) => person.id === me) ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Your calendar ({myCalendar.googleEmail}) is connected, but you aren&apos;t a salesperson, so it isn&apos;t used.
        </p>
      ) : null}
    </SettingsSection>
  );
}
