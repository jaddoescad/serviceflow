"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCrew, saveCrew, type Crew, type CrewSettings } from "@/lib/actions/crews";
import type { CrewColor } from "@/lib/crm-types";
import { ModalFooter, ProjectModal } from "@/components/project-profile-panel";
import { Button, Field, Input, Select, TAG_DOT, cn } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const COLORS: CrewColor[] = ["blue", "green", "orange", "purple", "yellow", "red"];

type Draft = Crew & { isNew: boolean };

function CrewDialog({
  draft,
  team,
  onClose,
  onSaved,
}: {
  draft: Draft;
  team: CrewSettings["team"];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(draft.name);
  const [color, setColor] = useState<CrewColor>(draft.color);
  // People who have left the team drop off when the crew is saved.
  const onTeam = (id: string | null) => !!id && team.some((person) => person.id === id);
  const [members, setMembers] = useState<string[]>(draft.memberIds.filter(onTeam));
  const [leadId, setLeadId] = useState(onTeam(draft.leadId) ? draft.leadId! : "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const chosen = team.filter((person) => members.includes(person.id));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    startTransition(async () => {
      setError("");
      const result = await action();
      if (!result.ok) setError(result.error ?? "Could not save the crew.");
      else {
        router.refresh();
        onSaved(message);
      }
    });
  }

  return (
    <ProjectModal title={draft.isNew ? "New crew" : `Edit ${draft.name}`} onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => saveCrew({ id: draft.id, name, color, leadId: leadId || null, memberIds: members }),
            draft.isNew ? "Crew added." : "Crew saved.",
          );
        }}
      >
        <div className="space-y-4 p-5">
          <Field label="Name">
            <Input required maxLength={60} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Colour</span>
            <div role="radiogroup" aria-label="Colour" className="flex gap-1.5">
              {COLORS.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  role="radio"
                  aria-checked={color === tone}
                  aria-label={tone}
                  onClick={() => setColor(tone)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full outline-none focus-visible:shadow-[var(--focus-ring)]",
                    color === tone && "ring-2 ring-[var(--color-border-strong)]",
                  )}
                >
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: TAG_DOT[tone] }} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">People</span>
            {team.length ? (
              <ul className="max-h-56 divide-y divide-[var(--color-border)] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border)]">
                {team.map((person) => (
                  <li key={person.id}>
                    <label className="flex h-9 items-center gap-2 px-2.5 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-hover)]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-brand)]"
                        checked={members.includes(person.id)}
                        onChange={(event) => {
                          setMembers((current) =>
                            event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id),
                          );
                          if (!event.target.checked && leadId === person.id) setLeadId("");
                        }}
                      />
                      {person.name}
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-[var(--color-muted)]">Add people to your team first.</p>
            )}
          </div>
          {chosen.length ? (
            <Field label="Lead painter">
              <Select value={leadId} onChange={(event) => setLeadId(event.target.value)} className="w-full">
                <option value="">None</option>
                {chosen.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {error ? <p role="alert" className="text-[13px] text-[var(--color-bad)]">{error}</p> : null}
        </div>
        <ModalFooter>
          {!draft.isNew ? (
            <Button
              type="button"
              variant="danger"
              className="mr-auto"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete ${draft.name}? Its people stay on the jobs they're assigned to.`)) {
                  run(() => deleteCrew(draft.id), "Crew deleted.");
                }
              }}
            >
              Delete
            </Button>
          ) : null}
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </ModalFooter>
      </form>
    </ProjectModal>
  );
}

/** Settings › Crews: named crews the job schedule assigns and colours jobs by. */
export function CrewsSettings({ settings }: { settings: CrewSettings }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const names = new Map(settings.team.map((person) => [person.id, person.name]));
  const unused = COLORS.find((tone) => !settings.crews.some((crew) => crew.color === tone)) ?? COLORS[0];

  return (
    <SettingsSection
      id="crews"
      title="Crews"
      description="Give a job a crew on the schedule and its people are assigned to it."
      footer={
        <>
          <SaveStatus message={message} />
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => {
              setMessage("");
              setDraft({ id: crypto.randomUUID(), name: "", color: unused, leadId: null, memberIds: [], isNew: true });
            }}
          >
            New crew
          </Button>
        </>
      }
    >
      {settings.crews.length ? (
        <ul className="-my-2 divide-y divide-[var(--color-border)]">
          {settings.crews.map((crew) => (
            <li key={crew.id}>
              <button
                type="button"
                onClick={() => {
                  setMessage("");
                  setDraft({ ...crew, isNew: false });
                }}
                className="flex min-h-10 w-full items-center gap-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--color-hover)]"
              >
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TAG_DOT[crew.color] }} />
                <span className="shrink-0 font-medium text-[var(--color-heading)]">{crew.name}</span>
                <span className="min-w-0 truncate text-[var(--color-muted)]">
                  {crew.memberIds
                    .map((id) => `${names.get(id) ?? "Former member"}${id === crew.leadId ? " (lead)" : ""}`)
                    .join(", ") || "No people"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--color-muted)]">No crews yet.</p>
      )}
      {draft ? (
        <CrewDialog
          draft={draft}
          team={settings.team}
          onClose={() => setDraft(null)}
          onSaved={(text) => {
            setDraft(null);
            setMessage(text);
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
