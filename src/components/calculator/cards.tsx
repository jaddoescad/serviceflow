"use client";

import { cn } from "@/components/ui";
import type { LabourBudgetTaskSelection } from "@/lib/actions/calculator";
import { fmtMoney } from "@/lib/format";
import {
  CATALOG_BY_ID,
  ExteriorLine,
  ExteriorRates,
  InteriorRates,
  PaintTierId,
  Room,
  WashingChoice,
  priceExteriorLine,
  priceRoom,
  priceWashing,
} from "@/lib/calculator/engine";
import { Chip, CoatsStepper, DeleteButton, IconButton, NumField, fmtHoursShort } from "./bits";
import { LabourTaskBudgetField } from "./task-budget-field";

type TaskBudgetCardProps = {
  labourTask?: LabourBudgetTaskSelection;
  taskBudgetDisabled?: boolean;
  taskBudgetSaving?: boolean;
  onTaskBudgetChange?: (taskId: string, hours: number | null) => Promise<unknown>;
};

function CardShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      style={{ borderRadius: "var(--radius)", boxShadow: "var(--shadow)" }}
      className={cn("border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5", className)}
    >
      {children}
    </div>
  );
}

function BreakdownRow({ label, detail, amount }: { label: string; detail?: string; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-[var(--color-muted)]">
        {label}
        {detail ? <span className="ml-1.5 text-xs opacity-80">{detail}</span> : null}
      </span>
      <span className="tabular-nums">{fmtMoney(amount)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interior room card
// ---------------------------------------------------------------------------

export function RoomCard({
  room,
  tier,
  rates,
  autoFocus,
  onChange,
  onRemove,
  onDuplicate,
  labourTask,
  taskBudgetDisabled = false,
  taskBudgetSaving = false,
  onTaskBudgetChange,
}: {
  room: Room;
  tier: PaintTierId;
  rates: InteriorRates;
  autoFocus?: boolean;
  onChange: (patch: Partial<Room>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
} & TaskBudgetCardProps) {
  const p = priceRoom(room, tier, rates);

  const breakdown: Array<{ label: string; detail?: string; amount: number }> = [
    { label: "Walls", detail: p.wallArea ? `${Math.round(p.wallArea)} sqft` : undefined, amount: p.parts.walls },
    { label: "Third coat", amount: p.parts.thirdCoat },
    { label: "Ceiling", detail: p.ceilingArea ? `${Math.round(p.ceilingArea)} sqft` : undefined, amount: p.parts.ceiling },
    { label: "Popcorn ceiling", amount: p.parts.popcorn },
    { label: "Doors", amount: p.parts.doors },
    {
      label: "Trim",
      detail: room.trim ? `${Math.round(p.perimeter)} lf × ${room.trimCoats ?? 0} coat${(room.trimCoats ?? 0) === 1 ? "" : "s"}` : undefined,
      amount: p.parts.trim,
    },
    { label: "Crown molding", amount: p.parts.crown },
    { label: "Closets", amount: p.parts.closets },
  ].filter((row) => row.amount > 0);

  return (
    <CardShell>
      <div className="flex items-center gap-2">
        <div className="group/name flex min-w-0 flex-1 items-center gap-1">
          <input
            value={room.name}
            onChange={(e) => onChange({ name: e.target.value })}
            name="room-name"
            aria-label="Room name"
            title="Click to rename"
            className="-ml-1.5 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold text-[var(--color-heading)] outline-none transition-colors placeholder:font-normal placeholder:text-[var(--color-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg)] focus:border-[var(--color-brand)] focus:bg-[var(--color-bg)]"
            placeholder="Room name"
          />
          <span
            aria-hidden
            className="pointer-events-none shrink-0 text-xs text-[var(--color-muted)] opacity-40 transition-opacity group-focus-within/name:opacity-0 group-hover/name:opacity-100"
          >
            ✎
          </span>
        </div>
        {!labourTask ? (
          <span className="shrink-0 text-xs tabular-nums text-[var(--color-muted)]">{fmtHoursShort(p.hours)}</span>
        ) : null}
        <div className="flex shrink-0 items-center">
          <IconButton label="Duplicate room" onClick={onDuplicate}>
            ⧉
          </IconButton>
          <DeleteButton label="Remove room" onConfirm={onRemove} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex items-end gap-1.5">
          <NumField label="Length" value={room.length} onChange={(v) => onChange({ length: v })} autoFocus={autoFocus} />
          <span className="pb-2 text-xs text-[var(--color-muted)]">×</span>
          <NumField label="Width" value={room.width} onChange={(v) => onChange({ width: v })} />
          <span className="pb-2 text-xs text-[var(--color-muted)]">×</span>
          <NumField label="Height" value={room.height} onChange={(v) => onChange({ height: v })} suffix="ft" />
        </div>
        <NumField label="Doors" value={room.doors} onChange={(v) => onChange({ doors: v })} width="w-14" step="1" />
        <NumField label="Closets" value={room.closets} onChange={(v) => onChange({ closets: v })} width="w-14" step="1" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip on={room.walls} onClick={() => onChange({ walls: !room.walls })}>
          Walls
        </Chip>
        {room.walls ? (
          <Chip on={room.thirdCoat} onClick={() => onChange({ thirdCoat: !room.thirdCoat })}>
            3rd coat
          </Chip>
        ) : null}
        <Chip on={room.ceiling} onClick={() => onChange({ ceiling: !room.ceiling })}>
          Ceiling
        </Chip>
        <Chip on={room.popcorn} onClick={() => onChange({ popcorn: !room.popcorn })}>
          Popcorn
        </Chip>
        <Chip on={room.trim} onClick={() => onChange({ trim: !room.trim, trimCoats: room.trimCoats ?? 1 })}>
          Trim
        </Chip>
        {room.trim ? (
          <CoatsStepper value={room.trimCoats ?? 1} onChange={(trimCoats) => onChange({ trimCoats })} />
        ) : null}
        <Chip on={room.crown} onClick={() => onChange({ crown: !room.crown })}>
          Crown
        </Chip>
      </div>

      {labourTask && onTaskBudgetChange ? (
        <LabourTaskBudgetField
          key={`${labourTask.id}:${labourTask.budgetedHours}`}
          task={labourTask}
          disabled={taskBudgetDisabled}
          saving={taskBudgetSaving}
          onChange={onTaskBudgetChange}
        />
      ) : null}

      <textarea
        value={room.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        name="room-notes"
        rows={Math.min(3, Math.max(1, room.notes.split("\n").length))}
        placeholder="Notes — prep, colours, repairs…"
        className="mt-3 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
      />

      <div className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
        {breakdown.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            Enter measurements and toggle what&rsquo;s included to see prices.
          </p>
        ) : (
          <>
            {breakdown.map((row) => <BreakdownRow key={row.label} {...row} />)}
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] pt-2 text-sm font-semibold text-[var(--color-heading)]">
              <span>Total</span>
              <span className="tabular-nums">{fmtMoney(p.total)}</span>
            </div>
          </>
        )}
      </div>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Exterior line card
// ---------------------------------------------------------------------------

export function ExteriorCard({
  line,
  rates,
  autoFocus,
  onChange,
  onRemove,
  labourTask,
  taskBudgetDisabled = false,
  taskBudgetSaving = false,
  onTaskBudgetChange,
}: {
  line: ExteriorLine;
  rates: ExteriorRates;
  autoFocus?: boolean;
  onChange: (patch: Partial<ExteriorLine>) => void;
  onRemove: () => void;
} & TaskBudgetCardProps) {
  const item = CATALOG_BY_ID[line.itemId];
  if (!item) return null;
  const p = priceExteriorLine(line, rates);
  const isFence = item.id === "fenceSection";
  const isPrep = item.kind === "prepHour";

  const qtyLabel = isPrep ? "Hours" : item.unit === "sf" ? "Area" : item.unit === "lf" ? "Length" : isFence ? "Panels" : "Count";
  const qtySuffix = item.unit === "sf" ? "sqft" : item.unit === "lf" ? "lf" : item.unit === "hr" ? "hr" : undefined;

  return (
    <CardShell>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-heading)]">{item.label}</span>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-sm font-semibold tabular-nums text-[var(--color-heading)]">{fmtMoney(p.client)}</span>
          {p.hours > 0 && !labourTask ? (
            <span className="text-xs tabular-nums text-[var(--color-muted)]">{fmtHoursShort(p.hours)}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center">
          <DeleteButton label="Remove item" onConfirm={onRemove} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <NumField
          label={qtyLabel}
          value={line.qty}
          onChange={(v) => onChange({ qty: v })}
          suffix={qtySuffix}
          width="w-20"
          autoFocus={autoFocus}
        />
        {item.hasCoats ? (
          <NumField label="Coats" value={line.coats} onChange={(v) => onChange({ coats: v })} width="w-14" step="1" />
        ) : null}
        {isFence ? (
          <>
            <NumField label="Sqft / panel" value={line.sfPerPanel} onChange={(v) => onChange({ sfPerPanel: v })} width="w-16" />
            <NumField label="Hrs / panel" value={line.hrsPerPanel} onChange={(v) => onChange({ hrsPerPanel: v })} width="w-16" />
          </>
        ) : null}
      </div>

      {labourTask && onTaskBudgetChange ? (
        <LabourTaskBudgetField
          key={`${labourTask.id}:${labourTask.budgetedHours}`}
          task={labourTask}
          disabled={taskBudgetDisabled}
          saving={taskBudgetSaving}
          onChange={onTaskBudgetChange}
        />
      ) : null}

      <div className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
        <BreakdownRow label="Labour" detail={p.hours > 0 ? fmtHoursShort(p.hours) : undefined} amount={p.labour} />
        {p.materials > 0 ? <BreakdownRow label="Materials (incl. sundries)" amount={p.materials} /> : null}
        <BreakdownRow label={`Markup ${Math.round(rates.markup * 100)}%`} amount={p.client - p.cost} />
        <BreakdownRow label="Client price (pre-HST)" amount={p.client} />
      </div>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Pressure washing card (dropdown selection, like the sheet)
// ---------------------------------------------------------------------------

export function WashingCard({
  choice,
  rates,
  onChange,
  onRemove,
  labourTask,
  taskBudgetDisabled = false,
  taskBudgetSaving = false,
  onTaskBudgetChange,
}: {
  choice: WashingChoice;
  rates: ExteriorRates;
  onChange: (choice: WashingChoice) => void;
  onRemove: () => void;
} & TaskBudgetCardProps) {
  const p = priceWashing(choice, rates);
  const options: Array<{ id: WashingChoice; label: string }> = [
    { id: "minimum", label: `Minimum · ${fmtMoney(rates.washing.minimum)}` },
    { id: "big", label: `Big job · ${fmtMoney(rates.washing.big)}` },
  ];

  return (
    <CardShell>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-heading)]">
          Pressure washing
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-heading)]">{fmtMoney(p.client)}</span>
        <DeleteButton label="Remove pressure washing" onConfirm={onRemove} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Chip key={option.id} on={choice === option.id} onClick={() => onChange(option.id)}>
            {option.label}
          </Chip>
        ))}
      </div>
      {labourTask && onTaskBudgetChange ? (
        <LabourTaskBudgetField
          key={`${labourTask.id}:${labourTask.budgetedHours}`}
          task={labourTask}
          disabled={taskBudgetDisabled}
          saving={taskBudgetSaving}
          onChange={onTaskBudgetChange}
        />
      ) : null}
    </CardShell>
  );
}
