"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProjectLabelPicker } from "./project-label-picker";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { LabelChip } from "./label-chip";
import { AddressInput } from "./address-input";
import { Button, Field, Input, Tag, Textarea, buttonClassName } from "./ui";
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
          <Button variant="ghost" size="sm" onClick={() => setLabelPicker(true)}>
            {project.labels.length ? "Edit labels" : "+ Add labels"}
          </Button>
        ) : null}
        {project.archived_at ? (
          <Tag>{project.trashed_at ? "In trash" : "Archived"}</Tag>
        ) : null}
        {canManage ? (
          <div className="flex gap-2">
            {!project.trashed_at ? (
              <Button variant="secondary" onClick={edit}>
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
                className={buttonClassName({ variant: "secondary", className: "w-8 px-0" })}
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
                className="fixed m-0 w-52 rounded-[var(--radius)] bg-[var(--color-surface)] p-1 text-[13px] text-[var(--color-text)] shadow-[var(--shadow-pop)]"
              >
                {project.trashed_at ? (
                  <button
                    disabled={pending}
                    onClick={() => lifecycle("restore")}
                    className="flex h-8 w-full items-center rounded-md px-2 text-left hover:bg-[var(--color-hover)]"
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
                      className="flex h-8 w-full items-center rounded-md px-2 text-left hover:bg-[var(--color-hover)]"
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
                        className="flex h-8 w-full items-center rounded-md px-2 text-left text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]"
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
        <p role="alert" className="mt-2 text-xs text-[var(--color-bad)]">
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
            <div className="space-y-4 p-5">
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
                <AddressInput
                  value={draft.address}
                  maxLength={500}
                  onChange={(address) =>
                    setDraft((current) => ({ ...current, address }))
                  }
                />
              </Field>
              <fieldset className="space-y-4 border-t border-[var(--color-border)] pt-4">
                <legend className="pr-2 text-[13px] font-semibold text-[var(--color-heading)]">
                  Contact
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
                <Textarea
                  rows={4}
                  maxLength={10000}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                />
              </Field>
              {error ? (
                <p role="alert" className="text-[13px] text-[var(--color-bad)]">
                  {error}
                </p>
              ) : null}
            </div>
            <ModalFooter>
              <Button
                variant="secondary"
                type="button"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save Changes"}
              </Button>
            </ModalFooter>
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
          <div className="space-y-3 p-5">
            <p className="text-[13px] text-[var(--color-text)]">
              Move {project.name} to trash? You can restore it for 90 days.
            </p>
            {error && (
              <p role="alert" className="text-[13px] text-[var(--color-bad)]">
                {error}
              </p>
            )}
          </div>
          <ModalFooter>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirmTrash(false)}
            >
              Cancel
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => lifecycle("trash")}>
              {pending ? "Moving…" : "Move to Trash"}
            </Button>
          </ModalFooter>
        </ProjectModal>
      ) : null}
    </>
  );
}
