"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProjectLabelPicker } from "./project-label-picker";
import { ProjectModal } from "./project-profile-panel";
import { LabelChip } from "./label-chip";
import { Button, Field, Input } from "./ui";
import {
  changeProjectLifecycle,
  saveWorkspaceProject,
  type ProjectEdit,
} from "@/lib/actions/project-workspace";
import type { ProjectLabel, WorkspaceProject } from "@/lib/project-workspace";
import type { ProjectContact } from "@/lib/project-data";

export function WorkspaceProjectActions({
  project,
  contact,
  description,
  labels,
  canManage,
}: {
  project: WorkspaceProject;
  contact: ProjectContact;
  description: string | null;
  labels: ProjectLabel[];
  canManage: boolean;
}) {
  const router = useRouter();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [editing, setEditing] = useState(false);
  const [labelPicker, setLabelPicker] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ProjectEdit>(() => values());
  function values(): ProjectEdit {
    return {
      id: project.id,
      name: project.name,
      contactName: contact.name ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      address: project.address ?? "",
      description: description ?? "",
      notes: contact.customerNotes ?? "",
      labels: project.labels.map((label) => label.id),
    };
  }
  function edit() {
    setDraft(values());
    setError("");
    setEditing(true);
  }
  function lifecycle(action: "archive" | "unarchive" | "trash" | "restore") {
    menu.current?.hidePopover();
    setError("");
    startTransition(async () => {
      try {
        const result = await changeProjectLifecycle(project.id, action);
        if (result.error) {
          setError(result.error);
          return;
        }
        setConfirmTrash(false);
        if (action === "trash") router.push("/projects?view=trash");
        else router.refresh();
      } catch {
        setError("Could not save project. Try again.");
      }
    });
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {project.labels.map((label) => (
          <LabelChip key={label.id} label={label} />
        ))}
        {canManage && !project.trashed_at ? (
          <button
            onClick={() => setLabelPicker(true)}
            className="text-sm font-semibold text-blue-600"
          >
            {project.labels.length ? "Edit Labels" : "Add Labels"}
          </button>
        ) : null}
        {project.archived_at ? (
          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">
            {project.trashed_at ? "In trash" : "Archived"}
          </span>
        ) : null}
        {canManage ? (
          <div className="ml-auto flex gap-2">
            {!project.trashed_at ? (
              <Button variant="subtle" onClick={edit}>
                Edit Project
              </Button>
            ) : null}
            <div>
              <button
                type="button"
                disabled={pending}
                popoverTarget={menuId}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setMenuPosition({
                    top: bounds.bottom + 4,
                    left: Math.max(
                      8,
                      Math.min(bounds.right - 208, window.innerWidth - 216),
                    ),
                  });
                }}
                aria-label="Project menu"
                className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full bg-slate-100 text-xl"
              >
                ···
              </button>
              <div
                id={menuId}
                ref={menu}
                popover="auto"
                style={menuPosition}
                onToggle={(event) => {
                  if (event.newState === "open")
                    menu.current
                      ?.querySelector<HTMLButtonElement>("button")
                      ?.focus();
                }}
                className="fixed m-0 w-52 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg"
              >
                {project.trashed_at ? (
                  <button
                    disabled={pending}
                    onClick={() => lifecycle("restore")}
                    className="w-full p-3 text-left hover:bg-slate-50"
                  >
                    Restore project
                  </button>
                ) : (
                  <>
                    <button
                      disabled={pending}
                      onClick={() =>
                        lifecycle(project.archived_at ? "unarchive" : "archive")
                      }
                      className="w-full p-3 text-left hover:bg-slate-50"
                    >
                      {project.archived_at
                        ? "Unarchive Project"
                        : "Archive Project"}
                    </button>
                    {project.archived_at ? (
                      <button
                        disabled={pending}
                        onClick={() => {
                          menu.current?.hidePopover();
                          setError("");
                          setConfirmTrash(true);
                        }}
                        className="w-full p-3 text-left text-red-700 hover:bg-red-50"
                      >
                        Delete Project
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {error && !editing && !confirmTrash ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {labelPicker ? (
        <ProjectLabelPicker
          projectId={project.id}
          labels={labels}
          selectedIds={project.labels.map((label) => label.id)}
          onClose={() => setLabelPicker(false)}
        />
      ) : null}
      {editing ? (
        <ProjectModal
          title="Edit Project"
          onClose={() => {
            if (!pending) setEditing(false);
          }}
        >
          <form
            className="space-y-5 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              startTransition(async () => {
                try {
                  const result = await saveWorkspaceProject(draft);
                  if (result.error) setError(result.error);
                  else {
                    setEditing(false);
                    router.refresh();
                  }
                } catch {
                  setError(
                    "Could not save project. Your changes are still here.",
                  );
                }
              });
            }}
          >
            <Field label="Project name">
              <Input
                required
                maxLength={200}
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>
            <Field label="Address">
              <Input
                value={draft.address}
                maxLength={500}
                onChange={(event) =>
                  setDraft({ ...draft, address: event.target.value })
                }
              />
            </Field>
            <fieldset className="space-y-4 border-t border-slate-200 pt-4">
              <legend className="pr-2 text-sm font-semibold">
                Contact Info
              </legend>
              <Field label="Contact name">
                <Input
                  required
                  maxLength={160}
                  value={draft.contactName}
                  onChange={(event) =>
                    setDraft({ ...draft, contactName: event.target.value })
                  }
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email">
                  <Input
                    type="email"
                    maxLength={320}
                    value={draft.email}
                    onChange={(event) =>
                      setDraft({ ...draft, email: event.target.value })
                    }
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    maxLength={60}
                    value={draft.phone}
                    onChange={(event) =>
                      setDraft({ ...draft, phone: event.target.value })
                    }
                  />
                </Field>
              </div>
            </fieldset>
            <Field label="Description">
              <textarea
                rows={4}
                maxLength={10000}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                className="w-full rounded-md border border-slate-300 p-3 text-sm"
              />
            </Field>

            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
              <Button
                variant="subtle"
                type="button"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        </ProjectModal>
      ) : null}
      {confirmTrash ? (
        <ProjectModal
          title="Delete Project"
          onClose={() => {
            if (!pending) setConfirmTrash(false);
          }}
        >
          <div className="space-y-5 p-6">
            <p className="text-sm">
              Move {project.name} to trash? You can restore it for 90 days.
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                variant="subtle"
                disabled={pending}
                onClick={() => setConfirmTrash(false)}
              >
                Cancel
              </Button>
              <Button disabled={pending} onClick={() => lifecycle("trash")}>
                {pending ? "Moving…" : "Move to Trash"}
              </Button>
            </div>
          </div>
        </ProjectModal>
      ) : null}
    </>
  );
}
