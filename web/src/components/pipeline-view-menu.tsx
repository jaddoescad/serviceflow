"use client";

import { useState, useTransition } from "react";
import { deletePipelineView, savePipelineView } from "@/lib/actions/pipeline";
import type { PipelineKey } from "@/lib/pipeline-types";
import type { PipelineViewConfig, PipelineViewOption } from "@/lib/pipeline-views";
import { CheckIcon, PlusIcon, TrashIcon } from "./pipeline-ui";
import { MenuItem, Popover } from "./popover";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { Button, Field, Input, cn } from "./ui";

const ChevronDown = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 text-[var(--color-faint)]">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const PencilIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
);

function ErrorLine({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-[var(--tag-red-bg)] px-3 py-2 text-[13px] text-[var(--tag-red-text)]">
      {error}
    </p>
  ) : null;
}

/** Names a new view or renames one. */
function ViewNameDialog({
  title,
  initialName,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  initialName: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <ProjectModal title={title} onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || pending) return;
          setError("");
          startTransition(async () => {
            const failure = await onSubmit(name.trim()).catch(() => "Could not save the view. Try again.");
            if (failure) setError(failure);
          });
        }}
      >
        <div className="p-5">
          <Field label="Name">
            <Input value={name} maxLength={60} required disabled={pending} onChange={(event) => setName(event.target.value)} />
          </Field>
          <ErrorLine error={error} />
        </div>
        <ModalFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </ModalFooter>
      </form>
    </ProjectModal>
  );
}

type Dialog = { kind: "new" } | { kind: "rename"; view: PipelineViewOption } | { kind: "delete"; view: PipelineViewOption };

/** The view switcher beside the pipeline title: built-in views, the
 * manager's saved views (rename/delete), and saving the current filters. */
export function PipelineViewMenu({
  pipeline,
  views,
  active,
  config,
  changed,
  counts,
  onSelect,
  onSaved,
  onDeleted,
}: {
  pipeline: PipelineKey;
  views: PipelineViewOption[];
  active: PipelineViewOption;
  /** The filters, sort and Board/List on screen now. */
  config: PipelineViewConfig;
  changed: boolean;
  counts: Map<string, number>;
  onSelect: (view: PipelineViewOption) => void;
  onSaved: (view: PipelineViewOption) => void;
  onDeleted: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const builtIn = views.filter((view) => view.builtIn);
  const saved = views.filter((view) => !view.builtIn);

  async function save(view: PipelineViewOption): Promise<string | null> {
    const result = await savePipelineView({ id: view.id, pipeline, name: view.name, config: view.config });
    if (!result.ok) return result.error ?? "Could not save the view.";
    onSaved(view);
    setDialog(null);
    return null;
  }

  function updateActive() {
    setError("");
    startTransition(async () => {
      const failure = await save({ ...active, config }).catch(() => "Could not save the view. Try again.");
      if (failure) setError(failure);
    });
  }

  const row = (view: PipelineViewOption) => (
    <div key={view.id} className="group relative">
      <MenuItem
        active={view.id === active.id}
        onClick={() => {
          onSelect(view);
          setOpen(false);
        }}
        className="pr-14"
      >
        <span className="flex w-3.5 shrink-0 justify-center">
          {view.id === active.id ? <CheckIcon className="h-3.5 w-3.5" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{view.name}</span>
      </MenuItem>
      <span
        className={cn(
          "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs tabular-nums text-[var(--color-faint)]",
          !view.builtIn && "group-focus-within:hidden group-hover:hidden",
        )}
      >
        {counts.get(view.id) ?? 0}
      </span>
      {view.builtIn ? null : (
        <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center group-focus-within:flex group-hover:flex">
          {(
            [
              ["rename", `Rename ${view.name}`, <PencilIcon key="r" />],
              ["delete", `Delete ${view.name}`, <TrashIcon key="d" className="h-3.5 w-3.5" />],
            ] as const
          ).map(([kind, label, icon]) => (
            <button
              key={kind}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => {
                setOpen(false);
                setDialog({ kind, view });
              }}
              className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
            >
              {icon}
            </button>
          ))}
        </span>
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover
        open={open}
        onOpenChange={setOpen}
        className="w-64 p-1"
        trigger={
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen(!open)}
            className="inline-flex h-7 max-w-56 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[13px] font-medium text-[var(--color-heading)] outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]"
          >
            <span className="truncate">{active.name}</span>
            <ChevronDown />
          </button>
        }
      >
        {builtIn.map(row)}
        {saved.length ? (
          <>
            <div className="mx-1 my-1 border-t border-[var(--color-border)]" />
            <p className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-[var(--color-faint)]">Your views</p>
            {saved.map(row)}
          </>
        ) : null}
        <div className="mx-1 my-1 border-t border-[var(--color-border)]" />
        <MenuItem
          onClick={() => {
            setOpen(false);
            setDialog({ kind: "new" });
          }}
          className="text-[var(--color-muted)]"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Save current view as…
        </MenuItem>
      </Popover>

      {changed ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onSelect(active)}>
            Reset
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => (active.builtIn ? setDialog({ kind: "new" }) : updateActive())}
          >
            {pending ? "Saving…" : active.builtIn ? "Save view" : "Save"}
          </Button>
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="truncate text-xs text-[var(--tag-red-text)]">
          {error}
        </span>
      ) : null}

      {dialog?.kind === "new" ? (
        <ViewNameDialog
          title="Save view"
          initialName=""
          submitLabel="Save view"
          onClose={() => setDialog(null)}
          onSubmit={(name) => save({ id: crypto.randomUUID(), name, builtIn: false, config })}
        />
      ) : null}
      {dialog?.kind === "rename" ? (
        <ViewNameDialog
          title="Rename view"
          initialName={dialog.view.name}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={(name) => save({ ...dialog.view, name })}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <DeleteViewDialog
          view={dialog.view}
          onClose={() => setDialog(null)}
          onDelete={async () => {
            const result = await deletePipelineView({ id: dialog.view.id, pipeline });
            if (!result.ok) return result.error ?? "Could not delete the view.";
            onDeleted(dialog.view.id);
            setDialog(null);
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteViewDialog({
  view,
  onClose,
  onDelete,
}: {
  view: PipelineViewOption;
  onClose: () => void;
  onDelete: () => Promise<string | null>;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <ProjectModal title="Delete view" onClose={() => !pending && onClose()}>
      <div className="p-5">
        <p className="text-[13px] text-[var(--color-text)]">
          Delete “{view.name}”? The deals in it are not affected.
        </p>
        <ErrorLine error={error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const failure = await onDelete().catch(() => "Could not delete the view. Try again.");
              if (failure) setError(failure);
            })
          }
        >
          {pending ? "Deleting…" : "Delete view"}
        </Button>
      </ModalFooter>
    </ProjectModal>
  );
}
