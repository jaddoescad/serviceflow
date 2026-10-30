import { inDateFilter, parseDateFilter, type DateFilter } from "@/lib/date-filter";
import type { PipelineCard, PipelineKey, PipelineStage } from "@/lib/pipeline-types";

/** Pipeline views: the filters, sort and Board/List choice a view applies.
 * Built-in views live here; saved ones are per manager (pipeline_views).
 * Client-safe. */

export type PipelineViewMode = "board" | "list";

export type PipelineSortKey =
  | "updated"
  | "created"
  | "name"
  | "stage"
  | "value"
  | "source"
  | "salesperson";

export type PipelineSort = { key: PipelineSortKey; desc: boolean };

export type PipelineFilters = {
  /** A source name, "No source", or "" for any. */
  source: string;
  /** A label id, or "" for any. */
  label: string;
  /** "me" (salesperson or project manager), "none", an employee id, or "". */
  salesperson: string;
  followUp: boolean;
  /** Days without a sent message or note before an open card needs follow-up. */
  followUpDays: number;
  created: DateFilter;
  updated: DateFilter;
  stageEntered: DateFilter;
};

export type PipelineViewConfig = {
  filters: PipelineFilters;
  sort: PipelineSort;
  /** Saved views remember Board/List; built-in views keep the current one. */
  mode?: PipelineViewMode;
};

export type SavedPipelineView = { id: string; name: string; config: PipelineViewConfig };
export type PipelineViewOption = SavedPipelineView & { builtIn: boolean };

export const FOLLOW_UP_DAY_OPTIONS = [3, 7, 14, 30] as const;

export const NO_FILTERS: PipelineFilters = {
  source: "",
  label: "",
  salesperson: "",
  followUp: false,
  followUpDays: 7,
  created: null,
  updated: null,
  stageEntered: null,
};

/** Column order, newest activity first inside a column (the board's order). */
export const DEFAULT_SORT: PipelineSort = { key: "stage", desc: false };

const view = (key: string, name: string, filters: Partial<PipelineFilters> = {}, extra: Partial<PipelineViewConfig> = {}): PipelineViewOption => ({
  id: key,
  name,
  builtIn: true,
  config: { filters: { ...NO_FILTERS, ...filters }, sort: DEFAULT_SORT, ...extra },
});

export function builtInViews(pipeline: PipelineKey): PipelineViewOption[] {
  const followUp = view(
    "follow-up",
    "Follow up",
    { followUp: true },
    { sort: { key: "updated", desc: false }, mode: "list" },
  );
  return pipeline === "sales"
    ? [
        view("all", "All deals"),
        view("mine", "My deals", { salesperson: "me" }),
        view("recent", "My recent leads", { salesperson: "me", created: { preset: "14d" } }),
        view("changed", "Recently changed", { updated: { preset: "7d" } }),
        followUp,
      ]
    : [
        view("all", "All jobs"),
        view("mine", "My jobs", { salesperson: "me" }),
        view("changed", "Recently changed", { updated: { preset: "7d" } }),
        followUp,
      ];
}

const SORT_KEYS: PipelineSortKey[] = ["updated", "created", "name", "stage", "value", "source", "salesperson"];

/** A stored config as a full PipelineViewConfig; unknown parts fall back to defaults. */
export function parseViewConfig(raw: unknown): PipelineViewConfig {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const filters = value.filters && typeof value.filters === "object" ? (value.filters as Record<string, unknown>) : {};
  const sort = value.sort && typeof value.sort === "object" ? (value.sort as Record<string, unknown>) : {};
  const text = (input: unknown) => (typeof input === "string" ? input.slice(0, 200) : "");
  const days = Number(filters.followUpDays);
  return {
    filters: {
      source: text(filters.source),
      label: text(filters.label),
      salesperson: text(filters.salesperson),
      followUp: filters.followUp === true,
      followUpDays: FOLLOW_UP_DAY_OPTIONS.includes(days as never) ? days : NO_FILTERS.followUpDays,
      created: parseDateFilter(filters.created),
      updated: parseDateFilter(filters.updated),
      stageEntered: parseDateFilter(filters.stageEntered),
    },
    sort: {
      key: SORT_KEYS.includes(sort.key as PipelineSortKey) ? (sort.key as PipelineSortKey) : DEFAULT_SORT.key,
      desc: typeof sort.desc === "boolean" ? sort.desc : DEFAULT_SORT.desc,
    },
    mode: value.mode === "list" || value.mode === "board" ? value.mode : undefined,
  };
}

/** Whether the current filters and sort (and Board/List, when the view sets
 * it) differ from the view's. */
export function viewChanged(viewConfig: PipelineViewConfig, current: PipelineViewConfig): boolean {
  const comparable = (config: PipelineViewConfig, mode: PipelineViewMode | undefined) =>
    JSON.stringify({ filters: config.filters, sort: config.sort, mode });
  return comparable(viewConfig, viewConfig.mode) !== comparable(current, viewConfig.mode ? current.mode : undefined);
}

export function activeFilterCount(filters: PipelineFilters): number {
  return [filters.source, filters.label, filters.salesperson, filters.followUp, filters.created, filters.updated, filters.stageEntered].filter(Boolean)
    .length;
}

export const sourceOf = (card: PipelineCard) => card.source?.trim() || "No source";

// Follow-up queue -------------------------------------------------------------

const DAY_MS = 86_400_000;

export type FollowUp = { reason: string; since: string };

const latest = (...values: Array<string | null>) =>
  values.reduce<string | null>((max, value) => (value && (!max || Date.parse(value) > Date.parse(max)) ? value : max), null);

/** Why an open card needs a follow-up, or null: a proposal sent 3+ days ago
 * and not opened, one viewed 7+ days ago and not accepted, or no sent message
 * or note for `days` days. */
export function followUpOf(card: PipelineCard, stage: PipelineStage | undefined, days: number, now = Date.now()): FollowUp | null {
  if (!stage || stage.isClosed) return null;
  if (card.quoteStatus === "sent") {
    if (!card.quoteViewedAt && card.quoteSentAt && now - Date.parse(card.quoteSentAt) >= 3 * DAY_MS)
      return { reason: "Proposal not viewed", since: card.quoteSentAt };
    if (card.quoteViewedAt && now - Date.parse(card.quoteViewedAt) >= 7 * DAY_MS)
      return { reason: "Viewed, not accepted", since: card.quoteViewedAt };
  }
  const touched = latest(card.lastTouchAt, card.quoteSentAt, card.createdAt)!;
  return now - Date.parse(touched) >= days * DAY_MS ? { reason: "No contact", since: touched } : null;
}

/** "4d" since a follow-up started. */
export function followUpAge(followUp: FollowUp, now = Date.now()): string {
  return `${Math.max(0, Math.floor((now - Date.parse(followUp.since)) / DAY_MS))}d`;
}

// Filtering and sorting -------------------------------------------------------

export type FilterContext = { userId: string; stages: Map<string, PipelineStage>; today: string; now: number };

export function matchesFilters(card: PipelineCard, filters: PipelineFilters, context: FilterContext): boolean {
  const { userId, stages, today, now } = context;
  if (filters.source && sourceOf(card) !== filters.source) return false;
  if (filters.label && !card.labels.some((label) => label.id === filters.label)) return false;
  if (filters.salesperson === "me" && card.salespersonId !== userId && card.projectManagerId !== userId) return false;
  if (filters.salesperson === "none" && card.salespersonId) return false;
  if (filters.salesperson && !["me", "none"].includes(filters.salesperson) && card.salespersonId !== filters.salesperson)
    return false;
  if (!inDateFilter(card.createdAt, filters.created, today)) return false;
  if (!inDateFilter(card.updatedAt, filters.updated, today)) return false;
  if (!inDateFilter(card.stageEnteredAt, filters.stageEntered, today)) return false;
  if (filters.followUp && !followUpOf(card, stages.get(card.stageId), filters.followUpDays, now)) return false;
  return true;
}

const collator = new Intl.Collator("en-CA", { sensitivity: "base", numeric: true });

export function sortCards(cards: PipelineCard[], sort: PipelineSort, stages: Map<string, PipelineStage>): PipelineCard[] {
  const time = (value: string | null) => (value ? Date.parse(value) : 0);
  const compare: Record<PipelineSortKey, (a: PipelineCard, b: PipelineCard) => number> = {
    updated: (a, b) => time(a.updatedAt) - time(b.updatedAt),
    created: (a, b) => time(a.createdAt) - time(b.createdAt),
    name: (a, b) => collator.compare(a.name, b.name),
    stage: (a, b) => (stages.get(a.stageId)?.position ?? 0) - (stages.get(b.stageId)?.position ?? 0),
    value: (a, b) => (a.valueCents ?? 0) - (b.valueCents ?? 0),
    source: (a, b) => collator.compare(sourceOf(a), sourceOf(b)),
    salesperson: (a, b) => collator.compare(a.salespersonName ?? "￿", b.salespersonName ?? "￿"),
  };
  const direction = sort.desc ? -1 : 1;
  return [...cards].sort(
    (a, b) => direction * compare[sort.key](a, b) || time(b.updatedAt) - time(a.updatedAt) || a.id.localeCompare(b.id),
  );
}
