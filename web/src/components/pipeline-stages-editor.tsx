"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePipelineStage, movePipelineStage, savePipelineStage } from "@/lib/actions/crm";
import { RECORD_STATUS_OPTIONS as STATUS_OPTIONS, type PipelineKey, type PipelineStage } from "@/lib/pipeline-types";
import { ArrowDownIcon, ArrowUpIcon, Dot, TrashIcon, stageColors } from "./pipeline-ui";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { Button, Input, Select } from "./ui";

export function PipelineStagesEditor({
  pipeline,
  stages,
  onClose,
}: {
  pipeline: PipelineKey;
  stages: PipelineStage[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newStatus, setNewStatus] = useState(STATUS_OPTIONS[pipeline][0][0]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const colors = stageColors(stages);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    startTransition(async () => {
      setError("");
      const result = await action();
      if (!result.ok) setError(result.error ?? "Could not update the pipeline.");
      else after?.();
      router.refresh();
    });
  }

  const save = (stage: PipelineStage, patch: Partial<{ name: string; recordStatus: string }>) =>
    run(() =>
      savePipelineStage({
        id: stage.id,
        pipeline,
        name: patch.name ?? stage.name,
        recordStatus: patch.recordStatus ?? stage.recordStatus,
        isClosed: stage.isClosed,
      }),
    );

  const columns = "items-center gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_6.5rem]";

  return (
    <ProjectModal title="Edit columns" wide onClose={() => !pending && onClose()}>
      <div className="p-5">
        <div className={`hidden pb-2 text-xs font-medium text-[var(--color-muted)] sm:grid ${columns}`}>
          <span className="pl-6">Column</span>
          <span>Counts as</span>
          <span />
        </div>
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {stages.map((stage, index) => (
            <li key={stage.id} className={`grid py-2 ${columns}`}>
              <span className="flex items-center gap-2.5">
                <Dot color={colors.get(stage.id)} className="ml-1.5" />
                <Input
                  aria-label="Column name"
                  maxLength={60}
                  value={names[stage.id] ?? stage.name}
                  disabled={pending}
                  onChange={(event) => setNames({ ...names, [stage.id]: event.target.value })}
                  onBlur={() => {
                    const name = names[stage.id]?.trim();
                    if (name && name !== stage.name) save(stage, { name });
                  }}
                />
              </span>
              <Select
                aria-label={`What ${stage.name} counts as`}
                value={stage.recordStatus}
                disabled={pending}
                onChange={(event) => save(stage, { recordStatus: event.target.value })}
                className="w-full"
              >
                {STATUS_OPTIONS[pipeline].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <span className="flex justify-end gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${stage.name} earlier`}
                  disabled={pending || index === 0}
                  onClick={() => run(() => movePipelineStage(stage.id, -1))}
                  className="w-7 px-0"
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${stage.name} later`}
                  disabled={pending || index === stages.length - 1}
                  onClick={() => run(() => movePipelineStage(stage.id, 1))}
                  className="w-7 px-0"
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${stage.name}`}
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Delete the ${stage.name} column?`)) run(() => deletePipelineStage(stage.id));
                  }}
                  className="w-7 px-0 hover:bg-[var(--tag-red-bg)] hover:text-[var(--tag-red-text)]"
                >
                  <TrashIcon />
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <form
          className={`grid pt-4 ${columns}`}
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                savePipelineStage({
                  id: crypto.randomUUID(),
                  pipeline,
                  name: newName,
                  recordStatus: newStatus,
                  isClosed: newStatus === "lost",
                }),
              () => setNewName(""),
            );
          }}
        >
          <Input
            required
            aria-label="New column name"
            placeholder="New column"
            maxLength={60}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            className="sm:ml-6 sm:w-[calc(100%-1.5rem)]"
          />
          <Select
            aria-label="New column counts as"
            value={newStatus}
            onChange={(event) => setNewStatus(event.target.value)}
            className="w-full"
          >
            {STATUS_OPTIONS[pipeline].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" disabled={pending || !newName.trim()}>
            Add column
          </Button>
        </form>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-[var(--tag-red-text)]">
            {error}
          </p>
        ) : null}
      </div>
      <ModalFooter>
        <Button onClick={onClose} disabled={pending}>
          Done
        </Button>
      </ModalFooter>
    </ProjectModal>
  );
}
