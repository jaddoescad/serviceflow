/** A priced line on a proposal, change order or invoice. Mirrors private.clean_line_items. */
export type LineItem = {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** Optional items count only when the customer selects them. */
  optional: boolean;
  selected: boolean;
  /**
   * A proposal package (Good / Better / Best) the line belongs to. Package
   * lines are stored as optional and are selected only in the chosen package.
   */
  packageId?: string | null;
};

/** A choice the customer makes on a proposal: exactly one package counts. */
export type ProposalPackage = {
  id: string;
  name: string;
  description: string;
};

/** A proposal-level discount, taken before tax: a percent or a fixed amount. */
export type Discount = { percent: number | null; cents: number | null };

export const NO_DISCOUNT: Discount = { percent: null, cents: null };

/** A saved product or service; adding one to a document copies it into a new line. */
export type CatalogItem = {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
};

type LineItemTotals = {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

type DocumentTotals = LineItemTotals & { discountCents: number };

/** Postgres rounds halves away from zero; Math.round rounds them up. */
function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function lineTotalCents(item: LineItem): number {
  return roundHalfAway(item.quantity * item.unitPriceCents);
}

/** Whether a line counts toward the total: required, or an optional item the customer chose. */
export function isIncluded(item: LineItem): boolean {
  return !item.optional || item.selected;
}

/** An optional add-on the customer can add or remove (not a package line). */
export function isAddOn(item: LineItem): boolean {
  return item.optional && !item.packageId;
}

/**
 * Subtotal, discount (never more than the subtotal), tax on what is left, and
 * total. Mirrors private.line_item_totals(items, tax_rate, discount_percent, discount_amount).
 */
export function documentTotals(
  items: LineItem[],
  taxRatePercent: number,
  discount: Discount = NO_DISCOUNT,
): DocumentTotals {
  const subtotalCents = items.filter(isIncluded).reduce((sum, item) => sum + lineTotalCents(item), 0);
  const requested =
    discount.cents != null
      ? discount.cents
      : roundHalfAway((subtotalCents * (discount.percent ?? 0)) / 100);
  const discountCents = Math.max(0, Math.min(subtotalCents, requested));
  const taxCents = roundHalfAway(((subtotalCents - discountCents) * taxRatePercent) / 100);
  return { subtotalCents, discountCents, taxCents, totalCents: subtotalCents - discountCents + taxCents };
}

/** Totals for change orders and invoices, which have no discount. */
export function lineItemTotals(items: LineItem[], taxRatePercent: number): LineItemTotals {
  const { subtotalCents, taxCents, totalCents } = documentTotals(items, taxRatePercent);
  return { subtotalCents, taxCents, totalCents };
}

/** The requested package when it exists, else the first one. Mirrors private.chosen_package. */
export function chosenPackageId(packages: ProposalPackage[], requested: string | null | undefined): string | null {
  return packages.find((item) => item.id === requested)?.id ?? packages[0]?.id ?? null;
}

/**
 * Keeps package lines consistent with the packages: a line in a package is
 * optional and selected only in the chosen package; a line whose package was
 * removed becomes a regular line. Mirrors private.clean_proposal_items.
 */
export function syncPackageItems(
  items: LineItem[],
  packages: ProposalPackage[],
  selectedPackageId: string | null,
): LineItem[] {
  const ids = new Set(packages.map((item) => item.id));
  return items.map((item) => {
    if (!item.packageId) return item;
    if (!ids.has(item.packageId)) {
      const { packageId: _removed, ...rest } = item;
      return { ...rest, optional: false, selected: true };
    }
    return { ...item, optional: true, selected: item.packageId === selectedPackageId };
  });
}

/** What one package adds before discount and tax. */
export function packageCents(items: LineItem[], packageId: string): number {
  return items.filter((item) => item.packageId === packageId).reduce((sum, item) => sum + lineTotalCents(item), 0);
}

export function depositCents(
  totalCents: number,
  deposit: { percent: number | null; cents: number | null },
): number {
  if (deposit.cents != null) return deposit.cents;
  if (deposit.percent != null) return roundHalfAway((totalCents * deposit.percent) / 100);
  return 0;
}

export function newLineItem(partial: Partial<LineItem> = {}): LineItem {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    quantity: 1,
    unitPriceCents: 0,
    optional: false,
    selected: true,
    ...partial,
  };
}

export function reviveLineItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const optional = item.optional === true;
    const packageId = typeof item.packageId === "string" && item.packageId ? item.packageId : null;
    return [
      {
        id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
        name: typeof item.name === "string" ? item.name : "",
        description: typeof item.description === "string" ? item.description : "",
        quantity: Number(item.quantity ?? 1) || 0,
        unitPriceCents: Number(item.unitPriceCents ?? 0) || 0,
        optional,
        selected: optional ? item.selected === true : true,
        ...(packageId ? { packageId } : {}),
      },
    ];
  });
}

export function revivePackages(raw: unknown): ProposalPackage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) return [];
    return [
      {
        id: item.id,
        name: typeof item.name === "string" ? item.name : "",
        description: typeof item.description === "string" ? item.description : "",
      },
    ];
  });
}

export function centsFromDollars(value: string): number {
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function fmtCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}
