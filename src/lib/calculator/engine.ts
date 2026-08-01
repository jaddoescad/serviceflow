/**
 * Pricing engine for the project calculator.
 *
 * Ported from the two source workbooks:
 * - "_Interior Painting Calculator Assmaa.xlsx" — per-room L×W×H pricing,
 *   hours = price × labour% ÷ hourly rate.
 * - "Exterior Painting Calculator.xlsx" — production-rate line items,
 *   labour + materials → 100% markup → HST.
 *
 * All functions are pure; rates are passed in so each project can carry its
 * own copy (the spreadsheets were duplicated per client for the same reason).
 */

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export type PaintTierId = "hp" | "superPaint" | "duration";

export type InteriorRates = {
  /** $/sqft of wall, 2 coats, by paint line (sheet: AA2:AB4). */
  paintTiers: Record<PaintTierId, number>;
  ceiling: number; // $/sqft
  door: number; // $ each
  trimPerCoat: number; // $/lf per coat
  crown: number; // $/lf
  popcorn: number; // $/sqft of ceiling
  closet: number; // $ each, flat
  thirdCoatFactor: number; // extra, as a share of the wall price
  labourPercent: number; // share of price that is labour budget
  hourlyRate: number; // $/hr used to convert labour budget to hours
};

export type ExteriorRates = {
  labourRate: number; // $/hr internal cost
  markup: number; // e.g. 1 = 100%, applied to labour + materials
  hst: number; // e.g. 0.13
  sundries: number; // share of material cost (tape, cloths…)
  coverage: { paint: number; stain: number }; // sqft per gallon, 1 coat
  materialPrices: { paint: number; stain: number; solidStain: number }; // $/gal
  prep: { masking: number; sanding: number; other: number; setup: number }; // $/hr
  washing: { minimum: number; big: number }; // flat $
  /** Production rate per catalog item (sf/hr, lf/hr or hrs per unit). */
  production: Record<string, number>;
};

export type CalculatorRates = {
  /** Version of the company-default pricing schedule; quote snapshots may omit it. */
  companyDefaultsVersion?: number;
  interior: InteriorRates;
  exterior: ExteriorRates;
};

export const COMPANY_DEFAULTS_VERSION = 2;
export const INTERIOR_FUTURE_JOB_MULTIPLIER = 0.93;

const LEGACY_INTERIOR_DEFAULTS: InteriorRates = {
  paintTiers: { hp: 1.15, superPaint: 1.265, duration: 1.38 },
  ceiling: 1.38,
  door: 103.5,
  trimPerCoat: 2.3,
  crown: 1.265,
  popcorn: 8.625,
  closet: 212.75,
  thirdCoatFactor: 0.35,
  labourPercent: 0.4,
  hourlyRate: 37.5,
};

export const PAINT_TIER_LABELS: Record<PaintTierId, string> = {
  hp: "HP",
  superPaint: "SuperPaint",
  duration: "Duration",
};

// ---------------------------------------------------------------------------
// Exterior catalog (sections + per-item math shape, from the Estimate sheet)
// ---------------------------------------------------------------------------

export type ExteriorSectionId =
  | "siding"
  | "trim"
  | "openings"
  | "decks"
  | "fences"
  | "prep";

export const EXTERIOR_SECTION_LABELS: Record<ExteriorSectionId, string> = {
  siding: "Siding & walls",
  trim: "Trim, soffit & fascia",
  openings: "Doors & windows",
  decks: "Decks & railings",
  fences: "Fences",
  prep: "Prep, washing & setup",
};

type MaterialKind = "paint" | "stain" | "solidStain" | "none";

export type ExteriorCatalogItem = {
  id: string;
  section: ExteriorSectionId;
  label: string;
  unit: "sf" | "lf" | "each" | "pair" | "panel" | "hr";
  /**
   * perHour: qty ÷ production = hours (production in sf/hr or lf/hr)
   * perUnit: qty × production = hours (production in hrs each)
   * prepHour: qty is hours, priced at a prep $/hr rate
   */
  kind: "perHour" | "perUnit" | "prepHour";
  /** Coats apply to materials; hidden for prep lines. */
  hasCoats: boolean;
  /** sqft of material consumed per qty unit (sheet's hidden multiplier). */
  materialSfPerUnit: number;
  material: MaterialKind;
  prepRate?: keyof ExteriorRates["prep"];
  defaultProduction: number;
};

export const EXTERIOR_CATALOG: ExteriorCatalogItem[] = [
  { id: "woodSiding", section: "siding", label: "Wood siding", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "paint", defaultProduction: 120 },
  { id: "vinylSiding", section: "siding", label: "Vinyl siding", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "paint", defaultProduction: 150 },
  { id: "aluminumSiding", section: "siding", label: "Aluminum siding", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "paint", defaultProduction: 150 },
  { id: "stucco", section: "siding", label: "Stucco / parging", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "paint", defaultProduction: 100 },
  { id: "brick", section: "siding", label: "Brick (paint)", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "paint", defaultProduction: 100 },
  { id: "hardie", section: "siding", label: "Cement board (Hardie)", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "paint", defaultProduction: 100 },
  { id: "otherSiding", section: "siding", label: "Other wall surface", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "paint", defaultProduction: 200 },

  { id: "windowDoorTrim", section: "trim", label: "Window / door trim", unit: "lf", kind: "perHour", hasCoats: true, materialSfPerUnit: 0.7, material: "paint", defaultProduction: 40 },
  { id: "soffits", section: "trim", label: "Soffits", unit: "lf", kind: "perHour", hasCoats: true, materialSfPerUnit: 0.7, material: "paint", defaultProduction: 60 },
  { id: "fascia", section: "trim", label: "Fascia board", unit: "lf", kind: "perHour", hasCoats: true, materialSfPerUnit: 0.7, material: "paint", defaultProduction: 50 },
  { id: "gutters", section: "trim", label: "Eavestroughs (gutters)", unit: "lf", kind: "perHour", hasCoats: true, materialSfPerUnit: 0.7, material: "paint", defaultProduction: 55 },
  { id: "gableTrim", section: "trim", label: "Gable / corner trim", unit: "lf", kind: "perHour", hasCoats: true, materialSfPerUnit: 0.7, material: "paint", defaultProduction: 45 },
  { id: "otherTrim", section: "trim", label: "Other linear trim", unit: "lf", kind: "perHour", hasCoats: true, materialSfPerUnit: 0.7, material: "paint", defaultProduction: 40 },

  { id: "entryDoor", section: "openings", label: "Entry door", unit: "each", kind: "perUnit", hasCoats: true, materialSfPerUnit: 40, material: "paint", defaultProduction: 2.5 },
  { id: "garageSingle", section: "openings", label: "Garage door — single", unit: "each", kind: "perUnit", hasCoats: true, materialSfPerUnit: 60, material: "paint", defaultProduction: 4 },
  { id: "garageDouble", section: "openings", label: "Garage door — double", unit: "each", kind: "perUnit", hasCoats: true, materialSfPerUnit: 120, material: "paint", defaultProduction: 6 },
  { id: "windowFrame", section: "openings", label: "Window frame", unit: "each", kind: "perUnit", hasCoats: true, materialSfPerUnit: 15, material: "paint", defaultProduction: 0.75 },
  { id: "shutterPair", section: "openings", label: "Shutter pair", unit: "pair", kind: "perUnit", hasCoats: true, materialSfPerUnit: 20, material: "paint", defaultProduction: 0.5 },
  { id: "otherOpening", section: "openings", label: "Other door / window", unit: "each", kind: "perUnit", hasCoats: true, materialSfPerUnit: 25, material: "paint", defaultProduction: 1.5 },

  { id: "deckFloor", section: "decks", label: "Deck floor (stain)", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "stain", defaultProduction: 100 },
  { id: "deckRailing", section: "decks", label: "Deck railing (stain)", unit: "lf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1.5, material: "stain", defaultProduction: 25 },
  { id: "miscRailing", section: "decks", label: "Misc railing (paint)", unit: "lf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1.5, material: "paint", defaultProduction: 30 },
  { id: "otherDeck", section: "decks", label: "Other deck work", unit: "sf", kind: "perHour", hasCoats: true, materialSfPerUnit: 1, material: "stain", defaultProduction: 100 },

  { id: "fenceSection", section: "fences", label: "Fence section", unit: "panel", kind: "perUnit", hasCoats: true, materialSfPerUnit: 30, material: "solidStain", defaultProduction: 1.5 },

  { id: "prepMasking", section: "prep", label: "Masking / taping", unit: "hr", kind: "prepHour", hasCoats: false, materialSfPerUnit: 0, material: "none", prepRate: "masking", defaultProduction: 0 },
  { id: "prepSanding", section: "prep", label: "Sanding", unit: "hr", kind: "prepHour", hasCoats: false, materialSfPerUnit: 0, material: "none", prepRate: "sanding", defaultProduction: 0 },
  { id: "prepOther", section: "prep", label: "Other prep (caulk, repair…)", unit: "hr", kind: "prepHour", hasCoats: false, materialSfPerUnit: 0, material: "none", prepRate: "other", defaultProduction: 0 },
  { id: "setupCleanup", section: "prep", label: "Setup & cleanup", unit: "hr", kind: "prepHour", hasCoats: false, materialSfPerUnit: 0, material: "none", prepRate: "setup", defaultProduction: 0 },
];

export const CATALOG_BY_ID: Record<string, ExteriorCatalogItem> = Object.fromEntries(
  EXTERIOR_CATALOG.map((item) => [item.id, item]),
);

export const DEFAULT_RATES: CalculatorRates = {
  companyDefaultsVersion: COMPANY_DEFAULTS_VERSION,
  interior: {
    // Seven percent below the prior schedule for quotes created from v2 onward.
    paintTiers: { hp: 1.0695, superPaint: 1.17645, duration: 1.2834 },
    ceiling: 1.2834,
    door: 96.255,
    trimPerCoat: 2.139,
    crown: 1.17645,
    popcorn: 8.02125,
    closet: 197.8575,
    thirdCoatFactor: 0.35,
    labourPercent: 0.4,
    hourlyRate: 37.5,
  },
  exterior: {
    labourRate: 40,
    markup: 1,
    hst: 0.13,
    sundries: 0.15,
    coverage: { paint: 350, stain: 200 },
    materialPrices: { paint: 85, stain: 65, solidStain: 60 },
    prep: { masking: 40, sanding: 40, other: 45, setup: 40 },
    washing: { minimum: 99.99, big: 150 },
    production: Object.fromEntries(
      EXTERIOR_CATALOG.filter((i) => i.kind !== "prepHour").map((i) => [i.id, i.defaultProduction]),
    ),
  },
};

// ---------------------------------------------------------------------------
// Calculator state — a project holds quotes; a quote holds rooms + lines
// ---------------------------------------------------------------------------

export type Room = {
  id: string;
  name: string;
  length: number | null; // ft
  width: number | null; // ft
  height: number | null; // ft
  doors: number | null;
  closets: number | null;
  walls: boolean;
  ceiling: boolean;
  popcorn: boolean;
  crown: boolean;
  trim: boolean;
  trimCoats: number | null;
  thirdCoat: boolean;
  notes: string;
};

export type ExteriorLine = {
  id: string;
  itemId: string;
  qty: number | null;
  coats: number | null;
  /** Fence only: overridable per line, like the sheet's blue cells. */
  sfPerPanel: number | null;
  hrsPerPanel: number | null;
};

export type WashingChoice = "none" | "minimum" | "big";

export type QuoteStatus = "draft" | "sent" | "won" | "lost";

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
};

export type Quote = {
  id: string;
  name: string;
  status: QuoteStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  paintTier: PaintTierId;
  rooms: Room[];
  exterior: ExteriorLine[];
  washing: WashingChoice;
  /** Frozen snapshot taken from company defaults when the quote is created. */
  rates: CalculatorRates;
};

/** What gets persisted per project (localStorage now, one row later). */
export type ProjectCalculator = {
  version: 2;
  activeQuoteId: string;
  quotes: Quote[];
};

/** "Bedroom 2" → "Bedroom"; used so repeat picks and duplicates share one number series. */
export function baseRoomName(name: string): string {
  return name.trim().replace(/\s+\d+$/, "");
}

/**
 * Pick the name for a room being added: repeated names get numbered
 * ("Bedroom", then "Bedroom 1" + "Bedroom 2", …). If an existing room still
 * holds the plain un-numbered name, it is renamed to "… 1" via `renames`.
 */
export function resolveRoomName(
  requested: string,
  rooms: Array<Pick<Room, "id" | "name">>,
): { name: string; renames: Array<{ id: string; name: string }> } {
  const base = baseRoomName(requested) || "Room";
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+(\\d+))?$`, "i");

  const matches: Array<{ id: string; num: number | null }> = [];
  for (const room of rooms) {
    const m = room.name.trim().match(pattern);
    if (m) matches.push({ id: room.id, num: m[1] ? Number(m[1]) : null });
  }
  if (matches.length === 0) return { name: base, renames: [] };

  const used = matches.map((m) => m.num ?? 1);
  const next = Math.max(...used) + 1;
  const renames: Array<{ id: string; name: string }> = [];
  const oneTaken = matches.some((m) => m.num === 1);
  for (const m of matches) {
    if (m.num === null && !oneTaken) renames.push({ id: m.id, name: `${base} 1` });
  }
  return { name: `${base} ${next}`, renames };
}

export function makeRoom(name: string): Omit<Room, "id"> {
  return {
    name,
    length: null,
    width: null,
    height: 8,
    doors: null,
    closets: null,
    walls: true,
    ceiling: true,
    popcorn: false,
    crown: false,
    trim: false,
    trimCoats: 1,
    thirdCoat: false,
    notes: "",
  };
}

export function makeExteriorLine(itemId: string): Omit<ExteriorLine, "id"> {
  const item = CATALOG_BY_ID[itemId];
  return {
    itemId,
    qty: null,
    coats: item?.hasCoats ? 2 : null,
    sfPerPanel: itemId === "fenceSection" ? 30 : null,
    hrsPerPanel: itemId === "fenceSection" ? 1.5 : null,
  };
}

export function makeQuote(name: string, rates?: CalculatorRates): Quote {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    status: "draft",
    notes: "",
    createdAt: now,
    updatedAt: now,
    paintTier: "duration",
    rooms: [],
    exterior: [],
    washing: "none",
    rates: structuredClone(rates ?? DEFAULT_RATES),
  };
}

export function emptyProjectCalculator(rates?: CalculatorRates): ProjectCalculator {
  const quote = makeQuote("Quote 1", rates);
  return { version: 2, activeQuoteId: quote.id, quotes: [quote] };
}

// ---------------------------------------------------------------------------
// Interior math
// ---------------------------------------------------------------------------

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export type RoomPricing = {
  wallArea: number;
  ceilingArea: number;
  perimeter: number;
  parts: {
    walls: number;
    thirdCoat: number;
    ceiling: number;
    popcorn: number;
    doors: number;
    trim: number;
    crown: number;
    closets: number;
  };
  total: number;
  hours: number;
};

export function priceRoom(room: Room, tier: PaintTierId, rates: InteriorRates): RoomPricing {
  const L = n(room.length);
  const W = n(room.width);
  const H = n(room.height);

  const wallArea = room.walls ? 2 * H * (L + W) : 0;
  const ceilingArea = room.ceiling ? L * W : 0;
  const perimeter = 2 * (L + W);

  const walls = wallArea * rates.paintTiers[tier];
  const parts = {
    walls,
    thirdCoat: room.thirdCoat ? walls * rates.thirdCoatFactor : 0,
    ceiling: ceilingArea * rates.ceiling,
    popcorn: room.popcorn ? L * W * rates.popcorn : 0,
    doors: n(room.doors) * rates.door,
    trim: room.trim && n(room.trimCoats) > 0 ? perimeter * rates.trimPerCoat * n(room.trimCoats) : 0,
    crown: room.crown ? perimeter * rates.crown : 0,
    closets: n(room.closets) * rates.closet,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const hours = rates.hourlyRate > 0 ? (total * rates.labourPercent) / rates.hourlyRate : 0;
  return { wallArea, ceilingArea, perimeter, parts, total, hours };
}

// ---------------------------------------------------------------------------
// Exterior math
// ---------------------------------------------------------------------------

export type ExteriorLinePricing = {
  hours: number;
  labour: number;
  materials: number;
  cost: number;
  /** cost × (1 + markup) — what the client pays before HST. */
  client: number;
};

export function priceExteriorLine(line: ExteriorLine, rates: ExteriorRates): ExteriorLinePricing {
  const item = CATALOG_BY_ID[line.itemId];
  const zero: ExteriorLinePricing = { hours: 0, labour: 0, materials: 0, cost: 0, client: 0 };
  if (!item) return zero;

  const qty = n(line.qty);
  const coats = item.hasCoats ? n(line.coats) : 0;

  if (item.kind === "prepHour") {
    const rate = rates.prep[item.prepRate ?? "other"];
    const cost = qty * rate;
    return { hours: qty, labour: cost, materials: 0, cost, client: cost * (1 + rates.markup) };
  }

  const production =
    item.id === "fenceSection" ? n(line.hrsPerPanel) : rates.production[item.id] ?? item.defaultProduction;

  const hours = item.kind === "perUnit" ? qty * production : production > 0 ? qty / production : 0;
  const labour = hours * rates.labourRate;

  const sfPerUnit = item.id === "fenceSection" ? n(line.sfPerPanel) : item.materialSfPerUnit;
  const coverage = item.material === "paint" ? rates.coverage.paint : rates.coverage.stain;
  const pricePerGal =
    item.material === "paint"
      ? rates.materialPrices.paint
      : item.material === "stain"
        ? rates.materialPrices.stain
        : rates.materialPrices.solidStain;
  const gallons = coverage > 0 ? (qty * sfPerUnit * coats) / coverage : 0;
  const materials = gallons * pricePerGal * (1 + rates.sundries);

  const cost = labour + materials;
  return { hours, labour, materials, cost, client: cost * (1 + rates.markup) };
}

export function priceWashing(choice: WashingChoice, rates: ExteriorRates): ExteriorLinePricing {
  const cost = choice === "minimum" ? rates.washing.minimum : choice === "big" ? rates.washing.big : 0;
  return { hours: 0, labour: 0, materials: 0, cost, client: cost * (1 + rates.markup) };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type CalculatorTotals = {
  interior: {
    total: number;
    hours: number;
    parts: RoomPricing["parts"];
  };
  exterior: {
    cost: number;
    markupAmount: number;
    client: number;
    hours: number;
    crewDays: number;
  };
  /** Interior + exterior client price before HST. */
  price: number;
  hst: number;
  totalWithHst: number;
  hours: number;
};

export function computeTotals(state: Quote): CalculatorTotals {
  const interiorParts: RoomPricing["parts"] = {
    walls: 0,
    thirdCoat: 0,
    ceiling: 0,
    popcorn: 0,
    doors: 0,
    trim: 0,
    crown: 0,
    closets: 0,
  };
  let interiorTotal = 0;
  let interiorHours = 0;
  for (const room of state.rooms) {
    const p = priceRoom(room, state.paintTier, state.rates.interior);
    interiorTotal += p.total;
    interiorHours += p.hours;
    for (const key of Object.keys(interiorParts) as Array<keyof typeof interiorParts>) {
      interiorParts[key] += p.parts[key];
    }
  }

  let exteriorCost = 0;
  let exteriorHours = 0;
  for (const line of state.exterior) {
    const p = priceExteriorLine(line, state.rates.exterior);
    exteriorCost += p.cost;
    exteriorHours += p.hours;
  }
  exteriorCost += priceWashing(state.washing, state.rates.exterior).cost;

  const markupAmount = exteriorCost * state.rates.exterior.markup;
  const exteriorClient = exteriorCost + markupAmount;

  const price = interiorTotal + exteriorClient;
  const hst = price * state.rates.exterior.hst;

  return {
    interior: { total: interiorTotal, hours: interiorHours, parts: interiorParts },
    exterior: {
      cost: exteriorCost,
      markupAmount,
      client: exteriorClient,
      hours: exteriorHours,
      crewDays: exteriorHours / 16,
    },
    price,
    hst,
    totalWithHst: price + hst,
    hours: interiorHours + exteriorHours,
  };
}

// ---------------------------------------------------------------------------
// State (de)serialization — tolerant of older saves / added rate fields
// ---------------------------------------------------------------------------

export function mergeRates(saved: Partial<CalculatorRates> | undefined): CalculatorRates {
  const base = structuredClone(DEFAULT_RATES);
  if (!saved) return base;
  // Missing fields on a pre-v2 quote must inherit the schedule that existed
  // when that quote was created, not today's lower future-job defaults.
  if (saved.companyDefaultsVersion !== COMPANY_DEFAULTS_VERSION) {
    base.interior = structuredClone(LEGACY_INTERIOR_DEFAULTS);
  }
  return {
    companyDefaultsVersion: saved.companyDefaultsVersion,
    interior: {
      ...base.interior,
      ...saved.interior,
      paintTiers: { ...base.interior.paintTiers, ...saved.interior?.paintTiers },
    },
    exterior: {
      ...base.exterior,
      ...saved.exterior,
      coverage: { ...base.exterior.coverage, ...saved.exterior?.coverage },
      materialPrices: { ...base.exterior.materialPrices, ...saved.exterior?.materialPrices },
      prep: { ...base.exterior.prep, ...saved.exterior?.prep },
      washing: { ...base.exterior.washing, ...saved.exterior?.washing },
      production: { ...base.exterior.production, ...saved.exterior?.production },
    },
  };
}

/**
 * Upgrades the mutable company-default schedule exactly once. Existing quote
 * snapshots deliberately use mergeRates() instead, so their prices do not move.
 */
export function mergeCompanyRates(saved: Partial<CalculatorRates> | undefined): CalculatorRates {
  if (!saved) return structuredClone(DEFAULT_RATES);

  const merged = mergeRates(saved);
  if (saved.companyDefaultsVersion === COMPANY_DEFAULTS_VERSION) return merged;

  const interior = merged.interior;
  for (const tier of Object.keys(interior.paintTiers) as Array<keyof typeof interior.paintTiers>) {
    interior.paintTiers[tier] *= INTERIOR_FUTURE_JOB_MULTIPLIER;
  }
  for (const key of ["ceiling", "door", "trimPerCoat", "crown", "popcorn", "closet"] as const) {
    interior[key] *= INTERIOR_FUTURE_JOB_MULTIPLIER;
  }
  merged.companyDefaultsVersion = COMPANY_DEFAULTS_VERSION;
  return merged;
}

/** Revives one quote-shaped blob; also accepts the old v1 top-level state. */
export function reviveQuote(raw: unknown, fallbackName = "Quote 1"): Quote | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<Quote> & { updatedAt?: string };
  if (!Array.isArray(data.rooms) || !Array.isArray(data.exterior)) return null;
  const now = new Date().toISOString();
  return {
    id: typeof data.id === "string" ? data.id : crypto.randomUUID(),
    name: typeof data.name === "string" && data.name.trim() ? data.name : fallbackName,
    status: data.status === "sent" || data.status === "won" || data.status === "lost" ? data.status : "draft",
    notes: typeof data.notes === "string" ? data.notes : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now,
    paintTier: data.paintTier === "hp" || data.paintTier === "superPaint" ? data.paintTier : "duration",
    rooms: data.rooms.map((room) => ({ ...room, notes: typeof room.notes === "string" ? room.notes : "" })),
    exterior: data.exterior.filter((line) => CATALOG_BY_ID[line.itemId]),
    washing: data.washing === "minimum" || data.washing === "big" ? data.washing : "none",
    rates: mergeRates(data.rates),
  };
}

/** Revives a stored project document; silently upgrades v1 blobs to v2. */
export function reviveProjectCalculator(raw: unknown): ProjectCalculator | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { version?: number; quotes?: unknown[]; activeQuoteId?: string; rooms?: unknown };

  if (data.version === 2 && Array.isArray(data.quotes)) {
    const quotes = data.quotes
      .map((q, i) => reviveQuote(q, `Quote ${i + 1}`))
      .filter((q): q is Quote => q !== null);
    if (quotes.length === 0) return null;
    const activeQuoteId = quotes.some((q) => q.id === data.activeQuoteId)
      ? (data.activeQuoteId as string)
      : quotes[0].id;
    return { version: 2, activeQuoteId, quotes };
  }

  // v1: the whole blob was a single quote's contents.
  if (Array.isArray(data.rooms)) {
    const quote = reviveQuote(data, "Quote 1");
    if (!quote) return null;
    return { version: 2, activeQuoteId: quote.id, quotes: [quote] };
  }

  return null;
}
