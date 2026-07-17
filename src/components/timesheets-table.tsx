"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Select } from "@/components/ui";
import { computeDurations, isStaleActive, wasEdited } from "@/lib/hours";
import { fmtHours, fmtDate, fmtTime, fmtDistance } from "@/lib/format";
import { approveEntry, deleteEntry, unapproveEntry, updateEntry } from "@/lib/actions/time-entries";
import type { EmployeeProfile, Project, TimeEntry } from "@/lib/types";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
  const [approval, setApproval] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const now = Date.now();

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (employee !== "all" && e.user_id !== employee) return false;
      if (project !== "all" && e.companycam_project_id !== project) return false;
      if (status !== "all" && e.status !== status) return false;
      if (approval === "approved" && !e.approved_at) return false;
      if (approval === "pending" && (e.approved_at || e.status !== "complete")) return false;
      if (search) {
        const hay = `${e.user_name ?? ""} ${e.project_name ?? ""}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [entries, employee, project, status, approval, search]);

  const totalHours = useMemo(
    () => filtered.reduce((acc, e) => acc + computeDurations(e, now).totalHours, 0),
    [filtered, now],
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed");
      else setEditing(null);
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
        <Field label="Approval">
          <Select value={approval} onChange={(e) => setApproval(e.target.value)}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
          </Select>
        </Field>
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
                <th className="px-4 py-2.5 font-medium">Approval</th>
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
                      {e.approved_at ? (
                        <Badge tone="good">approved</Badge>
                      ) : e.status === "complete" ? (
                        <Badge tone="warn">pending</Badge>
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(e)} disabled={pending}>
                          Edit
                        </Button>
                        {e.status === "complete" ? (
                          e.approved_at ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => run(() => unapproveEntry(e.id))}
                              disabled={pending}
                            >
                              Unapprove
                            </Button>
                          ) : (
                            <Button
                              variant="subtle"
                              size="sm"
                              onClick={() => run(() => approveEntry(e.id))}
                              disabled={pending}
                            >
                              Approve
                            </Button>
                          )
                        ) : null}
                        {canDelete ? (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              if (confirm("Delete this time entry? This cannot be undone.")) {
                                run(() => deleteEntry(e.id));
                              }
                            }}
                            disabled={pending}
                          >
                            Delete
                          </Button>
                        ) : null}
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
          onClose={() => setEditing(null)}
          onSave={(patch) => run(() => updateEntry(patch))}
        />
      ) : null}
    </Card>
  );
}

function EditDialog({
  entry,
  pending,
  onClose,
  onSave,
}: {
  entry: TimeEntry;
  pending: boolean;
  onClose: () => void;
  onSave: (patch: { id: string; startedAt?: string; endedAt?: string | null; notes?: string | null }) => void;
}) {
  const [startedAt, setStartedAt] = useState(toLocalInput(entry.started_at));
  const [endedAt, setEndedAt] = useState(toLocalInput(entry.ended_at));
  const [notes, setNotes] = useState(entry.notes ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5" >
        <div onClick={(e) => e.stopPropagation()}>
          <h3 className="text-sm font-semibold">Edit time entry</h3>
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            {entry.user_name} · {entry.project_name}
          </p>
          <div className="space-y-3">
            <Field label="Clock in">
              <Input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </Field>
            <Field label="Clock out (leave blank to keep active)">
              <Input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note…" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                onSave({
                  id: entry.id,
                  startedAt: fromLocalInput(startedAt) ?? entry.started_at,
                  endedAt: endedAt ? fromLocalInput(endedAt) : null,
                  notes: notes.trim() || null,
                })
              }
              disabled={pending}
            >
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
