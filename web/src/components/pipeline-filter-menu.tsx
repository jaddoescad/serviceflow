"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { PipelineCard } from "@/lib/pipeline-types";
import {
  FOLLOW_UP_DAY_OPTIONS,
  NO_FILTERS,
  activeFilterCount,
  sourceOf,
  type PipelineFilters,
} from "@/lib/pipeline-views";
import { DateFilterField } from "./date-filter-field";
import { FilterIcon, linkStyle } from "./pipeline-ui";
import { Popover } from "./popover";
import { Button, Select, cn } from "./ui";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
      <span className="pt-2 text-xs text-[var(--color-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The pipeline's Filter button: owner, source, label, dates and follow-up. */
export function PipelineFilterMenu({
  cards,
  filters,
  noun,
  onChange,
}: {
  cards: PipelineCard[];
  filters: PipelineFilters;
  noun: "deal" | "job";
  onChange: (filters: PipelineFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(filters);
  const options = useMemo(
    () => ({
      sources: [...new Set(cards.map(sourceOf))].sort((a, b) => a.localeCompare(b)),
      labels: [...new Map(cards.flatMap((card) => card.labels).map((label) => [label.id, label])).values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      salespeople: [
        ...new Map(
          cards
            .filter((card) => card.salespersonId)
            .map((card) => [card.salespersonId!, card.salespersonName ?? "Team member"]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    }),
    [cards],
  );
  const set = (patch: Partial<PipelineFilters>) => onChange({ ...filters, ...patch });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[min(352px,calc(100vw-2rem))] space-y-2.5 p-3"
      trigger={
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
          <FilterIcon className="h-3.5 w-3.5 text-[var(--color-muted)]" />
          Filter
          {active ? (
            <span className="rounded-[4px] bg-[var(--color-primary)] px-1 text-[11px] leading-4 text-[var(--color-primary-ink)]">
              {active}
            </span>
          ) : null}
        </Button>
      }
    >
      <Row label="Salesperson">
        <Select value={filters.salesperson} onChange={(event) => set({ salesperson: event.target.value })} className="w-full">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {options.salespeople.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Lead source">
        <Select value={filters.source} onChange={(event) => set({ source: event.target.value })} className="w-full">
          <option value="">Any source</option>
          {options.sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Label">
        <Select value={filters.label} onChange={(event) => set({ label: event.target.value })} className="w-full">
          <option value="">Any label</option>
          {options.labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Created">
        <DateFilterField label="Created" value={filters.created} onChange={(created) => set({ created })} />
      </Row>
      <Row label="Last updated">
        <DateFilterField label="Last updated" value={filters.updated} onChange={(updated) => set({ updated })} />
      </Row>
      <Row label="Stage entered">
        <DateFilterField label="Stage entered" value={filters.stageEntered} onChange={(stageEntered) => set({ stageEntered })} />
      </Row>
      <Row label="Follow-up">
        <Select
          aria-label="Follow-up"
          value={filters.followUp ? String(filters.followUpDays) : ""}
          onChange={(event) =>
            set(
              event.target.value
                ? { followUp: true, followUpDays: Number(event.target.value) }
                : { followUp: false, followUpDays: NO_FILTERS.followUpDays },
            )
          }
          className="w-full"
        >
          <option value="">Any</option>
          {FOLLOW_UP_DAY_OPTIONS.map((days) => (
            <option key={days} value={days}>
              Needed · {days} days without contact
            </option>
          ))}
        </Select>
        {filters.followUp ? (
          <p className="mt-1 text-xs leading-4 text-[var(--color-faint)]">
            Open {noun}s with no message or note in {filters.followUpDays} days
            {noun === "deal" ? ", proposals unopened after 3 days, or viewed and not accepted after 7" : ""}.
          </p>
        ) : null}
      </Row>
      {active ? (
        <div className="border-t border-[var(--color-border)] pt-2.5">
          <button type="button" onClick={() => onChange(NO_FILTERS)} className={cn("text-xs", linkStyle)}>
            Clear filters
          </button>
        </div>
      ) : null}
    </Popover>
  );
}
