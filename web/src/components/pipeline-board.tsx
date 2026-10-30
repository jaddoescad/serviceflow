"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { TeamOption } from "@/lib/crm-types";
import { setDealDripsPaused } from "@/lib/actions/messaging";
import { getArchivedCards, setDealArchived } from "@/lib/actions/pipeline";
import { dayKey, fmtMoney, fmtRelativeTime } from "@/lib/format";
import { PIPELINE_TITLES, type PipelineBoard, type PipelineCard, type PipelineStage } from "@/lib/pipeline-types";
import {
  builtInViews,
  followUpAge,
  followUpOf,
  matchesFilters,
  sortCards,
  viewChanged,
  type FilterContext,
  type FollowUp,
  type PipelineSortKey,
  type PipelineViewConfig,
  type PipelineViewMode,
  type PipelineViewOption,
  type SavedPipelineView,
} from "@/lib/pipeline-views";
import type { ProjectLabel } from "@/lib/project-workspace";
import { BulkActions } from "./bulk-actions";
import { CreateWorkspaceProject } from "./create-workspace-project";
import { MessageCustomerDialog } from "./inbox/message-customer-dialog";
import { MoveDealDialog } from "./move-deal-dialog";
import { ReportPending } from "./navigation-pending";
import { PipelineFilterMenu } from "./pipeline-filter-menu";
import { PipelineList } from "./pipeline-list";
import { PipelineStagesEditor } from "./pipeline-stages-editor";
import { PipelineCardMenu, type CardMenuState } from "./pipeline-card-menu";
import {
  ArchivedToggle,
  CalendarIcon,
  Dot,
  Initials,
  LabelTags,
  MoreIcon,
  SearchIcon,
  fmtDay,
  stageColors,
} from "./pipeline-ui";
import { PipelineViewMenu } from "./pipeline-view-menu";
import { ProjectLabelPicker } from "./project-label-picker";
import { ShowMore } from "./show-more";
import { Button, Input, Segmented, cn } from "./ui";

export type { PipelineViewMode };

const dealHref = (card: PipelineCard) => `/deals/${encodeURIComponent(card.id)}`;
const stageValue = (cards: PipelineCard[]) => cards.reduce((sum, card) => sum + (card.valueCents ?? 0), 0);

function BoardCard({
  card,
  isSales,
  today,
  dragging,
  menuOpen,
  onDragStart,
  onDragEnd,
  onEditLabels,
  onMenu,
  followUp,
}: {
  card: PipelineCard;
  isSales: boolean;
  today: string;
  dragging: boolean;
  menuOpen: boolean;
  followUp?: FollowUp;
  onDragStart: () => void;
  onDragEnd: () => void;
  onEditLabels: () => void;
  onMenu: (anchor: DOMRect) => void;
}) {
  // Sales cards leave the amount to the deal page and list view.
  const value = !isSales && card.valueCents ? fmtMoney(card.valueCents / 100) : null;
  return (
    <article
      draggable={!card.archived}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", card.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative shrink-0 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-[border-color,box-shadow,opacity] hover:border-[var(--color-border-strong)] hover:shadow-[0_2px_6px_rgb(16_24_40/0.07)]",
        card.archived ? "opacity-55 hover:opacity-100" : "cursor-grab active:cursor-grabbing",
        dragging && "opacity-60 shadow-[var(--shadow-pop)]",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* The link covers the card, so the whole card opens the deal. */}
          <Link
            href={dealHref(card)}
            draggable={false}
            className="block truncate text-[13.5px] font-semibold leading-5 text-[var(--color-heading)] outline-none before:absolute before:inset-0 before:rounded-[inherit] focus-visible:before:shadow-[var(--focus-ring)]"
          >
            {card.name}
            <ReportPending href={dealHref(card)} />
          </Link>
          {card.source?.trim() ? (
            <p className="truncate text-[11px] leading-[14px] text-[var(--color-faint)]">{card.source.trim()}</p>
          ) : null}
        </div>
        <button
          type="button"
          data-card-menu
          aria-label={`Actions for ${card.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => onMenu(event.currentTarget.getBoundingClientRect())}
          className={cn(
            "relative z-10 -mr-1.5 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--color-faint)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]",
            menuOpen && "bg-[var(--color-hover)] text-[var(--color-heading)]",
          )}
        >
          <MoreIcon className="h-4 w-4" />
        </button>
      </div>

      {card.dateOn || value ? (
        <div className="mt-2.5 flex items-center gap-3 text-xs text-[var(--color-muted)]">
          {card.dateOn ? (
            <span className={cn("flex items-center gap-1.5", !card.archived && card.dateOn < today && "text-[var(--tag-red-text)]")}>
              <CalendarIcon className="h-3.5 w-3.5" />
              {fmtDay(card.dateOn)}
            </span>
          ) : null}
          {value ? <span className="ml-auto tabular-nums">{value}</span> : null}
        </div>
      ) : null}

      {followUp ? (
        <p className="mt-2 truncate text-xs text-[var(--tag-orange-text)]">
          {followUp.reason}
          <span className="ml-1.5 tabular-nums text-[var(--color-muted)]">{followUpAge(followUp)}</span>
        </p>
      ) : null}

      {card.labels.length ? (
        <button
          type="button"
          onClick={onEditLabels}
          aria-label={`Edit labels for ${card.name}`}
          className="relative z-10 mt-2.5 flex max-w-full text-left"
        >
          <LabelTags labels={card.labels} max={2} />
        </button>
      ) : null}

      <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--color-border)] pt-2.5 text-[11px] leading-4">
        <Initials name={card.salespersonName} className="h-4 w-4 text-[8px]" />
        <span className={cn("min-w-0 flex-1 truncate", card.salespersonName ? "text-[var(--color-text)]" : "text-[var(--color-faint)]")}>
          {card.salespersonName ?? "Unassigned"}
        </span>
        <span className="shrink-0 text-[var(--color-faint)]">Updated {fmtRelativeTime(card.updatedAt)}</span>
      </div>
    </article>
  );
}

/** Cards a column draws at first, and each time its end scrolls near. */
const PAGE = 30;

const viewHref = (pathname: string, viewId: string, mode: PipelineViewMode) => {
  const params = new URLSearchParams();
  if (viewId !== "all") params.set("v", viewId);
  if (mode === "list") params.set("view", "list");
  return `${pathname}${params.size ? `?${params}` : ""}`;
};

export function PipelineView({
  board,
  labels,
  savedViews,
  userId,
  team,
  viewId: initialViewId,
  view: initialMode,
}: {
  board: PipelineBoard;
  labels: ProjectLabel[];
  savedViews: SavedPipelineView[];
  userId: string;
  team: TeamOption[];
  viewId: string | null;
  view: PipelineViewMode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [views, setViews] = useState<PipelineViewOption[]>(() => [
    ...builtInViews(board.pipeline),
    ...savedViews.map((view) => ({ ...view, builtIn: false })),
  ]);
  const initialView = views.find((view) => view.id === initialViewId) ?? views[0]!;
  const [activeId, setActiveId] = useState(initialView.id);
  const [filters, setFilters] = useState(initialView.config.filters);
  const [sort, setSort] = useState(initialView.config.sort);
  const [mode, setMode] = useState<PipelineViewMode>(initialView.config.mode ?? initialMode);
  const [cards, setCards] = useState(board.cards);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<PipelineCard | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ card: PipelineCard; stageId: string } | null>(null);
  const [labelCard, setLabelCard] = useState<PipelineCard | null>(null);
  const [messageCard, setMessageCard] = useState<PipelineCard | null>(null);
  const [editingStages, setEditingStages] = useState(false);
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  // Archived deals stay hidden until their column's (or the list's) "Archived"
  // is opened, and load the first time one is.
  const [openArchives, setOpenArchives] = useState<Set<string>>(new Set());
  const [listArchived, setListArchived] = useState(false);
  const [archivedLoad, setArchivedLoad] = useState<"no" | "loading" | "yes">("no");
  // How many cards each column (and the list) draws so far; more draw on scroll.
  const [shown, setShown] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const closeMenu = useCallback(() => setMenu(null), []);

  // A refresh brings the open cards; archived ones loaded or archived here
  // stay, unless the refresh has them open again.
  useEffect(() => {
    setCards((current) => {
      const fresh = new Set(board.cards.map((card) => card.id));
      return [...board.cards, ...current.filter((card) => card.archived && !fresh.has(card.id))];
    });
  }, [board.cards]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const stages = board.stages;
  const stageById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const colors = useMemo(() => stageColors(stages), [stages]);
  const isSales = board.pipeline === "sales";
  const noun = isSales ? "deal" : "job";
  const today = dayKey(new Date());
  const context = useMemo<FilterContext>(
    () => ({ userId, stages: stageById, today: dayKey(new Date()), now: Date.now() }),
    // Recomputed with the cards, so "now" moves on after each refresh.
    [userId, stageById, cards],
  );
  const active = views.find((view) => view.id === activeId) ?? views[0]!;
  const current: PipelineViewConfig = { filters, sort, mode };
  const changed = viewChanged(active.config, current);
  const query = search.trim().toLocaleLowerCase("en-CA");
  const counts = useMemo(
    () =>
      new Map(
        views.map((view) => [
          view.id,
          cards.filter((card) => !card.archived && matchesFilters(card, view.config.filters, context)).length,
        ]),
      ),
    [views, cards, context],
  );
  const visibleCards = useMemo(
    () =>
      sortCards(
        cards.filter(
          (card) =>
            (!query ||
              [card.name, card.source, card.address, card.salespersonName, ...card.labels.map((label) => label.name)].some((value) =>
                value?.toLocaleLowerCase("en-CA").includes(query),
              )) &&
            matchesFilters(card, filters, context),
        ),
        sort,
        stageById,
      ),
    [cards, query, filters, context, sort, stageById],
  );
  const followUps = useMemo(
    () =>
      filters.followUp
        ? new Map(
            visibleCards.flatMap((card) => {
              const followUp = card.archived ? null : followUpOf(card, stageById.get(card.stageId), filters.followUpDays, context.now);
              return followUp ? [[card.id, followUp] as const] : [];
            }),
          )
        : null,
    [filters.followUp, filters.followUpDays, visibleCards, stageById, context.now],
  );
  // Archived cards go last: under each column's open cards, and after them in the list.
  const [openCards, archivedCards] = useMemo(
    () => [visibleCards.filter((card) => !card.archived), visibleCards.filter((card) => card.archived)],
    [visibleCards],
  );
  const byStage = useMemo(() => {
    const groups = new Map<string, { open: PipelineCard[]; archived: PipelineCard[] }>();
    for (const card of visibleCards) {
      const group = groups.get(card.stageId) ?? { open: [], archived: [] };
      (card.archived ? group.archived : group.open).push(card);
      groups.set(card.stageId, group);
    }
    return groups;
  }, [visibleCards]);
  const filtered = Boolean(query) || active.id !== "all" || changed;
  // Only rows still on screen stay selected.
  const selectedIds = (listArchived ? visibleCards : openCards)
    .filter((card) => selected.has(card.id))
    .map((card) => card.id);

  async function loadArchived() {
    if (archivedLoad !== "no") return;
    setArchivedLoad("loading");
    const result = await getArchivedCards(board.pipeline).catch(() => ({ cards: undefined, error: undefined }));
    const archived = result.cards;
    if (!archived) {
      setArchivedLoad("no");
      setError(result.error ?? "Could not load archived cards.");
      return;
    }
    const loaded = new Set(archived.map((card) => card.id));
    setCards((current) => [...current.filter((card) => !loaded.has(card.id)), ...archived]);
    setArchivedLoad("yes");
  }

  /** What an "Archived" shows: its cards once loaded, else the column's
   * count, which a filter would change, so none while one is on. */
  function archivedCount(loaded: number, total: number): number | null {
    return archivedLoad === "yes" ? loaded : filtered && total ? null : total;
  }

  function toggleArchive(stageId: string) {
    if (!openArchives.has(stageId)) void loadArchived();
    setOpenArchives((current) => {
      const next = new Set(current);
      if (!next.delete(stageId)) next.add(stageId);
      return next;
    });
  }

  const limit = (key: string) => shown[key] ?? PAGE;
  const showMore = (key: string) => setShown((current) => ({ ...current, [key]: (current[key] ?? PAGE) + PAGE }));

  function remember(viewId: string, nextMode: PipelineViewMode) {
    window.history.replaceState(null, "", viewHref(pathname, viewId, nextMode));
  }

  function selectView(view: PipelineViewOption) {
    const nextMode = view.config.mode ?? mode;
    setActiveId(view.id);
    setFilters(view.config.filters);
    setSort(view.config.sort);
    setMode(nextMode);
    setSelected(new Set());
    remember(view.id, nextMode);
  }

  function changeMode(next: PipelineViewMode) {
    setMode(next);
    remember(active.id, next);
  }

  function changeSort(key: PipelineSortKey) {
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: ["updated", "created", "value"].includes(key) },
    );
  }

  /** Every column change goes through the Move dialog. */
  function requestMove(card: PipelineCard, stageId: string) {
    if (!card.archived && stageId !== card.stageId) setMoving({ card, stageId });
  }

  function moved(cardId: string, stageId: string) {
    setMoving(null);
    setCards((current) => {
      const card = current.find((item) => item.id === cardId);
      if (!card) return current;
      const now = new Date().toISOString();
      return [{ ...card, stageId, updatedAt: now, stageEnteredAt: now }, ...current.filter((item) => item.id !== cardId)];
    });
    router.refresh();
  }

  function patchCard(cardId: string, patch: Partial<PipelineCard>) {
    setCards((current) => current.map((card) => (card.id === cardId ? { ...card, ...patch } : card)));
  }

  /** "Move to…" opens the Move dialog on the next column (the previous one from the last). */
  function moveFromMenu(card: PipelineCard) {
    closeMenu();
    const index = stages.findIndex((stage) => stage.id === card.stageId);
    const target = stages[index + 1] ?? stages[index - 1];
    if (target) setMoving({ card, stageId: target.id });
  }

  async function changeArchived(card: PipelineCard, archived: boolean) {
    closeMenu();
    setError("");
    patchCard(card.id, { archived, updatedAt: new Date().toISOString() });
    const result = await setDealArchived(card.id, archived).catch(() => ({ ok: false, error: undefined }));
    if (!result.ok) {
      patchCard(card.id, { archived: card.archived, updatedAt: card.updatedAt });
      setError(result.error ?? `Could not ${archived ? "archive" : "restore"} ${card.name}.`);
    }
    router.refresh();
  }

  async function changeDripsPaused(card: PipelineCard, dripsPaused: boolean) {
    closeMenu();
    setError("");
    patchCard(card.id, { dripsPaused });
    const result = await setDealDripsPaused(card.id, dripsPaused).catch(() => ({ ok: false, error: undefined }));
    if (!result.ok) {
      patchCard(card.id, { dripsPaused: card.dripsPaused });
      setError(result.error ?? `Could not ${dripsPaused ? "pause" : "resume"} drips for ${card.name}.`);
    }
  }

  function endDrag() {
    setDragging(null);
    setOver(null);
  }

  const dropHandlers = (stage: PipelineStage) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (over !== stage.id) setOver(stage.id);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      if (dragging) requestMove(dragging, stage.id);
      endDrag();
    },
  });

  return (
    <div data-app-content="full-bleed" className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col bg-[var(--color-bg)] md:h-dvh">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-[var(--gutter)] py-2.5">
        <div className="mr-auto flex min-w-0 items-center gap-1 pr-2">
          <h1 className="shrink-0 text-base font-semibold text-[var(--color-heading)]">{PIPELINE_TITLES[board.pipeline]}</h1>
          <span aria-hidden="true" className="pl-1 text-[var(--color-faint)]">
            /
          </span>
          <PipelineViewMenu
            pipeline={board.pipeline}
            views={views}
            active={active}
            config={current}
            changed={changed}
            counts={counts}
            onSelect={selectView}
            onSaved={(view) => {
              setViews((list) => {
                const others = list.filter((item) => item.id !== view.id);
                const saved = [...others.filter((item) => !item.builtIn), view].sort((a, b) => a.name.localeCompare(b.name));
                return [...others.filter((item) => item.builtIn), ...saved];
              });
              if (view.id !== activeId) selectView(view);
            }}
            onDeleted={(id) => {
              setViews((list) => list.filter((item) => item.id !== id));
              if (id === activeId) selectView(views[0]!);
            }}
          />
          <span className="ml-1 shrink-0 text-[13px] tabular-nums text-[var(--color-muted)]">
            {openCards.length.toLocaleString("en-CA")} {openCards.length === 1 ? noun : `${noun}s`}
            {isSales ? null : ` · ${fmtMoney(stageValue(openCards) / 100)}`}
          </span>
        </div>
        <div className="relative min-w-0 flex-1 basis-40 sm:w-52 sm:flex-none sm:basis-auto">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-faint)]" />
          <Input
            type="search"
            aria-label={`Search ${noun}s`}
            placeholder={`Search ${noun}s`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
        <PipelineFilterMenu cards={cards} filters={filters} noun={noun} onChange={setFilters} />
        <Segmented
          label="View"
          value={mode}
          options={[
            { value: "board", label: "Board" },
            { value: "list", label: "List" },
          ]}
          onChange={changeMode}
        />
        <Button variant="secondary" onClick={() => setEditingStages(true)}>
          Edit columns
        </Button>
        {isSales ? <CreateWorkspaceProject kind="lead" /> : null}
      </header>

      {mode === "board" ? (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-[var(--gutter)] pb-3 pt-3">
          <div className="flex h-full w-max gap-3">
            {stages.map((stage) => {
              const { open, archived } = byStage.get(stage.id) ?? { open: [], archived: [] };
              const dropTarget = over === stage.id && dragging?.stageId !== stage.id;
              const boardCard = (card: PipelineCard) => (
                <BoardCard
                  key={card.id}
                  card={card}
                  isSales={isSales}
                  today={today}
                  dragging={dragging?.id === card.id}
                  menuOpen={menu?.card.id === card.id}
                  onDragStart={() => {
                    closeMenu();
                    setDragging(card);
                  }}
                  onDragEnd={endDrag}
                  onEditLabels={() => setLabelCard(card)}
                  onMenu={(anchor) => setMenu((current) => (current?.card.id === card.id ? null : { card, anchor }))}
                  followUp={followUps?.get(card.id)}
                />
              );
              return (
                <section key={stage.id} aria-label={stage.name} {...dropHandlers(stage)} className="flex h-full w-[264px] shrink-0 flex-col">
                  <header className="flex h-8 items-center gap-2 px-1.5">
                    <Dot color={colors.get(stage.id)} />
                    <h2 className="min-w-0 truncate text-[13px] font-semibold text-[var(--color-heading)]">{stage.name}</h2>
                    <span className="text-xs tabular-nums text-[var(--color-faint)]">{open.length}</span>
                    {!isSales && stageValue(open) ? (
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-[var(--color-muted)]">
                        {fmtMoney(stageValue(open) / 100)}
                      </span>
                    ) : null}
                  </header>
                  <div
                    className={cn(
                      "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[var(--radius)] bg-[var(--color-surface-2)] p-2 pb-4 transition-colors",
                      dropTarget && "bg-[var(--color-brand-soft)] outline-1 -outline-offset-1 outline-dashed outline-[var(--color-brand)]",
                    )}
                  >
                    {open.slice(0, limit(stage.id)).map(boardCard)}
                    {open.length > limit(stage.id) ? (
                      <ShowMore count={open.length - limit(stage.id)} onMore={() => showMore(stage.id)} />
                    ) : null}
                    {!open.length ? (
                      <p className="py-8 text-center text-[13px] text-[var(--color-faint)]">
                        {filtered ? "No matches" : `No ${noun}s`}
                      </p>
                    ) : null}
                    {(archivedLoad === "yes" ? archived.length : stage.archivedCount) ? (
                      <>
                        <ArchivedToggle
                          count={archivedCount(archived.length, stage.archivedCount)}
                          loading={archivedLoad === "loading" && openArchives.has(stage.id)}
                          open={openArchives.has(stage.id)}
                          onToggle={() => toggleArchive(stage.id)}
                          className="mt-1"
                        />
                        {openArchives.has(stage.id) ? archived.slice(0, limit(`${stage.id}:archived`)).map(boardCard) : null}
                        {openArchives.has(stage.id) && archived.length > limit(`${stage.id}:archived`) ? (
                          <ShowMore
                            count={archived.length - limit(`${stage.id}:archived`)}
                            onMore={() => showMore(`${stage.id}:archived`)}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <PipelineList
          cards={openCards}
          archived={archivedCards}
          archivedCount={archivedCount(
            archivedCards.length,
            stages.reduce((total, stage) => total + stage.archivedCount, 0),
          )}
          archivedLoading={archivedLoad === "loading"}
          showArchived={listArchived}
          onToggleArchived={() => {
            if (!listArchived) void loadArchived();
            setListArchived(!listArchived);
          }}
          stages={stages}
          colors={colors}
          noun={noun}
          filtered={filtered}
          sort={sort}
          followUps={followUps}
          selected={selected}
          onSort={changeSort}
          onSelect={setSelected}
          onMove={requestMove}
          onEditLabels={setLabelCard}
        />
      )}

      {error ? (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[var(--radius)] bg-[var(--color-heading)] px-3 py-2 text-[13px] text-[var(--color-bg)] shadow-[var(--shadow-pop)]"
        >
          {error}
        </p>
      ) : null}
      {menu ? (
        <PipelineCardMenu
          menu={menu}
          isSales={isSales}
          onClose={closeMenu}
          onMove={moveFromMenu}
          onEditLabels={(card) => {
            closeMenu();
            setLabelCard(card);
          }}
          onDripsPaused={changeDripsPaused}
          onArchived={changeArchived}
          onMessage={(card) => {
            closeMenu();
            setMessageCard(card);
          }}
        />
      ) : null}
      {mode === "list" ? (
        <BulkActions
          selected={selectedIds.length}
          noun={noun}
          target={{ recordIds: selectedIds }}
          dealCount={null}
          team={team}
          labels={labels}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      {moving ? (
        <MoveDealDialog
          card={moving.card}
          stages={stages}
          initialStageId={moving.stageId}
          noun={noun}
          onClose={() => setMoving(null)}
          onMoved={(stageId) => moved(moving.card.id, stageId)}
        />
      ) : null}
      {labelCard ? (
        <ProjectLabelPicker
          projectId={labelCard.id}
          labels={labels}
          selectedIds={labelCard.labels.map((label) => label.id)}
          onClose={() => setLabelCard(null)}
        />
      ) : null}
      {messageCard ? <MessageCustomerDialog card={messageCard} onClose={() => setMessageCard(null)} /> : null}
      {editingStages ? (
        <PipelineStagesEditor pipeline={board.pipeline} stages={stages} onClose={() => setEditingStages(false)} />
      ) : null}
    </div>
  );
}
