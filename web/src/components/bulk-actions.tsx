"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { bulkAddLabel, bulkAssignSalesperson, type BulkResult } from "@/lib/actions/pipeline";
import type { TeamOption } from "@/lib/crm-types";
import type { ProjectLabel } from "@/lib/project-workspace";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { Button, Field, Select } from "./ui";

type Target = { recordIds: string[] } | { contactIds: string[] };

/** Row or header checkbox for selecting table rows. */
export function SelectBox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="block h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
    />
  );
}

const plural = (count: number, noun: string) => `${count.toLocaleString("en-CA")} ${noun}${count === 1 ? "" : "s"}`;

/** Floating bar for a table's selected rows: assign a salesperson or add a
 * label. For customers both act on their open deals; `dealCount` is how many
 * that is (null when the rows are the deals themselves). */
export function BulkActions({
  selected,
  noun,
  target,
  dealCount,
  team,
  labels,
  onClear,
}: {
  selected: number;
  noun: "customer" | "deal" | "job";
  target: Target;
  dealCount: number | null;
  team: TeamOption[];
  labels: ProjectLabel[];
  onClear: () => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"assign" | "label" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!selected && !message) return null;
  const scope =
    dealCount === null
      ? plural(selected, noun)
      : `the ${plural(dealCount, "open deal")} of ${plural(selected, noun)}`;
  const nothingToChange = dealCount === 0;

  function done(text: string) {
    setDialog(null);
    setMessage(text);
    onClear();
    router.refresh();
  }

  return (
    <>
      <div
        role="region"
        aria-label="Selected rows"
        className="fixed bottom-5 left-1/2 z-40 flex h-11 -translate-x-1/2 items-center gap-1 rounded-[var(--radius-lg)] bg-[var(--color-surface)] px-2 text-[13px] shadow-[var(--shadow-pop)] md:ml-[116px]"
      >
        {selected ? (
          <>
            <span className="px-2 font-medium tabular-nums text-[var(--color-heading)]">{selected.toLocaleString("en-CA")} selected</span>
            <span aria-hidden="true" className="h-5 w-px bg-[var(--color-border)]" />
            <Button variant="ghost" size="sm" onClick={() => setDialog("assign")}>
              Assign salesperson
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDialog("label")}>
              Add label
            </Button>
            <span aria-hidden="true" className="h-5 w-px bg-[var(--color-border)]" />
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          </>
        ) : (
          <span role="status" className="px-2 text-[var(--color-text)]">
            {message}
          </span>
        )}
      </div>

      {dialog === "assign" ? (
        <BulkDialog
          title="Assign salesperson"
          description={nothingToChange ? `None of these ${noun}s has an open deal.` : `Sets the salesperson on ${scope}.`}
          label="Salesperson"
          submitLabel="Assign"
          options={[["", "Unassigned"], ...team.map((person) => [person.id, person.name] as [string, string])]}
          disabled={nothingToChange}
          onClose={() => setDialog(null)}
          onSubmit={async (value) => {
            const result = await bulkAssignSalesperson({ ...target, salespersonId: value || null });
            const name = team.find((person) => person.id === value)?.name;
            return finish(result, (count) =>
              name ? `Assigned ${plural(count, noun === "job" ? "job" : "deal")} to ${name}.` : `Unassigned ${plural(count, noun === "job" ? "job" : "deal")}.`,
            );
          }}
        />
      ) : null}
      {dialog === "label" ? (
        <BulkDialog
          title="Add label"
          description={
            nothingToChange
              ? `None of these ${noun}s has an open deal.`
              : labels.length
                ? `Adds the label to ${scope}.`
                : "Create labels from a deal's label picker first."
          }
          label="Label"
          submitLabel="Add label"
          options={labels.map((label) => [label.id, label.name] as [string, string])}
          disabled={nothingToChange || !labels.length}
          onClose={() => setDialog(null)}
          onSubmit={async (value) => {
            const result = await bulkAddLabel({ ...target, labelId: value });
            const name = labels.find((label) => label.id === value)?.name ?? "label";
            return finish(result, (count) => `Labelled ${plural(count, noun === "job" ? "job" : "deal")} “${name}”.`);
          }}
        />
      ) : null}
    </>
  );

  function finish(result: BulkResult, text: (count: number) => string): string | null {
    if (!result.ok) return result.error ?? "Could not update them. Try again.";
    done(text(result.count ?? 0));
    return null;
  }
}

function BulkDialog({
  title,
  description,
  label,
  submitLabel,
  options,
  disabled,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  label: string;
  submitLabel: string;
  options: [string, string][];
  disabled: boolean;
  onClose: () => void;
  onSubmit: (value: string) => Promise<string | null>;
}) {
  const [value, setValue] = useState(options.find(([id]) => id)?.[0] ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <ProjectModal title={title} onClose={() => !pending && onClose()}>
      <div className="space-y-4 p-5">
        <p className="text-[13px] text-[var(--color-text)]">{description}</p>
        {!disabled ? (
          <Field label={label}>
            <Select value={value} disabled={pending} onChange={(event) => setValue(event.target.value)} className="w-full">
              {options.map(([id, name]) => (
                <option key={id || "none"} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--tag-red-bg)] px-3 py-2 text-[13px] text-[var(--tag-red-text)]">
            {error}
          </p>
        ) : null}
      </div>
      <ModalFooter>
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          {disabled ? "Close" : "Cancel"}
        </Button>
        {!disabled ? (
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError("");
                const failure = await onSubmit(value).catch(() => "Could not update them. Try again.");
                if (failure) setError(failure);
              })
            }
          >
            {pending ? "Saving…" : submitLabel}
          </Button>
        ) : null}
      </ModalFooter>
    </ProjectModal>
  );
}
