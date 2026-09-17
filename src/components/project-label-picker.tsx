"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProjectLabels } from "@/lib/actions/project-workspace";
import type { ProjectLabel } from "@/lib/project-workspace";
import { ProjectModal } from "./project-profile-panel";
import { LabelEditor, LabelMenu, DeleteLabelDialog } from "./label-editor";
import { Button, Input } from "./ui";

export function ProjectLabelPicker({
  projectId,
  labels,
  selectedIds,
  onClose,
}: {
  projectId: string;
  labels: ProjectLabel[];
  selectedIds: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState(labels);
  const [selected, setSelected] = useState(selectedIds);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ProjectLabel | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProjectLabel | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function toggle(id: string) {
    setError("");
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }
  if (editing)
    return (
      <LabelEditor
        label={editing === "new" ? undefined : editing}
        onClose={() => setEditing(null)}
        onSaved={(label) => {
          setOptions((current) =>
            [...current.filter((value) => value.id !== label.id), label].sort(
              (a, b) => a.name.localeCompare(b.name),
            ),
          );
          if (editing === "new")
            setSelected((current) => [...current, label.id]);
          setEditing(null);
          router.refresh();
        }}
      />
    );
  if (deleting)
    return (
      <DeleteLabelDialog
        label={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setOptions((current) =>
            current.filter((label) => label.id !== deleting.id),
          );
          setSelected((current) => current.filter((id) => id !== deleting.id));
          setDeleting(null);
          router.refresh();
        }}
      />
    );
  const visible = options.filter((label) =>
    label.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <ProjectModal
      title="Project Labels"
      wide
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <div className="p-6">
        <div className="mb-5 flex min-h-8 flex-wrap items-center gap-2">
          {selected.length ? (
            options
              .filter((label) => selected.includes(label.id))
              .map((label) => (
                <button
                  key={label.id}
                  disabled={pending}
                  onClick={() => toggle(label.id)}
                  aria-label={`Remove ${label.name}`}
                  className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                  <span aria-hidden="true">×</span>
                </button>
              ))
          ) : (
            <span className="text-sm text-slate-500">No labels selected</span>
          )}
        </div>
        <Input
          type="search"
          aria-label="Search Labels"
          placeholder="Search Labels"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mt-4 grid max-h-[45vh] gap-x-6 overflow-y-auto sm:grid-cols-2">
          {visible.map((label) => (
            <div
              key={label.id}
              className="flex items-center rounded-lg hover:bg-slate-50"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pl-2">
                <input
                  type="checkbox"
                  disabled={
                    pending ||
                    (!selected.includes(label.id) && selected.length >= 30)
                  }
                  checked={selected.includes(label.id)}
                  onChange={() => toggle(label.id)}
                  className="h-5 w-5 shrink-0 accent-blue-600"
                />
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="truncate text-sm">{label.name}</span>
              </label>
              <LabelMenu
                disabled={pending}
                label={label}
                onEdit={() => setEditing(label)}
                onDelete={() => setDeleting(label)}
              />
            </div>
          ))}
          {!visible.length ? (
            <p className="col-span-full py-10 text-center text-sm text-slate-500">
              {options.length ? "No matching labels" : "No labels yet"}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      <footer className="flex items-center gap-3 border-t border-slate-200 p-6">
        <button
          disabled={pending}
          onClick={() => setEditing("new")}
          className="mr-auto text-sm font-semibold text-blue-600"
        >
          ＋ Create Label
        </button>
        <Button variant="subtle" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            setError("");
            startTransition(async () => {
              try {
                const result = await setProjectLabels(projectId, selected);
                if (result.error) setError(result.error);
                else {
                  router.refresh();
                  onClose();
                }
              } catch {
                setError(
                  "Could not save labels. Your selection is still here.",
                );
              }
            });
          }}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </footer>
    </ProjectModal>
  );
}
