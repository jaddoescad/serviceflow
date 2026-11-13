"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveWorkflowSettings } from "@/lib/actions/workflows";
import type { WorkflowSettings, WorkflowSkill } from "@/lib/workflow-types";
import { SaveStatus, SettingsSection } from "./settings/settings-section";
import { Button, Field, Input, Select, Tag, Textarea } from "./ui";

const LENGTHS = [30, 45, 60, 90, 120];

/** Appointment workflows › Settings: who can be booked, the prompt and skills, the visit length. */
export function WorkflowSettingsForm({ settings }: { settings: WorkflowSettings }) {
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
      <SettingsSection
        id="calendars"
        title="Calendars"
        description="Times are only offered for people who take appointments (Availability above) and have connected their own Google Calendar."
      >
        {settings.people.length ? (
          <ul className="divide-y divide-[var(--color-border)]">
            {settings.people.map((person) => (
              <li key={person.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)]">{person.name}</span>
                {person.connected ? (
                  <>
                    <span className="truncate text-[var(--color-muted)]">{person.calendar}</span>
                    <Tag tone="green">Connected</Tag>
                  </>
                ) : person.calendarError ? (
                  <Tag tone="red">Calendar error</Tag>
                ) : (
                  <Tag tone="yellow">Not connected</Tag>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--color-muted)]">Nobody takes appointments yet. Turn it on in Availability above.</p>
        )}
      </SettingsSection>

      <SettingsSection
        id="prompt"
        title="Prompt"
        description="How the AI should talk and what to know about your company. Out of scope (prices, complaints, existing jobs) always goes to Needs you."
      >
        <Textarea
          aria-label="Prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={10}
          maxLength={8000}
          placeholder="We're Ottawa Painters. Sign texts as Ottawa Painters. Estimates are free and take about an hour…"
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSkills((current) => current.filter((_, at) => at !== index))}
                >
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
