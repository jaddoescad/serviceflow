"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTaskTemplate, saveTaskTemplate, type TaskTemplate } from "@/lib/actions/task-templates";
import { Button, Card, Field, Input } from "@/components/ui";
import { SettingsSection } from "./settings-section";

type Draft = { id: string | null; name: string; tasks: { key: number; title: string; notes: string }[] };

let nextKey = 0;
const row = (title = "", notes = "") => ({ key: nextKey++, title, notes });

/** Settings › Templates: lists of tasks a manager adds to a job from its Tasks tab. */
export function TaskTemplates({ templates }: { templates: TaskTemplate[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <SettingsSection
      id="task-templates"
      title="Task templates"
      description="Add one to a job from its Tasks tab to copy in its tasks."
      footer={
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => setDraft({ id: null, name: "", tasks: [row()] })}
        >
          New template
        </Button>
      }
    >
      {templates.length ? (
        <ul className="-my-2 divide-y divide-[var(--color-border)]">
          {templates.map((template) => (
            <li key={template.id} className="flex min-h-10 items-center gap-3 py-1.5 text-[13px]">
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    id: template.id,
                    name: template.name,
                    tasks: template.tasks.map((task) => row(task.title, task.notes ?? "")),
                  })
                }
                className="min-w-0 flex-1 truncate text-left font-medium text-[var(--color-heading)] hover:underline"
              >
                {template.name}
              </button>
              <span className="shrink-0 text-xs text-[var(--color-muted)]">
                {template.tasks.length} {template.tasks.length === 1 ? "task" : "tasks"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--color-muted)]">No task templates yet.</p>
      )}
      {draft ? <TemplateEditor key={draft.id ?? "new"} initial={draft} onClose={() => setDraft(null)} /> : null}
    </SettingsSection>
  );
}

function TemplateEditor({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [tasks, setTasks] = useState(initial.tasks);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const filled = tasks.filter((task) => task.title.trim());
  const valid = name.trim().length > 0 && filled.length > 0;

  function update(key: number, change: Partial<{ title: string; notes: string }>) {
    setTasks((list) => list.map((task) => (task.key === key ? { ...task, ...change } : task)));
  }

  function move(index: number, by: -1 | 1) {
    setTasks((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved);
      return next;
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else {
        onClose();
        router.refresh();
      }
    });
  }

  function save() {
    if (!valid) return;
    run(() =>
      saveTaskTemplate({
        id: initial.id,
        name,
        tasks: filled.map((task) => ({ title: task.title, notes: task.notes || null })),
      }),
    );
  }

  function remove() {
    if (!initial.id || !window.confirm(`Delete “${initial.name}”? Jobs it was added to keep their tasks.`)) return;
    const id = initial.id;
    run(() => deleteTaskTemplate(id));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="flex max-h-[90vh] w-full max-w-lg flex-col">
        <div className="flex min-h-0 flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-5 pt-5">
            <h3 className="text-sm font-semibold">{initial.id ? "Edit task template" : "New task template"}</h3>
            <div className="mt-4">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Job close-out" autoFocus />
              </Field>
            </div>
            <div className="mb-1 mt-4 text-xs font-medium text-[var(--color-muted)]">Tasks</div>
          </div>
          <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-1">
            {tasks.map((task, index) => (
              <li key={task.key} className="flex items-start gap-2">
                <span className="w-5 shrink-0 pt-1.5 text-right text-xs tabular-nums text-[var(--color-muted)]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <Input
                    aria-label={`Task ${index + 1}`}
                    value={task.title}
                    onChange={(e) => update(task.key, { title: e.target.value })}
                    placeholder="Task"
                  />
                  <Input
                    aria-label={`Task ${index + 1} notes`}
                    value={task.notes}
                    onChange={(e) => update(task.key, { notes: e.target.value })}
                    placeholder="Notes for the crew (optional)"
                    className="h-7 text-xs"
                  />
                </div>
                <div className="flex shrink-0 items-center pt-0.5">
                  <IconButton label={`Move task ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" />
                  </IconButton>
                  <IconButton
                    label={`Move task ${index + 1} down`}
                    disabled={index === tasks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <path d="M10 5v10M5.5 10.5 10 15l4.5-4.5" />
                  </IconButton>
                  <IconButton
                    label={`Remove task ${index + 1}`}
                    disabled={tasks.length === 1}
                    onClick={() => setTasks((list) => list.filter((item) => item.key !== task.key))}
                  >
                    <path d="M6 6l8 8M14 6l-8 8" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
          <div className="px-5">
            <Button
              variant="ghost"
              size="sm"
              className="ml-6 mt-1"
              disabled={tasks.length >= 100}
              onClick={() => setTasks((list) => [...list, row()])}
            >
              + Add task
            </Button>
          </div>
          {error ? (
            <p role="alert" className="px-5 pt-2 text-xs text-[var(--color-bad)]">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border)] px-5 py-3">
            {initial.id ? (
              <Button variant="ghost" className="text-[var(--color-bad)]" onClick={remove} disabled={pending}>
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" className="ml-auto" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !valid}>
              {pending ? "Saving…" : "Save template"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        {children}
      </svg>
    </button>
  );
}
