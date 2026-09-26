"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProjectLabel } from "@/lib/actions/project-workspace";
import type { ProjectLabel } from "@/lib/project-workspace";
import {
  LabelEditor,
  LabelMenu,
  DeleteLabelDialog,
  LabelColorPicker,
} from "./label-editor";
import { Button } from "./ui";

type Sort = "name" | "project_count" | "updated_at";

function LabelRow({
  label,
  canManage,
  onEdit,
  onDelete,
  draft = false,
  onCreated,
}: {
  label: ProjectLabel;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  draft?: boolean;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(label.name);
  const [draftColor, setDraftColor] = useState(label.color);
  const color = draft ? draftColor : label.color;
  const colorId = useId();
  const colorPopover = useRef<HTMLDivElement>(null);
  const [colorPosition, setColorPosition] = useState({ top: 0, left: 0 });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  function save(values: { name: string; color: string }) {
    if (saving.current || (draft && !values.name.trim())) return;
    if (!draft && values.name === label.name && values.color === label.color)
      return;
    saving.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = await saveProjectLabel({
          id: draft ? undefined : label.id,
          ...values,
        });
        if (result.error) setError(result.error);
        else {
          colorPopover.current?.hidePopover();
          onCreated?.();
          router.refresh();
        }
      } catch {
        setError("Could not save label.");
      } finally {
        saving.current = false;
      }
    });
  }
  return (
    <tr className={`border-b border-slate-200 ${draft ? "bg-slate-50" : ""}`}>
      <td className="relative w-20 px-4 py-5">
        <button
          disabled={!canManage || pending}
          aria-label={
            draft ? "New label color" : `Change color for ${label.name}`
          }
          popoverTarget={colorId}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            setColorPosition({
              left: Math.max(8, Math.min(bounds.left, window.innerWidth - 296)),
              top:
                bounds.bottom + 225 < window.innerHeight
                  ? bounds.bottom + 4
                  : Math.max(8, bounds.top - 225),
            });
          }}
          className="h-8 w-8 rounded-lg"
          style={{ backgroundColor: color }}
        />
        <div
          id={colorId}
          ref={colorPopover}
          popover="auto"
          style={colorPosition}
          className="fixed m-0 w-72 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-lg"
        >
          <LabelColorPicker
            value={color}
            disabled={pending}
            onChange={(color) => {
              if (draft) {
                setDraftColor(color);
                colorPopover.current?.hidePopover();
              } else save({ name: label.name, color });
            }}
          />
          <button
            onClick={() => colorPopover.current?.hidePopover()}
            className="mt-4 text-sm text-slate-500"
          >
            Close
          </button>
        </div>
      </td>
      <td className="px-4 py-5">
        {canManage ? (
          <input
            aria-label={draft ? "New label name" : `Name for ${label.name}`}
            autoFocus={draft}
            value={name}
            disabled={pending}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onBlur={(event) => {
              if (!draft || !event.relatedTarget?.closest("tr"))
                save({ name, color });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (draft) save({ name, color });
                else event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                if (draft) {
                  onCreated?.();
                  return;
                }
                setName(label.name);
                event.currentTarget.value = label.name;
              }
            }}
            className="w-full rounded border border-transparent bg-transparent px-1 py-1 font-semibold hover:border-slate-300 focus:border-blue-500 focus:outline-none"
          />
        ) : (
          <span className="font-semibold">{label.name}</span>
        )}
        {error ? (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {error}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-5">
        {draft ? null : label.project_count ? (
          <Link
            href={`/projects?label=${label.id}`}
            className="font-semibold text-slate-600 hover:text-blue-600"
          >
            {label.project_count}{" "}
            {label.project_count === 1 ? "Project" : "Projects"}
          </Link>
        ) : (
          <span className="text-slate-500">None</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-5 text-slate-500">
        {draft
          ? null
          : label.updated_at
            ? new Date(label.updated_at).toLocaleString("en-CA", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "—"}
      </td>
      <td className="w-16 px-4 py-5">
        {canManage && !draft ? (
          <LabelMenu label={label} onEdit={onEdit} onDelete={onDelete} />
        ) : null}
      </td>
    </tr>
  );
}

export function ProjectLabels({
  labels,
  canManage,
}: {
  labels: ProjectLabel[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ProjectLabel | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectLabel | null>(null);
  const [sort, setSort] = useState<Sort>("updated_at");
  const [descending, setDescending] = useState(true);
  const visible = labels
    .filter((label) => label.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const comparison =
        sort === "project_count"
          ? (a.project_count ?? 0) - (b.project_count ?? 0)
          : (a[sort] ?? "").localeCompare(b[sort] ?? "");
      return (
        (descending ? -comparison : comparison) || a.name.localeCompare(b.name)
      );
    });
  function changeSort(value: Sort) {
    if (sort === value) setDescending(!descending);
    else {
      setSort(value);
      setDescending(value !== "name");
    }
  }
  return (
    <section className="workspace-page">
      <header className="flex flex-wrap items-center gap-6">
        <h1 className="text-4xl font-extrabold tracking-tight">Labels</h1>
        <input
          type="search"
          aria-label="Find a Label"
          placeholder="Find a Label…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-10 w-52 rounded-lg border border-slate-300 px-3 text-sm"
        />
        {canManage ? (
          <div className="ml-auto">
            {!creating ? (
              <Button
                onClick={() => {
                  setSearch("");
                  setCreating(true);
                }}
              >
                ＋ Create Label
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="relative mt-10 overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-20" />
            <col />
            <col />
            <col />
            <col className="w-16" />
          </colgroup>
          <thead className="border-b-2 border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Color</th>
              {(
                [
                  ["name", "Name"],
                  ["project_count", "Projects"],
                  ["updated_at", "Last Updated"],
                ] as const
              ).map(([value, title]) => (
                <th
                  key={value}
                  aria-sort={
                    sort === value
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                  className="px-4 py-3 font-semibold"
                >
                  <button onClick={() => changeSort(value)}>
                    {title}
                    <span aria-hidden="true" className="ml-2">
                      {sort === value ? (descending ? "↓" : "↑") : "↕"}
                    </span>
                  </button>
                </th>
              ))}
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {creating ? (
              <LabelRow
                label={{ id: "draft", name: "", color: "#828c95" }}
                canManage
                draft
                onCreated={() => setCreating(false)}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            ) : null}
            {visible.map((label) => (
              <LabelRow
                key={`${label.id}-${label.updated_at}`}
                label={label}
                canManage={canManage}
                onEdit={() => setEditing(label)}
                onDelete={() => setDeleting(label)}
              />
            ))}
          </tbody>
        </table>
        {!visible.length && !creating ? (
          <p className="py-16 text-center text-sm text-slate-500">
            {search ? "No matching labels" : "No labels yet"}
          </p>
        ) : null}
      </div>
      {editing ? (
        <LabelEditor
          label={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteLabelDialog
          label={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
