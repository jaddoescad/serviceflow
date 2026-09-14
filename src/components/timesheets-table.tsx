"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Select } from "@/components/ui";
import { computeDurations, isStaleActive, wasEdited } from "@/lib/hours";
import { fmtHours, fmtDate, fmtTime, fmtDistance } from "@/lib/format";
import {
  clockOutEntry,
  deleteEntry,
  updateEntry,
} from "@/lib/actions/time-entries";
import type { EmployeeProfile, Project, TimeEntry } from "@/lib/types";

const OTTAWA_TZ = "America/Toronto";

function ottawaParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: OTTAWA_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = ottawaParts(d);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function fromLocalInput(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = ottawaParts(new Date(guess));
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += targetAsUtc - representedAsUtc;
  }

  const result = new Date(guess);
  if (Number.isNaN(result.getTime())) return null;
  const verified = ottawaParts(result);
  if (
    Number(verified.year) !== year ||
    Number(verified.month) !== month ||
    Number(verified.day) !== day ||
    Number(verified.hour) !== hour ||
    Number(verified.minute) !== minute
  ) {
    return null;
  }
  return result.toISOString();
}

function durationPreview(startedAt: string, endedAt: string): string | null {
  const endIso = fromLocalInput(endedAt);
  if (!endIso) return null;
  const duration = (Date.parse(endIso) - Date.parse(startedAt)) / 3_600_000;
  return duration >= 0 && Number.isFinite(duration) ? fmtHours(duration) : null;
}

function validateRange(startedAt: string, endedAt: string | null): string | null {
  if (!startedAt) return "Choose a valid clock-in time.";
  if (endedAt && Date.parse(endedAt) < Date.parse(startedAt)) {
    return "Clock-out must be after clock-in.";
  }
  if (endedAt && Date.parse(endedAt) > Date.now() + 5 * 60_000) {
    return "Clock-out cannot be more than five minutes in the future.";
  }
  return null;
}

function presetTime(currentValue: string, hour: number): string {
  const fallback = toLocalInput(new Date().toISOString());
  const date = (currentValue || fallback).slice(0, 10);
  return `${date}T${String(hour).padStart(2, "0")}:00`;
}

export function TimesheetsTable({
  entries,
  employees,
  projects,
  canDelete,
}: {
  entries: TimeEntry[];
  employees: EmployeeProfile[];
  projects: Project[];
  canDelete: boolean;
}) {
  const [employee, setEmployee] = useState("all");
  const [project, setProject] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [clockingOut, setClockingOut] = useState<TimeEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const now = Date.now();
  const activeCount = entries.filter((entry) => entry.status === "active").length;

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (employee !== "all" && e.user_id !== employee) return false;
      if (project !== "all" && e.companycam_project_id !== project) return false;
      if (status !== "all" && e.status !== status) return false;
      if (search) {
        const hay = `${e.user_name ?? ""} ${e.project_name ?? ""}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [entries, employee, project, status, search]);

  const totalHours = useMemo(
    () => filtered.reduce((acc, e) => acc + computeDurations(e, now).totalHours, 0),
    [filtered, now],
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed");
      else {
        setEditing(null);
        setClockingOut(null);
        setNotice(successMessage);
      }
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] p-4">
        <Field label="Search">
          <Input
            placeholder="Painter or job…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
        </Field>
        <Field label="Crew">
          <Select value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="all">All crew</option>
            {employees.map((emp) => (
              <option key={emp.user_id} value={emp.user_id}>
                {emp.full_name ?? emp.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Job">
          <Select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All jobs</option>
            {projects.map((p) => (
              <option key={p.companycam_id} value={p.companycam_id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="complete">Complete</option>
          </Select>
        </Field>
        <Button
          type="button"
          variant={status === "active" ? "primary" : "subtle"}
          size="sm"
          onClick={() => setStatus((current) => (current === "active" ? "all" : "active"))}
        >
          {activeCount} on clock
        </Button>
        <div className="ml-auto text-right">
          <div className="text-xs text-[var(--color-muted)]">
            {filtered.length} entries
          </div>
          <div className="text-lg font-semibold tabular-nums">{fmtHours(totalHours)}</div>
        </div>
      </div>

      {error ? (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bad-soft)] px-4 py-2 text-sm text-[var(--color-bad)]">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          className="border-b border-[var(--color-border)] bg-[var(--color-good-soft)] px-4 py-2 text-sm text-[var(--color-good)]"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState>No time entries match these filters.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-4 py-2.5 font-medium">Painter</th>
                <th className="px-4 py-2.5 font-medium">Job</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">In</th>
                <th className="px-4 py-2.5 font-medium">Out</th>
                <th className="px-4 py-2.5 text-right font-medium">Hours</th>
                <th className="px-4 py-2.5 font-medium">Flags</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const dur = computeDurations(e, now);
                const stale = isStaleActive(e, now);
                const edited = wasEdited(e);
                const offSite = (e.last_distance_meters ?? 0) > 250;
                return (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-4 py-2.5 font-medium">{e.user_name ?? "Painter"}</td>
                    <td className="max-w-[200px] truncate px-4 py-2.5 text-[var(--color-muted)]">
                      {e.project_name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-muted)]">
                      {fmtDate(e.started_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">{fmtTime(e.started_at)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {e.status === "active" ? (
                        <Badge tone="good">on clock</Badge>
                      ) : (
                        fmtTime(e.ended_at)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums">
                      {fmtHours(dur.totalHours)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {stale ? <Badge tone="bad">missing out</Badge> : null}
                        {edited ? <Badge tone="warn">edited</Badge> : null}
                        {offSite ? <Badge tone="warn">{fmtDistance(e.last_distance_meters)}</Badge> : null}
                        {!stale && !edited && !offSite ? (
                          <span className="text-xs text-[var(--color-muted)]">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {e.status === "active" ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setError(null);
                              setNotice(null);
                              setClockingOut(e);
                            }}
                            disabled={pending}
                          >
                            Clock out
                          </Button>
                        ) : null}
                        <details className="relative" onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.currentTarget.open = false;
                            event.currentTarget.querySelector("summary")?.focus();
                          }
                        }} onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
                        }}>
                          <summary aria-label={`Time entry actions for ${e.user_name ?? "painter"}`} className="cursor-pointer list-none rounded-lg px-3 py-1.5 text-lg hover:bg-[var(--color-surface)] [&::-webkit-details-marker]:hidden">⋯</summary>
                          <div className="relative z-20 flex min-w-32 flex-col rounded-lg border border-[var(--color-border)] bg-white p-1 shadow-lg">
                            <Button variant="ghost" size="sm" disabled={pending} onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              setError(null);
                              setNotice(null);
                              setEditing(e);
                            }}>Fix time</Button>
                        {canDelete ? (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              if (confirm("Delete this time entry? This cannot be undone.")) {
                                run(() => deleteEntry(e.id), "Time entry deleted.");
                              }
                            }}
                            disabled={pending}
                          >
                            Delete
                          </Button>
                        ) : null}
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <EditDialog
          entry={editing}
          pending={pending}
          actionError={error}
          onClose={() => setEditing(null)}
          onSave={(patch) => run(() => updateEntry(patch), "Time entry updated.")}
        />
      ) : null}
      {clockingOut ? (
        <ClockOutDialog
          entry={clockingOut}
          pending={pending}
          actionError={error}
          onClose={() => setClockingOut(null)}
          onSave={(patch) =>
            run(
              () => clockOutEntry(patch),
              `${clockingOut.user_name ?? "Painter"} clocked out at ${fmtTime(patch.endedAt)}.`,
            )
          }
        />
      ) : null}
    </Card>
  );
}

function ClockOutDialog({
  entry,
  pending,
  actionError,
  onClose,
  onSave,
}: {
  entry: TimeEntry;
  pending: boolean;
  actionError: string | null;
  onClose: () => void;
  onSave: (patch: { id: string; endedAt: string; notes?: string | null }) => void;
}) {
  const [endedAt, setEndedAt] = useState(toLocalInput(new Date().toISOString()));
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const preview = durationPreview(entry.started_at, endedAt);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const endedAtValue = String(form.get("endedAt") ?? "");
    const endedAtIso = fromLocalInput(endedAtValue);
    const error = endedAtIso ? validateRange(entry.started_at, endedAtIso) : "Choose a clock-out time.";
    if (error || !endedAtIso) {
      setFormError(error ?? "Choose a clock-out time.");
      return;
    }
    setFormError(null);
    onSave({
      id: entry.id,
      endedAt: endedAtIso,
      notes: String(form.get("notes") ?? "").trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <form onClick={(event) => event.stopPropagation()} onSubmit={submit}>
          <h3 className="text-base font-semibold">Clock out {entry.user_name ?? "painter"}</h3>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{entry.project_name}</p>

          <div className="my-4 grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-surface-2)] p-3 text-sm">
            <div>
              <div className="text-xs text-[var(--color-muted)]">Clocked in</div>
              <div className="font-medium">{fmtDate(entry.started_at)} · {fmtTime(entry.started_at)}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-muted)]">Shift total</div>
              <div className="font-medium">{preview ?? "Check the time"}</div>
            </div>
          </div>

          <Field label="Clock-out time (Ottawa)">
            <Input
              name="endedAt"
              type="datetime-local"
              value={endedAt}
              onChange={(event) => setEndedAt(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="subtle" size="sm" onClick={() => setEndedAt(toLocalInput(new Date().toISOString()))}>
              Now
            </Button>
            <Button type="button" variant="subtle" size="sm" onClick={() => setEndedAt(presetTime(endedAt, 17))}>
              5:00 PM
            </Button>
            <Button type="button" variant="subtle" size="sm" onClick={() => setEndedAt(presetTime(endedAt, 18))}>
              6:00 PM
            </Button>
          </div>

          <div className="mt-4">
            <Field label="Notes (optional)">
              <Input name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason or correction note…" />
            </Field>
          </div>

          {formError || actionError ? (
            <p className="mt-3 text-sm text-[var(--color-bad)]">{formError ?? actionError}</p>
          ) : null}
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            This ends the active shift and leaves it pending payroll approval.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !preview}>
              {pending ? "Clocking out…" : "Clock out"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function EditDialog({
  entry,
  pending,
  actionError,
  onClose,
  onSave,
}: {
  entry: TimeEntry;
  pending: boolean;
  actionError: string | null;
  onClose: () => void;
  onSave: (patch: { id: string; startedAt?: string; endedAt?: string | null; notes?: string | null }) => void;
}) {
  const [startedAt, setStartedAt] = useState(toLocalInput(entry.started_at));
  const [endedAt, setEndedAt] = useState(toLocalInput(entry.ended_at));
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const previewStart = fromLocalInput(startedAt);
  const preview = previewStart && endedAt ? durationPreview(previewStart, endedAt) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startedAtValue = String(form.get("startedAt") ?? "");
    const endedAtValue = String(form.get("endedAt") ?? "");
    const startedAtIso = fromLocalInput(startedAtValue);
    const endedAtIso = endedAtValue ? fromLocalInput(endedAtValue) : null;
    const error = startedAtIso ? validateRange(startedAtIso, endedAtIso) : "Choose a valid clock-in time.";
    if (error || !startedAtIso) {
      setFormError(error ?? "Choose valid times.");
      return;
    }
    setFormError(null);
    onSave({
      id: entry.id,
      startedAt: startedAtIso,
      endedAt: endedAtIso,
      notes: String(form.get("notes") ?? "").trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <form onClick={(event) => event.stopPropagation()} onSubmit={submit}>
          <h3 className="text-base font-semibold">Fix time</h3>
          <p className="mb-4 mt-0.5 text-xs text-[var(--color-muted)]">
            {entry.user_name} · {entry.project_name}
          </p>
          <div className="space-y-3">
            <Field label="Clock-in time (Ottawa)">
              <Input name="startedAt" type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} required />
            </Field>
            <Field label="Clock-out time (Ottawa)">
              <Input name="endedAt" type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
            </Field>
            {entry.status === "active" ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="subtle" size="sm" onClick={() => setEndedAt(toLocalInput(new Date().toISOString()))}>
                  Clock out now
                </Button>
                <Button type="button" variant="subtle" size="sm" onClick={() => setEndedAt(presetTime(endedAt, 18))}>
                  Set 6:00 PM
                </Button>
              </div>
            ) : null}
            <Field label="Notes">
              <Input name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason for the correction…" />
            </Field>
          </div>

          <div className="mt-4 rounded-lg bg-[var(--color-surface-2)] p-3 text-sm">
            {endedAt ? (
              <span>Corrected shift total: <strong>{preview ?? "Check the time range"}</strong></span>
            ) : (
              <span>{entry.status === "complete" ? "Clearing clock-out will reopen this shift." : "This shift will remain active."}</span>
            )}
          </div>
          {formError || actionError ? (
            <p className="mt-3 text-sm text-[var(--color-bad)]">{formError ?? actionError}</p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || (Boolean(endedAt) && !preview)}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
