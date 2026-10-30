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
import { PageHeader } from "./kpi";
import { DataTable, TablePanel, TableToolbar, Td, Th, Tr } from "./table-ui";
import { Button, EmptyState, Input } from "./ui";

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
    <Tr className={draft ? "bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]" : undefined}>
      <Td className="relative">
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
          className="block h-5 w-5 rounded-[5px] outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-default"
          style={{ backgroundColor: color }}
        />
        <div
          id={colorId}
          ref={colorPopover}
          popover="auto"
          style={colorPosition}
          className="fixed m-0 w-72 rounded-[var(--radius)] border-0 bg-[var(--color-surface)] p-3 font-normal text-[var(--color-text)] shadow-[var(--shadow-pop)]"
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => colorPopover.current?.hidePopover()}
            className="mt-3"
          >
            Close
          </Button>
        </div>
      </Td>
      <Td>
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
            className="h-7 w-full rounded-[var(--radius-control)] border border-transparent bg-transparent px-1.5 font-semibold text-[var(--color-heading)] outline-none hover:border-[var(--color-border-strong)] focus:border-[var(--color-brand)] focus:shadow-[var(--focus-ring)]"
          />
        ) : (
          <span className="font-semibold text-[var(--color-heading)]">{label.name}</span>
        )}
        {error ? (
          <p role="alert" className="mt-1 text-xs text-[var(--color-bad)]">
            {error}
          </p>
        ) : null}
      </Td>
      <Td>
        {draft ? null : label.project_count ? (
          <Link
            href={`/projects?label=${label.id}`}
            className="text-[var(--color-text)] hover:underline"
          >
            {label.project_count}{" "}
            {label.project_count === 1 ? "Project" : "Projects"}
          </Link>
        ) : (
          <span className="text-[var(--color-faint)]">None</span>
        )}
      </Td>
      <Td muted className="whitespace-nowrap">
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
      </Td>
      <Td className="text-right">
        {canManage && !draft ? (
          <LabelMenu label={label} onEdit={onEdit} onDelete={onDelete} />
        ) : null}
      </Td>
    </Tr>
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
    <div className="page-fill">
      <PageHeader
        title="Labels"
        subtitle={labels.length}
        actions={
          canManage && !creating ? (
            <Button
              onClick={() => {
                setSearch("");
                setCreating(true);
              }}
            >
              + Create Label
            </Button>
          ) : null
        }
      />
      <TableToolbar>
        <div className="w-full sm:w-64">
          <Input
            type="search"
            aria-label="Find a Label"
            placeholder="Find a Label…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </TableToolbar>
      <TablePanel fill>
        <DataTable minWidth={640}>
          <thead>
            <tr>
              <Th className="w-14">Color</Th>
              {(
                [
                  ["name", "Name"],
                  ["project_count", "Projects"],
                  ["updated_at", "Last Updated"],
                ] as const
              ).map(([value, title]) => (
                <Th
                  key={value}
                  sort={
                    sort === value
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button
                    onClick={() => changeSort(value)}
                    className="inline-flex items-center gap-1 hover:text-[var(--color-heading)]"
                  >
                    {title}
                    <span aria-hidden="true" className="text-[var(--color-faint)]">
                      {sort === value ? (descending ? "↓" : "↑") : "↕"}
                    </span>
                  </button>
                </Th>
              ))}
              <Th className="w-12">
                <span className="sr-only">Actions</span>
              </Th>
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
        </DataTable>
        {!visible.length && !creating ? (
          <EmptyState>{search ? "No matching labels" : "No labels yet"}</EmptyState>
        ) : null}
      </TablePanel>
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
    </div>
  );
}
