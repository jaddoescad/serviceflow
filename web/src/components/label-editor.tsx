"use client";

import { useId, useRef, useState, useTransition } from "react";
import {
  saveProjectLabel,
  deleteProjectLabel,
} from "@/lib/actions/project-workspace";
import type { ProjectLabel } from "@/lib/project-workspace";
import { ProjectModal } from "./project-profile-panel";
import { Button, Field, Input } from "./ui";

export const LABEL_COLORS = [
  ["Green", "#31a03c"],
  ["Blue", "#4191ed"],
  ["Purple", "#a227c5"],
  ["Navy", "#354b62"],
  ["Yellow", "#ffd000"],
  ["Orange", "#e76119"],
  ["Red", "#c73732"],
  ["Light Gray", "#828c95"],
  ["Dark Gray", "#4d5a68"],
] as const;

export function LabelColorPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-3 text-sm font-semibold">Color</legend>
      <div className="flex flex-wrap gap-3">
        {LABEL_COLORS.map(([label, color]) => (
          <label key={color} title={label} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              aria-label={label}
              checked={value === color}
              onChange={() => onChange(color)}
              className="peer sr-only"
            />
            <span
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-black/5 text-white peer-checked:ring-2 peer-checked:ring-slate-800 peer-checked:ring-offset-2 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600 peer-focus-visible:ring-offset-2"
              style={{ backgroundColor: color }}
            >
              {value === color ? <span aria-hidden="true">✓</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function LabelEditor({
  label,
  onClose,
  onSaved,
}: {
  label?: ProjectLabel;
  onClose: () => void;
  onSaved: (label: ProjectLabel) => void;
}) {
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState(label?.color ?? LABEL_COLORS[0][1]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <ProjectModal
      title={label ? "Edit Label" : "Create Label"}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        className="space-y-7 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          startTransition(async () => {
            try {
              const result = await saveProjectLabel({
                id: label?.id,
                name,
                color,
              });
              if (result.error) setError(result.error);
              else if (result.label) onSaved({ ...label, ...result.label });
            } catch {
              setError("Could not save label. Your changes are still here.");
            }
          });
        }}
      >
        <Field label="Name">
          <Input
            autoFocus
            required
            maxLength={60}
            disabled={pending}
            placeholder="Give your new label a name…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <LabelColorPicker
          value={color}
          onChange={setColor}
          disabled={pending}
        />
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <footer className="flex justify-end gap-3 border-t border-slate-200 pt-5">
          <Button
            type="button"
            variant="subtle"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </footer>
      </form>
    </ProjectModal>
  );
}

export function DeleteLabelDialog({
  label,
  onClose,
  onDeleted,
}: {
  label: ProjectLabel;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <ProjectModal
      title="Delete Label"
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <div className="space-y-6 p-6">
        <p className="text-sm">
          Delete “{label.name}”? This removes the label from every project.
          Projects and photos will be kept.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="subtle" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = await deleteProjectLabel(label.id);
                  if (result.error) setError(result.error);
                  else onDeleted();
                } catch {
                  setError("Could not delete label.");
                }
              })
            }
          >
            {pending ? "Deleting…" : "Delete Label"}
          </Button>
        </div>
      </div>
    </ProjectModal>
  );
}

export function LabelMenu({
  label,
  onEdit,
  onDelete,
  disabled = false,
}: {
  label: ProjectLabel;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  function choose(action: () => void) {
    menu.current?.hidePopover();
    action();
  }
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        popoverTarget={id}
        aria-label={`Actions for ${label.name}`}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(
              8,
              Math.min(bounds.right - 144, window.innerWidth - 152),
            ),
            top:
              bounds.bottom + 96 < window.innerHeight
                ? bounds.bottom + 4
                : Math.max(8, bounds.top - 92),
          });
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-slate-100 disabled:opacity-50"
      >
        ···
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        onToggle={(event) => {
          if (event.newState === "open")
            menu.current?.querySelector("button")?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
        style={position}
        className="fixed m-0 w-36 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-900 shadow-lg"
      >
        <button
          type="button"
          onClick={() => choose(onEdit)}
          className="w-full rounded px-3 py-2 text-left hover:bg-slate-100"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => choose(onDelete)}
          className="w-full rounded px-3 py-2 text-left text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </>
  );
}
