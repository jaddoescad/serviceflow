"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { fmtDate, fmtHours, fmtTime } from "@/lib/format";
import { addProjectTask, removeProjectTask, updateProjectTask } from "@/lib/actions/tasks";
import type { ProjectTaskProgress } from "@/lib/metrics";

type DialogState = { mode: "add" } | { mode: "edit"; task: ProjectTaskProgress } | null;

export function ProjectTasksPanel({
  projectId,
  projectName,
  taskProgress,
  canManage,
}: {
  projectId: string;
  projectName: string;
  taskProgress: ProjectTaskProgress[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const totalBudgeted = taskProgress.reduce((sum, task) => sum + task.budgetedHours, 0);
  const totalSpent = taskProgress.reduce((sum, task) => sum + task.spentHours, 0);
  const calculatorHref = `/projects/${encodeURIComponent(projectId)}/calculator?name=${encodeURIComponent(projectName)}`;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed");
      else {
        done?.();
        router.refresh();
      }
    });
  }

  function handleRemove(task: ProjectTaskProgress) {
    if (!window.confirm(`Remove “${task.title}”? Time already tracked on it is kept in history.`)) return;
    setRemovingId(task.id);
    run(
      () => removeProjectTask({ projectId, taskId: task.id }),
      () => setRemovingId(null),
    );
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-[var(--color-heading)]">Painter tasks</h3>
            <p className="text-xs text-[var(--color-muted)]">
              {taskProgress.length > 0
                ? `${taskProgress.filter((task) => task.status === "completed").length} of ${taskProgress.length} done · ${fmtHours(totalBudgeted)} budgeted`
                : "What painters check off on site"}
            </p>
          </div>
          {canManage ? (
            <div className="flex items-center gap-2">
              <Link
                href={calculatorHref}
                className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                Transfer from calculator
              </Link>
              <Button size="sm" onClick={() => setDialog({ mode: "add" })} disabled={pending}>
                + Add task
              </Button>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-bad-soft)] px-5 py-2 text-sm text-[var(--color-bad)]">
            {error}
          </div>
        ) : null}

        {taskProgress.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--color-muted)]">
            <p>No tasks yet.</p>
            {canManage ? (
              <p className="mt-1">
                Add one above, or build the job in the{" "}
                <Link href={calculatorHref} className="font-medium text-[var(--color-brand-strong)] hover:underline">
                  calculator
                </Link>{" "}
                and transfer it to tasks.
              </p>
            ) : null}
          </div>
        ) : (
          <div>
            {taskProgress.map((task, index) => {
              const over = task.budgetedHours > 0 && task.spentHours > task.budgetedHours;
              const percent = task.budgetedHours > 0 ? Math.min(100, (task.spentHours / task.budgetedHours) * 100) : 0;
              const contributors = task.contributors.filter(
                (contributor) => contributor.active || contributor.hours >= 1 / 60,
              );
              const onTaskNow = task.contributors.some((contributor) => contributor.active);
              const removing = removingId === task.id && pending;
              const completed = task.status === "completed";
              return (
                <div key={task.id} className={`px-5 py-3 ${index > 0 ? "border-t border-[var(--color-border)]" : ""}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                        style={
                          completed
                            ? { background: "var(--color-good)" }
                            : { boxShadow: "inset 0 0 0 2px var(--color-border)" }
                        }
                      >
                        {completed ? (
                          <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                            <path d="M5 10.5l3.2 3.2L15 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span
                        className={`truncate text-sm font-medium ${completed ? "text-[var(--color-muted)] line-through" : ""}`}
                      >
                        {task.title}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums">
                        <span className={`font-semibold ${over ? "text-[var(--color-bad)]" : "text-[var(--color-heading)]"}`}>
                          {fmtHours(task.spentHours)}
                        </span>
                        {task.budgetedHours > 0 ? (
                          <span className="text-[var(--color-muted)]"> / {fmtHours(task.budgetedHours)}</span>
                        ) : null}
                      </span>
                      {canManage ? (
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => setDialog({ mode: "edit", task })}
                            disabled={pending}
                            aria-label={`Edit ${task.title}`}
                            title="Edit task"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                              <path
                                d="M13.75 3.75a1.768 1.768 0 0 1 2.5 2.5l-8.5 8.5-3.25.75.75-3.25 8.5-8.5Z"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemove(task)}
                            disabled={pending}
                            aria-label={`Remove ${task.title}`}
                            title="Remove task"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-bad-soft)] hover:text-[var(--color-bad)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {removing ? (
                              <span className="text-[10px]">…</span>
                            ) : (
                              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                                <path
                                  d="M4.5 5.5h11M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M6.5 5.5l.5 10a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-10"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {completed && task.completedAt ? (
                    <div className="mt-0.5 pl-[30px] text-[11px] font-medium text-[var(--color-good)]">
                      Done {fmtDate(task.completedAt)} · {fmtTime(task.completedAt)}
                      {task.completedByName ? ` · ${task.completedByName}` : ""}
                    </div>
                  ) : null}
                  {task.notes ? (
                    <div className="mt-0.5 truncate pl-[30px] text-[11px] text-[var(--color-muted)]" title={task.notes}>
                      {task.notes}
                    </div>
                  ) : null}
                  {task.budgetedHours > 0 ? (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${percent}%`, background: over ? "var(--color-bad)" : "var(--color-brand)" }}
                      />
                    </div>
                  ) : null}
                  {contributors.length > 0 || onTaskNow ? (
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
                      <span className="truncate">
                        {contributors
                          .map((contributor) => `${contributor.name} ${fmtHours(contributor.hours)}`)
                          .join(" · ")}
                      </span>
                      {onTaskNow ? (
                        <span className="shrink-0 font-medium text-[var(--color-good)]">● on task now</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {dialog ? (
        <TaskDialog
          key={dialog.mode === "edit" ? dialog.task.id : "add"}
          initial={dialog.mode === "edit" ? dialog.task : null}
          pending={pending}
          onClose={() => setDialog(null)}
          onSave={(values) =>
            run(
              () =>
                dialog.mode === "edit"
                  ? updateProjectTask({ projectId, taskId: dialog.task.id, ...values })
                  : addProjectTask({ projectId, ...values }),
              () => setDialog(null),
            )
          }
        />
      ) : null}
    </>
  );
}

function TaskDialog({
  initial,
  pending,
  onClose,
  onSave,
}: {
  initial: ProjectTaskProgress | null;
  pending: boolean;
  onClose: () => void;
  onSave: (values: { title: string; notes: string | null; budgetedHours: number | null }) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [hours, setHours] = useState(
    initial && initial.budgetedHours > 0 ? String(initial.budgetedHours) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const numericHours = hours.trim() === "" ? null : Number(hours);
  const valid = title.trim().length > 0 && (numericHours == null || (Number.isFinite(numericHours) && numericHours >= 0));

  function submit() {
    if (!valid) return;
    onSave({ title: title.trim(), notes: notes.trim() || null, budgetedHours: numericHours });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <div onClick={(e) => e.stopPropagation()}>
          <h3 className="text-sm font-semibold">{initial ? "Edit task" : "Add task"}</h3>
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            Painters see the title and notes in their task list. Budgeted hours set the bar they track against.
          </p>
          <div className="space-y-3">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Prime garage walls"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </Field>
            <Field label="Budgeted hours (optional)">
              <Input
                type="number"
                min="0"
                step="0.25"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="e.g. 3.5"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </Field>
            <Field label="Notes (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope details for the crew" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button disabled={pending || !valid} onClick={submit}>
              {pending ? "Saving…" : initial ? "Save task" : "Add task"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
