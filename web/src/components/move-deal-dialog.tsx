"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { getDealOverview, setDealSettings } from "@/lib/actions/crm";
import { movePipelineCard } from "@/lib/actions/pipeline";
import type { DealOverview } from "@/lib/crm-types";
import { fmtCents } from "@/lib/line-items";
import type { PipelineCard, PipelineStage } from "@/lib/pipeline-types";
import { Dot, Switch, stageColors } from "./pipeline-ui";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { Button, Select } from "./ui";

export type MovableDeal = Pick<PipelineCard, "id" | "name" | "source" | "valueCents" | "stageId">;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[96px_minmax(0,1fr)] items-center gap-3 border-b border-[var(--color-border)] py-1.5 last:border-b-0">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <div className="min-w-0 text-[13px] text-[var(--color-heading)]">{children}</div>
    </div>
  );
}

/** DripJobs' "Move Deal" step: confirm the column and whether the deal
 * gets that column's drips. Nothing changes until Move is pressed. */
export function MoveDealDialog({
  card,
  stages,
  initialStageId,
  noun,
  onClose,
  onMoved,
}: {
  card: MovableDeal;
  stages: PipelineStage[];
  initialStageId: string;
  noun: "deal" | "job";
  onClose: () => void;
  onMoved: (stageId: string) => void;
}) {
  const [stageId, setStageId] = useState(initialStageId);
  const [settings, setSettings] = useState<DealOverview["settings"] | null>(null);
  const [dripsPaused, setDripsPaused] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const colors = stageColors(stages);
  const from = stages.find((stage) => stage.id === card.stageId);
  const target = stages.find((stage) => stage.id === stageId);

  useEffect(() => {
    let cancelled = false;
    getDealOverview(card.id).then(
      (deal) => {
        if (cancelled) return;
        setSettings(deal.settings);
        setDripsPaused(deal.settings.dripsPaused);
      },
      () => {
        if (!cancelled) setError(`Could not load this ${noun}'s drip setting. You can still move it.`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [card.id, noun]);

  function move() {
    if (!target || target.id === card.stageId) return;
    const toStage = target.id;
    // The drip setting is saved first: a move only queues the new column's
    // drips when the deal is not paused at that moment.
    const saveDrips =
      settings && dripsPaused !== settings.dripsPaused
        ? (paused: boolean) =>
            setDealSettings({
              recordId: card.id,
              salespersonId: settings.salespersonId,
              projectManagerId: settings.projectManagerId,
              dripsPaused: paused,
            })
        : null;
    setError("");
    startTransition(async () => {
      try {
        if (saveDrips) {
          const saved = await saveDrips(dripsPaused);
          if (!saved.ok) throw new Error(saved.error);
        }
        const result = await movePipelineCard({ recordId: card.id, stageId: toStage });
        if (!result.ok) {
          if (saveDrips) await saveDrips(!dripsPaused).catch(() => null);
          throw new Error(result.error);
        }
        onMoved(toStage);
      } catch (reason) {
        setError(reason instanceof Error && reason.message ? reason.message : "Could not move it. Try again.");
      }
    });
  }

  return (
    <ProjectModal title={`Move ${noun}`} onClose={() => !pending && onClose()}>
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-[13px] font-semibold text-[var(--color-heading)]">{card.name}</p>
          <p className="shrink-0 text-xs tabular-nums text-[var(--color-muted)]">{fmtCents(card.valueCents ?? 0)}</p>
        </div>
        {card.source ? <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{card.source}</p> : null}

        <div className="mt-4 border-t border-[var(--color-border)]">
          <Row label="From">
            <span className="flex items-center gap-2">
              <Dot color={from && colors.get(from.id)} />
              <span className="truncate">{from?.name ?? "—"}</span>
            </span>
          </Row>
          <Row label="To">
            <Select
              aria-label="Move to"
              value={stageId}
              disabled={pending}
              onChange={(event) => setStageId(event.target.value)}
              className="w-full"
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id} disabled={stage.id === card.stageId}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Drips">
            <span className={target?.dripsEnabled ? "text-[var(--color-heading)]" : "text-[var(--color-muted)]"}>
              {target?.dripsEnabled ? `On in ${target.name}` : `Off in ${target?.name ?? "this column"}`}
            </span>
          </Row>
          <Row label="Disable drips">
            <span className="flex items-center justify-between gap-3">
              <span className="text-[var(--color-muted)]">{dripsPaused ? `Paused for this ${noun}` : "No"}</span>
              <Switch
                label={`Disable drips for this ${noun}`}
                checked={dripsPaused}
                disabled={pending || !settings}
                onChange={setDripsPaused}
              />
            </span>
          </Row>
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-[var(--tag-red-bg)] px-3 py-2 text-[13px] text-[var(--tag-red-text)]">
            {error}
          </p>
        ) : null}
      </div>
      <ModalFooter>
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={pending || !target || target.id === card.stageId} onClick={move}>
          {pending ? "Moving…" : "Move"}
        </Button>
      </ModalFooter>
    </ProjectModal>
  );
}
