import {
  CATALOG_BY_ID,
  Quote,
  priceExteriorLine,
  priceRoom,
} from "./engine";

export type LabourBudgetTaskKind = "room" | "exterior" | "washing" | "custom";

export type LabourBudgetTaskDraft = {
  sourceKind: LabourBudgetTaskKind;
  sourceItemId: string;
  title: string;
  notes: string | null;
  budgetedHours: number;
  sortOrder: number;
  /** Painter-safe scope details only. Pricing and internal rates stay private. */
  metadata: Record<string, unknown>;
};

export type LabourBudgetDraft = {
  tasks: LabourBudgetTaskDraft[];
  totalBudgetedHours: number;
};

const roundHours = (value: number) =>
  Math.round((Number.isFinite(value) ? Math.max(0, value) : 0) * 100) / 100;

function roomScope(room: Quote["rooms"][number]): string[] {
  const scope: string[] = [];
  if (room.walls) scope.push("walls");
  if (room.ceiling) scope.push("ceiling");
  if (room.popcorn) scope.push("popcorn removal");
  if (room.trim) scope.push("trim");
  if (room.crown) scope.push("crown moulding");
  if (room.thirdCoat) scope.push("third coat");
  if ((room.doors ?? 0) > 0) scope.push("doors");
  if ((room.closets ?? 0) > 0) scope.push("closets");
  return scope;
}

/**
 * Turns the chosen calculator quote into a stable, painter-safe task snapshot.
 * A room is one task and an exterior calculator line is one task, matching the
 * units managers already see in the calculator's expected-hours summary.
 */
export function buildLabourBudgetDraft(quote: Quote): LabourBudgetDraft {
  const tasks: LabourBudgetTaskDraft[] = [];
  let sortOrder = 0;

  quote.rooms.forEach((room, index) => {
    const pricing = priceRoom(room, quote.paintTier, quote.rates.interior);
    tasks.push({
      sourceKind: "room",
      sourceItemId: room.id || `room-${index + 1}`,
      title: room.name.trim() || `Room ${index + 1}`,
      notes: room.notes.trim() || null,
      budgetedHours: roundHours(pricing.hours),
      sortOrder: sortOrder++,
      metadata: {
        section: "interior",
        dimensionsFeet: {
          length: room.length,
          width: room.width,
          height: room.height,
        },
        scope: roomScope(room),
        doors: room.doors,
        closets: room.closets,
        trimCoats: room.trim ? room.trimCoats : null,
        paintTier: quote.paintTier,
      },
    });
  });

  quote.exterior.forEach((line, index) => {
    const item = CATALOG_BY_ID[line.itemId];
    if (!item) return;
    const pricing = priceExteriorLine(line, quote.rates.exterior);
    tasks.push({
      sourceKind: "exterior",
      sourceItemId: line.id || `exterior-${index + 1}`,
      title: item.label,
      notes: null,
      budgetedHours: roundHours(pricing.hours),
      sortOrder: sortOrder++,
      metadata: {
        section: item.section,
        calculatorItemId: item.id,
        quantity: line.qty,
        unit: item.unit,
        coats: item.hasCoats ? line.coats : null,
        squareFeetPerPanel: item.id === "fenceSection" ? line.sfPerPanel : null,
      },
    });
  });

  if (quote.washing !== "none") {
    tasks.push({
      sourceKind: "washing",
      sourceItemId: "pressure-washing",
      title: quote.washing === "big" ? "Pressure washing — large job" : "Pressure washing",
      notes: null,
      // The current calculator prices washing as a flat charge and does not
      // assign production hours, so it remains a zero-hour checklist task.
      budgetedHours: 0,
      sortOrder: sortOrder++,
      metadata: { section: "prep", choice: quote.washing },
    });
  }

  return {
    tasks,
    totalBudgetedHours: roundHours(
      tasks.reduce((total, task) => total + task.budgetedHours, 0),
    ),
  };
}
