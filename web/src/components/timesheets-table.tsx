"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TimesheetFilters } from "@/lib/queries";
import { DataTable, TablePanel, TableToolbar, Td, Th, Tr } from "@/components/table-ui";
import { Badge, Button, EmptyState, Field, Input, Select } from "@/components/ui";
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
  canDelete, result, filters, currentPage,
}: {
  entries: TimeEntry[];
  employees: Pick<EmployeeProfile, "user_id" | "full_name" | "email">[];
  projects: Pick<Project, "companycam_id" | "name">[];
  canDelete: boolean;
  result: { total: number; totalHours: number; activeCount: number; calculatedAt: string };
  filters: TimesheetFilters;
  currentPage: number;
}) {
  const [employee, setEmployee] = useState(filters.employee);
  const [project, setProject] = useState(filters.project);
  const [status, setStatus] = useState(filters.status);
  const [search, setSearch] = useState(filters.search);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [clockingOut, setClockingOut] = useState<TimeEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const now = Date.parse(result.calculatedAt);
  const { activeCount } = result;
  const previousFilters = useRef(filters);
  useEffect(() => {
    const old = previousFilters.current;
    previousFilters.current = filters;
    setEmployee(value => value === old.employee ? filters.employee : value);
    setProject(value => value === old.project ? filters.project : value);
    setStatus(value => value === old.status ? filters.status : value);
    setSearch(value => value === old.search ? filters.search : value);
  }, [filters]);
  function navigate(page: number, next: TimesheetFilters) {
    const params = new URLSearchParams();
    if (next.search) params.set("q", next.search);
    for (const key of ["employee", "project", "status"] as const) if (next[key] !== "all") params.set(key, next[key]);
    if (page > 1) params.set("page", String(page));
    startTransition(() => router.replace(`/timesheets${params.size ? `?${params}` : ""}`, { scroll: false }));
  }
  useEffect(() => {
    if (search === filters.search && employee === filters.employee && project === filters.project && status === filters.status) return;
    const timer = setTimeout(() => navigate(1, { search, employee, project, status }), 300);
    return () => clearTimeout(timer);
  }, [search, employee, project, status, filters]);
  const totalPages = Math.max(1, Math.ceil(result.total / 50));

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
        router.refresh();
      }
    });
  }

  return (
    <>
      <TableToolbar>
        <div className="w-full sm:w-52">
          <Input
            type="search"
            aria-label="Search painter or job"
            placeholder="Painter or job…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select aria-label="Crew" value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="all">All crew</option>
          {employees.map((emp) => (
            <option key={emp.user_id} value={emp.user_id}>
              {emp.full_name ?? emp.email}
            </option>
          ))}
        </Select>
        <Select aria-label="Job" value={project} onChange={(e) => setProject(e.target.value)} className="max-w-56">
          <option value="all">All jobs</option>
          {projects.map((p) => (
            <option key={p.companycam_id} value={p.companycam_id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="complete">Complete</option>
        </Select>
        <Button
          type="button"
          variant={status === "active" ? "primary" : "secondary"}
          aria-pressed={status === "active"}
          onClick={() => setStatus((current) => (current === "active" ? "all" : "active"))}
        >
          {activeCount} on clock
        </Button>
      </TableToolbar>

      {error ? (
        <div role="alert" className="shrink-0 border-b border-[var(--color-border)] bg-[var(--tag-red-bg)] px-[var(--gutter)] py-2 text-[13px] text-[var(--tag-red-text)]">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          className="shrink-0 border-b border-[var(--color-border)] bg-[var(--tag-green-bg)] px-[var(--gutter)] py-2 text-[13px] text-[var(--tag-green-text)]"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <TablePanel
        fill
        busy={pending}
        footer={
          result.total > 0 ? (
            <>
              <span className="tabular-nums">
                {(currentPage - 1) * 50 + 1}–{Math.min(currentPage * 50, result.total)} of {result.total}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={pending || currentPage <= 1} onClick={() => navigate(currentPage - 1, filters)}>Previous</Button>
                <span className="tabular-nums">Page {currentPage} of {totalPages}</span>
                <Button size="sm" variant="secondary" disabled={pending || currentPage >= totalPages} onClick={() => navigate(currentPage + 1, filters)}>Next</Button>
              </div>
            </>
          ) : null
        }
      >
        <DataTable minWidth={820}>
          <thead>
            <tr>
              <Th>Painter</Th>
              <Th>Job</Th>
              <Th>Date</Th>
              <Th>In</Th>
              <Th>Out</Th>
              <Th numeric>Hours</Th>
              <Th>Flags</Th>
              <Th numeric>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const dur = computeDurations(e, now);
              const stale = isStaleActive(e, now);
              const edited = wasEdited(e);
              const offSite = (e.last_distance_meters ?? 0) > 250;
              return (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap">{e.user_name ?? "Painter"}</Td>
                  <Td muted className="max-w-[220px] truncate">
                    {e.project_name}
                  </Td>
                  <Td muted className="whitespace-nowrap">
                    {fmtDate(e.started_at)}
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{fmtTime(e.started_at)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {e.status === "active" ? <Badge tone="good">On clock</Badge> : fmtTime(e.ended_at)}
                  </Td>
                  <Td numeric className="font-medium text-[var(--color-heading)]">
                    {fmtHours(dur.totalHours)}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {stale ? <Badge tone="bad">Missing out</Badge> : null}
                      {edited ? <Badge tone="warn">Edited</Badge> : null}
                      {offSite ? <Badge tone="orange">{fmtDistance(e.last_distance_meters)}</Badge> : null}
                      {!stale && !edited && !offSite ? (
                        <span className="text-[var(--color-faint)]">—</span>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      {e.status === "active" ? (
                        <Button
                          size="sm"
                          variant="secondary"
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
                        <summary aria-label={`Time entry actions for ${e.user_name ?? "painter"}`} className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-base text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] [&::-webkit-details-marker]:hidden">⋯</summary>
                        <div className="absolute right-0 top-full z-20 mt-1 flex min-w-36 flex-col rounded-[var(--radius)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-pop)]">
                          <Button variant="ghost" size="sm" className="justify-start text-[var(--color-text)]" disabled={pending} onClick={(event) => {
                            event.currentTarget.closest("details")?.removeAttribute("open");
                            setError(null);
                            setNotice(null);
                            setEditing(e);
                          }}>Fix time</Button>
                          {canDelete ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-start text-[var(--color-bad)]"
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
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
        {entries.length ? null : <EmptyState>No time entries match these filters.</EmptyState>}
      </TablePanel>
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
    </>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]">
        <form onClick={(event) => event.stopPropagation()} onSubmit={submit}>
          <div className="border-b border-[var(--color-border)] px-5 py-3.5">
            <h3 className="text-[15px] font-semibold text-[var(--color-heading)]">Clock out {entry.user_name ?? "painter"}</h3>
            <p className="text-xs text-[var(--color-muted)]">{entry.project_name}</p>
          </div>
          <div className="p-5">
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-[var(--radius)] bg-[var(--color-surface-2)] p-3 text-[13px]">
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
            <Button type="button" variant="secondary" size="sm" onClick={() => setEndedAt(toLocalInput(new Date().toISOString()))}>
              Now
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setEndedAt(presetTime(endedAt, 17))}>
              5:00 PM
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setEndedAt(presetTime(endedAt, 18))}>
              6:00 PM
            </Button>
          </div>

          <div className="mt-4">
            <Field label="Notes (optional)">
              <Input name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason or correction note…" />
            </Field>
          </div>

          {formError || actionError ? (
            <p className="mt-3 text-[13px] text-[var(--color-bad)]">{formError ?? actionError}</p>
          ) : null}
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            This ends the active shift and leaves it pending payroll approval.
          </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !preview}>
              {pending ? "Clocking out…" : "Clock out"}
            </Button>
          </div>
        </form>
      </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]">
        <form onClick={(event) => event.stopPropagation()} onSubmit={submit}>
          <div className="border-b border-[var(--color-border)] px-5 py-3.5">
            <h3 className="text-[15px] font-semibold text-[var(--color-heading)]">Fix time</h3>
            <p className="text-xs text-[var(--color-muted)]">
              {entry.user_name} · {entry.project_name}
            </p>
          </div>
          <div className="p-5">
          <div className="space-y-3">
            <Field label="Clock-in time (Ottawa)">
              <Input name="startedAt" type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} required />
            </Field>
            <Field label="Clock-out time (Ottawa)">
              <Input name="endedAt" type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
            </Field>
            {entry.status === "active" ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setEndedAt(toLocalInput(new Date().toISOString()))}>
                  Clock out now
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setEndedAt(presetTime(endedAt, 18))}>
                  Set 6:00 PM
                </Button>
              </div>
            ) : null}
            <Field label="Notes">
              <Input name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason for the correction…" />
            </Field>
          </div>

          <div className="mt-4 rounded-[var(--radius)] bg-[var(--color-surface-2)] p-3 text-[13px]">
            {endedAt ? (
              <span>Corrected shift total: <strong>{preview ?? "Check the time range"}</strong></span>
            ) : (
              <span>{entry.status === "complete" ? "Clearing clock-out will reopen this shift." : "This shift will remain active."}</span>
            )}
          </div>
          {formError || actionError ? (
            <p className="mt-3 text-[13px] text-[var(--color-bad)]">{formError ?? actionError}</p>
          ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || (Boolean(endedAt) && !preview)}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
