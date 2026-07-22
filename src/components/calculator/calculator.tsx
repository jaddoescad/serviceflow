"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/kpi";
import { Select } from "@/components/ui";
import type { LabourBudgetTaskSelection } from "@/lib/actions/calculator";
import { fmtMoney } from "@/lib/format";
import {
  CATALOG_BY_ID,
  EXTERIOR_SECTION_LABELS,
  ExteriorSectionId,
  PAINT_TIER_LABELS,
  PaintTierId,
} from "@/lib/calculator/engine";
import { AddBar } from "./add-bar";
import { ExteriorCard, RoomCard, WashingCard } from "./cards";
import { ChatPanel } from "./chat-panel";
import { QuoteBar } from "./quote-bar";
import { RatesPanel } from "./rates-panel";
import { SummaryRail } from "./summary-rail";
import { useCalculator } from "./use-calculator";

const SECTION_ORDER: ExteriorSectionId[] = ["siding", "trim", "openings", "decks", "fences", "prep"];

const nameKey = (projectId: string) => `op-calculator-name:${projectId}`;

export function CalculatorPage({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string | null;
}) {
  const calc = useCalculator(projectId);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(projectName ?? "");

  // Remember the job name locally so revisits (without ?name=) keep the title.
  useEffect(() => {
    if (projectName) {
      setDisplayName(projectName);
      try {
        window.localStorage.setItem(nameKey(projectId), projectName);
      } catch {}
    } else {
      try {
        setDisplayName(window.localStorage.getItem(nameKey(projectId)) ?? "");
      } catch {}
    }
  }, [projectId, projectName]);

  const { doc, quote, totals, dispatch } = calc;

  const exteriorBySection = useMemo(() => {
    const groups = new Map<ExteriorSectionId, typeof quote.exterior>();
    for (const line of quote.exterior) {
      const item = CATALOG_BY_ID[line.itemId];
      if (!item) continue;
      const list = groups.get(item.section) ?? [];
      list.push(line);
      groups.set(item.section, list);
    }
    return groups;
  }, [quote.exterior]);

  const hasInterior = quote.rooms.length > 0;
  const hasExterior = quote.exterior.length > 0 || quote.washing !== "none";
  const isEmpty = !hasInterior && !hasExterior;
  const currentLabourTasks = useMemo(() => {
    const selection = calc.defaultCalculator;
    if (
      !selection ||
      selection.quoteId !== quote.id ||
      new Date(selection.sourceQuoteUpdatedAt).getTime() !== new Date(quote.updatedAt).getTime()
    ) {
      return new Map<string, LabourBudgetTaskSelection>();
    }
    return new Map(selection.tasks.map((task) => [`${task.sourceKind}:${task.sourceItemId}`, task]));
  }, [calc.defaultCalculator, quote.id, quote.updatedAt]);

  return (
    <div data-app-content="full-bleed" className="flex h-screen min-h-0 flex-col xl:flex-row">
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[1040px]">
          <div className="mb-2 text-xs text-[var(--color-muted)]">
            <Link href="/projects" className="hover:text-[var(--color-text)]">
              Jobs &amp; Budgets
            </Link>
            <span className="mx-1.5">/</span>
            <span>Calculator</span>
          </div>
          <PageHeader
            title={displayName || "Job calculator"}
            subtitle="Prices and the labour budget update as you type"
          />

          <QuoteBar
            doc={doc}
            defaultQuoteId={calc.defaultCalculator?.quoteId ?? null}
            onSwitch={calc.switchQuote}
            onAdd={calc.addQuote}
            onDuplicate={calc.duplicateQuote}
            onDelete={calc.deleteQuote}
            onRename={(name) => dispatch({ type: "renameQuote", name })}
            onStatus={(status) => dispatch({ type: "setStatus", status })}
          />

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
            <div className="min-w-0 space-y-7">
              <AddBar
                onAddRoom={(name) => setLastAddedId(calc.addRoom(name))}
                onAddExterior={(itemId) => {
                  if (itemId === "washing") {
                    if (quote.washing === "none") dispatch({ type: "setWashing", choice: "minimum" });
                    setLastAddedId(null);
                    return;
                  }
                  setLastAddedId(calc.addExteriorLine(itemId));
                }}
              />

              {calc.taskBudgetError ? (
                <p role="alert" className="-mt-5 text-xs leading-4 text-[var(--color-bad)]">
                  {calc.taskBudgetError}
                </p>
              ) : null}

              {isEmpty && calc.hydrated ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] px-6 py-14 text-center">
                  <p className="text-sm font-medium text-[var(--color-heading)]">Start with a room</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--color-muted)]">
                    Type a room name above — like <em>living room</em> — punch in the measurements, and the
                    price and labour budget appear on the right. Exterior work (siding, soffits, decks…) is in
                    the same box.
                  </p>
                </div>
              ) : null}

              {hasInterior ? (
                <section aria-label="Interior">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                        Interior
                      </h2>
                      <Select
                        value={quote.paintTier}
                        onChange={(e) => dispatch({ type: "setPaintTier", tier: e.target.value as PaintTierId })}
                        name="paint-tier"
                        aria-label="Paint line"
                        className="!py-1 text-xs"
                      >
                        {(Object.keys(PAINT_TIER_LABELS) as PaintTierId[]).map((tier) => (
                          <option key={tier} value={tier}>
                            {PAINT_TIER_LABELS[tier]} · ${quote.rates.interior.paintTiers[tier].toFixed(2)}/sqft
                          </option>
                        ))}
                      </Select>
                    </div>
                    <span className="text-sm font-medium tabular-nums text-[var(--color-muted)]">
                      {fmtMoney(totals.interior.total)}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {quote.rooms.map((room) => {
                      const labourTask = currentLabourTasks.get(`room:${room.id}`);
                      return (
                        <RoomCard
                          key={room.id}
                          room={room}
                          tier={quote.paintTier}
                          rates={quote.rates.interior}
                          autoFocus={room.id === lastAddedId}
                          labourTask={labourTask}
                          taskBudgetDisabled={calc.updatingTaskBudgetId !== null}
                          taskBudgetSaving={calc.updatingTaskBudgetId === labourTask?.id}
                          onTaskBudgetChange={calc.updateTaskBudgetHours}
                          onChange={(patch) => dispatch({ type: "updateRoom", roomId: room.id, patch })}
                          onRemove={() => dispatch({ type: "removeRoom", roomId: room.id })}
                          onDuplicate={() => dispatch({ type: "duplicateRoom", roomId: room.id })}
                        />
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {hasExterior ? (
                <section aria-label="Exterior">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      Exterior
                    </h2>
                    <span className="text-sm font-medium tabular-nums text-[var(--color-muted)]">
                      {fmtMoney(totals.exterior.client)}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {SECTION_ORDER.map((sectionId) => {
                      const lines = exteriorBySection.get(sectionId) ?? [];
                      const showWashing = sectionId === "prep" && quote.washing !== "none";
                      if (lines.length === 0 && !showWashing) return null;
                      return (
                        <div key={sectionId}>
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)] opacity-80">
                            {EXTERIOR_SECTION_LABELS[sectionId]}
                          </div>
                          <div className="space-y-3">
                            {lines.map((line) => {
                              const labourTask = currentLabourTasks.get(`exterior:${line.id}`);
                              return (
                                <ExteriorCard
                                  key={line.id}
                                  line={line}
                                  rates={quote.rates.exterior}
                                  autoFocus={line.id === lastAddedId}
                                  labourTask={labourTask}
                                  taskBudgetDisabled={calc.updatingTaskBudgetId !== null}
                                  taskBudgetSaving={calc.updatingTaskBudgetId === labourTask?.id}
                                  onTaskBudgetChange={calc.updateTaskBudgetHours}
                                  onChange={(patch) => dispatch({ type: "updateExteriorLine", lineId: line.id, patch })}
                                  onRemove={() => dispatch({ type: "removeExteriorLine", lineId: line.id })}
                                />
                              );
                            })}
                            {showWashing ? (
                              <WashingCard
                                choice={quote.washing}
                                rates={quote.rates.exterior}
                                labourTask={currentLabourTasks.get("washing:pressure-washing")}
                                taskBudgetDisabled={calc.updatingTaskBudgetId !== null}
                                taskBudgetSaving={
                                  calc.updatingTaskBudgetId === currentLabourTasks.get("washing:pressure-washing")?.id
                                }
                                onTaskBudgetChange={calc.updateTaskBudgetHours}
                                onChange={(choice) => dispatch({ type: "setWashing", choice })}
                                onRemove={() => dispatch({ type: "setWashing", choice: "none" })}
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {!isEmpty ? (
                <section aria-label="Quote notes">
                  <label className="block">
                    <span className="mb-2 block font-display text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      Quote notes
                    </span>
                    <textarea
                      value={quote.notes}
                      onChange={(e) => dispatch({ type: "setNotes", notes: e.target.value })}
                      name="quote-notes"
                      rows={3}
                      placeholder="Colours, access, scheduling, anything to remember about this quote…"
                      className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
                    />
                  </label>
                </section>
              ) : null}
            </div>

            <SummaryRail
              projectName={displayName || "Job"}
              quote={quote}
              totals={totals}
              syncStatus={calc.syncStatus}
              defaultCalculator={calc.defaultCalculator}
              defaultCalculatorError={calc.defaultCalculatorError}
              makingDefault={calc.makingDefault}
              onMakeDefault={calc.makeDefault}
              onEditRates={() => setRatesOpen(true)}
              onClear={() => dispatch({ type: "clear" })}
            />
          </div>
        </div>
      </div>

      {chatDrawerOpen ? (
        <div
          role="presentation"
          onClick={() => setChatDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] xl:hidden"
        />
      ) : null}

      <ChatPanel
        quote={quote}
        onOps={calc.applyOps}
        mobileOpen={chatDrawerOpen}
        onMobileClose={() => setChatDrawerOpen(false)}
      />

      {!chatDrawerOpen ? (
        <button
          type="button"
          aria-label="Open assistant"
          onClick={() => setChatDrawerOpen(true)}
          className="fixed bottom-5 right-5 z-40 grid h-12 w-12 place-items-center rounded-full bg-[var(--color-brand)] text-xl leading-none text-[var(--color-brand-ink)] shadow-lg transition-transform hover:scale-105 xl:hidden"
        >
          ✨
        </button>
      ) : null}

      {ratesOpen ? (
        <RatesPanel
          rates={quote.rates}
          onChange={(rates) => dispatch({ type: "setRates", rates })}
          onUseCompanyDefaults={calc.useCompanyDefaults}
          onSaveCompanyDefaults={calc.saveAsCompanyDefaults}
          onClose={() => setRatesOpen(false)}
        />
      ) : null}
    </div>
  );
}
