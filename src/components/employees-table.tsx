"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { fmtHours, fmtMoney, fmtDate, initials } from "@/lib/format";
import { useRouter } from "next/navigation";
import { getPayRateHistory, createEmployee, setActive, setPayRate, setRole } from "@/lib/actions/employees";
import type { Role } from "@/lib/types";

export type CrewRow = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  loggedHours: number;
  lastActivity: string | null;
  assignedCount: number;
  currentPayRate: number | null;
};

export function EmployeesTable({
  rows,
  canManage,
  canManageRates,
}: {
  rows: CrewRow[];
  canManage: boolean;
  canManageRates: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showActive, setShowActive] = useState("all");
  const [creating, setCreating] = useState(false);
  const [rateFor, setRateFor] = useState<CrewRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (showActive === "active" && !r.isActive) return false;
        if (showActive === "inactive" && r.isActive) return false;
        if (search && !`${r.name} ${r.email ?? ""}`.toLowerCase().includes(search.toLowerCase()))
          return false;
        return true;
      }),
    [rows, search, showActive],
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed");
      else { done?.(); router.refresh(); }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Crew"
        subtitle={`${rows.filter((r) => r.isActive).length} active · ${rows.length} total`}
        right={
          canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              + Add crew member
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] p-4">
        <Field label="Search">
          <Input
            placeholder="Name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </Field>
        <Field label="Status">
          <Select value={showActive} onChange={(e) => setShowActive(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      </div>

      {error ? (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bad-soft)] px-4 py-2 text-sm text-[var(--color-bad)]">
          {error}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState>No crew members match.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Pay rate</th>
                <th className="px-4 py-2.5 text-right font-medium">Hours (30d)</th>
                <th className="px-4 py-2.5 text-right font-medium">Jobs</th>
                <th className="px-4 py-2.5 font-medium">Last active</th>
                {canManage || canManageRates ? <th className="px-4 py-2.5 text-right font-medium">Manage</th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.userId}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar label={initials(r.name)} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.name}</div>
                        <div className="truncate text-xs text-[var(--color-muted)]">{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={r.role === "admin" ? "brand" : r.role === "manager" ? "good" : "neutral"}>
                      {r.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={r.isActive ? "good" : "bad"}>{r.isActive ? "active" : "inactive"}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    {r.currentPayRate != null ? `${fmtMoney(r.currentPayRate)}/h` : <Badge tone="warn">not set</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmtHours(r.loggedHours)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.assignedCount}</td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">{fmtDate(r.lastActivity)}</td>
                  {canManage || canManageRates ? (
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        {canManageRates ? (
                          <Button variant="subtle" size="sm" disabled={pending} onClick={() => setRateFor(r)}>
                            Pay rate
                          </Button>
                        ) : null}
                        {canManage ? (
                          <>
                            <Select
                              value={r.role}
                              disabled={pending}
                              onChange={(e) => run(() => setRole(r.userId, e.target.value as Role))}
                              className="py-1 text-xs"
                            >
                              <option value="painter">painter</option>
                              <option value="manager">manager</option>
                              <option value="admin">admin</option>
                            </Select>
                            <Button
                              variant={r.isActive ? "danger" : "subtle"}
                              size="sm"
                              disabled={pending}
                              onClick={() => run(() => setActive(r.userId, !r.isActive))}
                            >
                              {r.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <CreateDialog
          pending={pending}
          onClose={() => setCreating(false)}
          onCreate={(input, done) =>
            startTransition(async () => {
              setError(null);
              const res = await createEmployee(input);
              if (!res.ok) setError(res.error ?? "Could not create employee");
              else done(res.temporaryPassword ?? null);
            })
          }
        />
      ) : null}

      {rateFor ? (
        <PayRateDialog
          employee={rateFor}
          pending={pending}
          onClose={() => setRateFor(null)}
          onSave={(input) => run(() => setPayRate(input), () => setRateFor(null))}
        />
      ) : null}
    </Card>
  );
}

function PayRateDialog({
  employee,
  pending,
  onClose,
  onSave,
}: {
  employee: CrewRow;
  pending: boolean;
  onClose: () => void;
  onSave: (input: { userId: string; hourlyRate: number; effectiveFrom: string; notes?: string | null }) => void;
}) {
  const now = new Date();
  const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const [rate, setRate] = useState(employee.currentPayRate?.toString() ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(localToday);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getPayRateHistory>> | null>(null);
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPayRateHistory(employee.userId).then(rows => { if (!cancelled) setHistory(rows); }).catch(() => { if (!cancelled) setHistoryError(true); });
    return () => { cancelled = true; };
  }, [employee.userId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-5">
        <div role="dialog" aria-modal="true" aria-labelledby="pay-rate-title" onClick={(e) => e.stopPropagation()}>
          <h3 id="pay-rate-title" className="font-display text-sm font-semibold">Pay rate · {employee.name}</h3>
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            Add a new effective date for raises. Older time entries keep their historical rate.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hourly rate (CAD)">
              <Input type="number" min="0.01" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 30.00" />
            </Field>
            <Field label="Effective from">
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Note (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Annual raise" />
            </Field>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-xs font-medium text-[var(--color-muted)]">Rate history</div>
            {historyError ? <div role="alert" className="text-sm text-[var(--color-bad)]">Rate history could not load. Reopen to retry.</div> : history === null ? <div role="status" className="text-xs text-[var(--color-muted)]">Loading…</div> : history.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-xs text-[var(--color-muted)]">
                No rate history yet.
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                {history.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2.5 last:border-0">
                    <div>
                      <div className="text-sm font-medium tabular-nums">{fmtMoney(Number(item.hourly_rate))}/hour</div>
                      <div className="text-[11px] text-[var(--color-muted)]">Effective {fmtDate(`${item.effective_from}T12:00:00`)}</div>
                    </div>
                    {item.effective_from > localToday ? <Badge tone="brand">upcoming</Badge> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button
              disabled={pending || !rate || !effectiveFrom || Number(rate) <= 0}
              onClick={() => onSave({
                userId: employee.userId,
                hourlyRate: Number(rate),
                effectiveFrom,
                notes: notes.trim() || null,
              })}
            >
              {pending ? "Saving…" : "Save rate"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function CreateDialog({
  pending,
  onClose,
  onCreate,
}: {
  pending: boolean;
  onClose: () => void;
  onCreate: (
    input: { email: string; fullName: string; password?: string; role?: Role },
    done: (tempPassword: string | null) => void,
  ) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRoleValue] = useState<Role>("painter");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <div onClick={(e) => e.stopPropagation()}>
          {created ? (
            <>
              <h3 className="text-sm font-semibold">Crew member created</h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                {fullName} can now sign in to the mobile app.
              </p>
              {tempPassword ? (
                <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <div className="text-xs text-[var(--color-muted)]">Temporary password</div>
                  <div className="mt-1 font-mono text-sm">{tempPassword}</div>
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    Share this securely — it won&apos;t be shown again.
                  </p>
                </div>
              ) : null}
              <div className="mt-5 flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-sm font-semibold">Add crew member</h3>
              <p className="mb-4 text-xs text-[var(--color-muted)]">
                Creates a login and profile. Leave the password blank to auto-generate one.
              </p>
              <div className="space-y-3">
                <Field label="Full name">
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Painter name" />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="painter@example.com"
                  />
                </Field>
                <Field label="Password (optional)">
                  <Input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Auto-generate if blank"
                  />
                </Field>
                <Field label="Role">
                  <Select value={role} onChange={(e) => setRoleValue(e.target.value as Role)} className="w-full">
                    <option value="painter">painter</option>
                    <option value="manager">manager</option>
                    <option value="admin">admin</option>
                  </Select>
                </Field>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  disabled={pending || !email || !fullName}
                  onClick={() =>
                    onCreate({ email, fullName, password: password || undefined, role }, (tp) => {
                      setTempPassword(tp);
                      setCreated(true);
                    })
                  }
                >
                  {pending ? "Creating…" : "Create"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
