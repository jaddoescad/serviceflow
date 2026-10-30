"use client";

import { useState } from "react";
import { fmtDate, fmtRelativeTime } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import type { PipelineCard, PipelineStage } from "@/lib/pipeline-types";
import { followUpAge, type FollowUp, type PipelineSort, type PipelineSortKey } from "@/lib/pipeline-views";
import { SelectBox } from "./bulk-actions";
import { ArchivedToggle, Dot, Initials, LabelTags } from "./pipeline-ui";
import { ShowMore } from "./show-more";
import { DataTable, RowLink, SortTh, TablePanel, Td, Th, Tr } from "./table-ui";
import { EmptyState, Select, cn } from "./ui";

const PAGE = 100;

const dash = <span className="text-[var(--color-faint)]">—</span>;

/** The pipeline's List view: one row per deal or job, sortable columns, a
 * stage select that opens the Move dialog, and row selection for bulk edits.
 * Archived rows sit after the rest, hidden until "Archived" is opened. */
export function PipelineList({
  cards,
  archived,
  archivedCount,
  archivedLoading,
  showArchived,
  onToggleArchived,
  stages,
  colors,
  noun,
  filtered,
  sort,
  followUps,
  selected,
  onSort,
  onSelect,
  onMove,
  onEditLabels,
}: {
  cards: PipelineCard[];
  /** Loaded archived cards; archivedCount is what the toggle shows (0: none). */
  archived: PipelineCard[];
  archivedCount: number | null;
  archivedLoading: boolean;
  showArchived: boolean;
  onToggleArchived: () => void;
  stages: PipelineStage[];
  colors: Map<string, string>;
  noun: "deal" | "job";
  filtered: boolean;
  sort: PipelineSort;
  /** Set when the view is the follow-up queue. */
  followUps: Map<string, FollowUp> | null;
  selected: Set<string>;
  onSort: (key: PipelineSortKey) => void;
  onSelect: (selected: Set<string>) => void;
  onMove: (card: PipelineCard, stageId: string) => void;
  onEditLabels: (card: PipelineCard) => void;
}) {
  const header = (key: PipelineSortKey, label: string, options: { numeric?: boolean; className?: string } = {}) => (
    <SortTh
      label={label}
      active={sort.key === key}
      desc={sort.desc}
      numeric={options.numeric}
      className={options.className}
      onClick={() => onSort(key)}
    />
  );
  // Rows draw a page at a time as the list scrolls.
  const [shown, setShown] = useState({ open: PAGE, archived: PAGE });
  const more = (key: keyof typeof shown) => setShown((current) => ({ ...current, [key]: current[key] + PAGE }));
  const rows = showArchived ? [...cards, ...archived] : cards;
  const columns = followUps ? 10 : 9;
  const moreRow = (count: number, onMore: () => void) => (
    <tr>
      <td colSpan={columns} className="px-2 py-1">
        <ShowMore count={count} onMore={onMore} className="w-auto" />
      </td>
    </tr>
  );
  const allSelected = rows.length > 0 && rows.every((card) => selected.has(card.id));
  const now = Date.now();

  const row = (card: PipelineCard) => {
    const followUp = followUps?.get(card.id);
    return (
      <Tr
        key={card.id}
        className={cn(
          "group",
          // Archived rows come last, faded.
          card.archived && "opacity-55 hover:opacity-100",
          selected.has(card.id) && "bg-[var(--color-brand-soft)] hover:bg-[var(--color-brand-soft)]",
        )}
      >
        <Td className="w-9 pr-0">
          <SelectBox
            label={`Select ${card.name}`}
            checked={selected.has(card.id)}
            onChange={(checked) => {
              const next = new Set(selected);
              if (checked) next.add(card.id);
              else next.delete(card.id);
              onSelect(next);
            }}
          />
        </Td>
        <Td className="max-w-72 truncate">
          <RowLink href={`/deals/${encodeURIComponent(card.id)}`}>{card.name}</RowLink>
        </Td>
        <Td>
          <span className="flex items-center gap-1.5">
            <Dot color={colors.get(card.stageId)} />
            <Select
              aria-label={`Stage for ${card.name}`}
              value={card.stageId}
              disabled={card.archived}
              onChange={(event) => onMove(card, event.target.value)}
              // Reads as the stage name; the border shows on hover.
              className="-ml-1.5 h-7 max-w-60 cursor-pointer appearance-none truncate border-transparent bg-transparent px-1.5 text-[var(--color-heading)] hover:border-[var(--color-border-strong)] disabled:cursor-default disabled:opacity-100 disabled:hover:border-transparent"
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
            {card.archived ? <span className="text-xs text-[var(--color-faint)]">Archived</span> : null}
          </span>
        </Td>
        <Td numeric className="text-[var(--color-heading)]">
          {card.valueCents ? fmtCents(card.valueCents) : dash}
        </Td>
        <Td className="max-w-48 truncate">{card.source?.trim() || dash}</Td>
        <Td>
          <button
            type="button"
            onClick={() => onEditLabels(card)}
            aria-label={`Edit labels for ${card.name}`}
            className={cn(
              "flex max-w-56 items-center rounded outline-none focus-visible:shadow-[var(--focus-ring)]",
              // An empty cell offers "+ Label" on row hover (always on touch screens).
              !card.labels.length && "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            {card.labels.length ? (
              <LabelTags labels={card.labels} max={2} />
            ) : (
              <span className="text-xs text-[var(--color-faint)] hover:text-[var(--color-heading)]">+ Label</span>
            )}
          </button>
        </Td>
        <Td>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Initials name={card.salespersonName} />
            <span className={card.salespersonName ? undefined : "text-[var(--color-faint)]"}>
              {card.salespersonName ?? "Unassigned"}
            </span>
          </span>
        </Td>
        {followUps ? (
          <Td className="whitespace-nowrap text-[var(--tag-orange-text)]">
            {followUp ? (
              <>
                {followUp.reason}
                <span className="ml-1.5 tabular-nums text-[var(--color-muted)]">{followUpAge(followUp, now)}</span>
              </>
            ) : (
              dash
            )}
          </Td>
        ) : null}
        <Td numeric muted className="text-xs">
          {fmtDate(card.createdAt)}
        </Td>
        <Td numeric muted className="text-xs">
          {fmtRelativeTime(card.updatedAt)}
        </Td>
      </Tr>
    );
  };

  return (
    <TablePanel fill>
      <DataTable minWidth={followUps ? 1120 : 960}>
        <thead>
          <tr>
            <Th className="w-9 pr-0">
              <SelectBox
                label={`Select all ${noun}s`}
                checked={allSelected}
                indeterminate={!allSelected && rows.some((card) => selected.has(card.id))}
                onChange={(checked) => onSelect(checked ? new Set(rows.map((card) => card.id)) : new Set())}
              />
            </Th>
            {header("name", "Name")}
            {header("stage", "Stage")}
            {header("value", "Value", { numeric: true })}
            {header("source", "Source")}
            <Th>Labels</Th>
            {header("salesperson", "Salesperson")}
            {followUps ? <Th>Follow up</Th> : null}
            {header("created", "Created", { numeric: true })}
            {header("updated", "Updated", { numeric: true })}
          </tr>
        </thead>
        <tbody>
          {cards.slice(0, shown.open).map(row)}
          {cards.length > shown.open ? moreRow(cards.length - shown.open, () => more("open")) : null}
          {archivedCount !== 0 ? (
            <tr>
              <td colSpan={columns} className="px-2 py-1">
                <ArchivedToggle
                  count={archivedCount}
                  loading={archivedLoading && showArchived}
                  open={showArchived}
                  onToggle={onToggleArchived}
                  className="w-auto"
                />
              </td>
            </tr>
          ) : null}
          {showArchived ? archived.slice(0, shown.archived).map(row) : null}
          {showArchived && archived.length > shown.archived
            ? moreRow(archived.length - shown.archived, () => more("archived"))
            : null}
        </tbody>
      </DataTable>
      {cards.length || archivedCount !== 0 ? null : (
        <EmptyState>{filtered ? `No ${noun}s match this view.` : `No ${noun}s yet.`}</EmptyState>
      )}
    </TablePanel>
  );
}
