/**
 * The single mutation path for a quote. The UI dispatches these ops; the
 * future CLI and OpenAI assistant will call the exact same functions, so
 * nothing can drift between the three.
 */
import {
  Adjustment,
  CalculatorRates,
  ExteriorLine,
  PaintTierId,
  Quote,
  QuoteStatus,
  Room,
  WashingChoice,
  baseRoomName,
  makeExteriorLine,
  makeRoom,
  resolveRoomName,
} from "./engine";

export type QuoteOp =
  | { type: "addRoom"; name: string; id?: string; patch?: Partial<Room> }
  | { type: "updateRoom"; roomId: string; patch: Partial<Room> }
  | { type: "removeRoom"; roomId: string }
  | { type: "duplicateRoom"; roomId: string; id?: string }
  | { type: "addExteriorLine"; itemId: string; id?: string; patch?: Partial<ExteriorLine> }
  | { type: "updateExteriorLine"; lineId: string; patch: Partial<ExteriorLine> }
  | { type: "removeExteriorLine"; lineId: string }
  | { type: "setWashing"; choice: WashingChoice }
  | { type: "setPaintTier"; tier: PaintTierId }
  | { type: "setRates"; rates: CalculatorRates }
  | { type: "bumpRates"; percent: number; scope?: "interior" | "exterior" | "all" }
  | { type: "setAdjustment"; adjustment: Adjustment | null }
  | { type: "setNotes"; notes: string }
  | { type: "setStatus"; status: QuoteStatus }
  | { type: "renameQuote"; name: string }
  | { type: "addRoomsFromText"; text: string }
  | { type: "clear" };

const newId = () => crypto.randomUUID();

function withRenames(rooms: Room[], renames: Array<{ id: string; name: string }>): Room[] {
  if (renames.length === 0) return rooms;
  const byId = new Map(renames.map((r) => [r.id, r.name]));
  return rooms.map((room) => (byId.has(room.id) ? { ...room, name: byId.get(room.id)! } : room));
}

function addRoomTo(quote: Quote, name: string, id?: string, patch?: Partial<Room>): Quote {
  const { name: finalName, renames } = resolveRoomName(name, quote.rooms);
  const room: Room = { id: id ?? newId(), ...makeRoom(finalName), ...patch, name: finalName };
  return { ...quote, rooms: [...withRenames(quote.rooms, renames), room] };
}

/**
 * Multiply client prices by (1 + percent/100).
 * Interior: every $-rate scales (hours follow price by design, like the sheet).
 * Exterior: the markup scales so each line's client price moves exactly by the
 * factor while internal costs (labour, materials) stay truthful.
 */
export function bumpRates(
  rates: CalculatorRates,
  percent: number,
  scope: "interior" | "exterior" | "all" = "all",
): CalculatorRates {
  const f = 1 + percent / 100;
  const next = structuredClone(rates);
  if (scope === "interior" || scope === "all") {
    const i = next.interior;
    for (const tier of Object.keys(i.paintTiers) as Array<keyof typeof i.paintTiers>) {
      i.paintTiers[tier] *= f;
    }
    i.ceiling *= f;
    i.door *= f;
    i.trimPerCoat *= f;
    i.crown *= f;
    i.popcorn *= f;
    i.closet *= f;
  }
  if (scope === "exterior" || scope === "all") {
    next.exterior.markup = (1 + next.exterior.markup) * f - 1;
  }
  return next;
}

const DIMS_SOURCE = "(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)(?:\\s*[x×]\\s*(\\d+(?:\\.\\d+)?))?";

/** Words that can trail a room's dimensions and still belong to that room. */
const TRAILING_TOKENS = new Set([
  "with", "trim", "crown", "popcorn", "only", "no", "walls", "wall",
  "ceiling", "ceilings", "3rd", "third", "coat", "coats",
  "door", "doors", "closet", "closets",
]);

/**
 * "dining room 2x3x4 and kitchen 3x4x6" (no comma) contains two rooms — split
 * a run-on segment after each dimension group, keeping trailing flag words
 * ("with trim", "2 doors") with the room they follow.
 */
function splitRunOnSegment(segment: string): string[] {
  const matches = [...segment.matchAll(new RegExp(DIMS_SOURCE, "gi"))];
  if (matches.length <= 1) return [segment];
  const parts: string[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    let end = (match.index ?? 0) + match[0].length;
    if (i < matches.length - 1) {
      const between = segment.slice(end, matches[i + 1].index);
      let consumed = 0;
      const tokenRe = /\s*(\S+)/g;
      let token: RegExpExecArray | null;
      while ((token = tokenRe.exec(between))) {
        const word = token[1].toLowerCase().replace(/[^a-z0-9]/g, "");
        if (TRAILING_TOKENS.has(word) || /^\d+$/.test(word)) consumed = tokenRe.lastIndex;
        else break;
      }
      end += consumed;
      parts.push(segment.slice(cursor, end));
      cursor = end;
    } else {
      parts.push(segment.slice(cursor));
    }
  }
  return parts;
}

/**
 * Deterministic parser for measurement messages, e.g.
 *   "living room 16x22, master 15x25 with trim, 2 doors, basement 30x20x7 no ceiling"
 * Segments split on commas/newlines (and run-on "X and Y" segments split at
 * each dimension group); a segment with only counts/flags (like "2 doors")
 * applies to the room before it.
 */
export function parseRoomsText(text: string): Array<{ name: string; patch: Partial<Room> }> {
  const out: Array<{ name: string; patch: Partial<Room> }> = [];
  const segments = text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap(splitRunOnSegment)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    let rest = segment;
    const patch: Partial<Room> = {};

    const dims = rest.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/i);
    if (dims) {
      patch.length = Number(dims[1]);
      patch.width = Number(dims[2]);
      if (dims[3]) patch.height = Number(dims[3]);
      rest = rest.replace(dims[0], " ");
    }

    const doors = rest.match(/(\d+)\s*doors?\b/i);
    if (doors) {
      patch.doors = Number(doors[1]);
      rest = rest.replace(doors[0], " ");
    }
    const closets = rest.match(/(\d+)\s*closets?\b/i);
    if (closets) {
      patch.closets = Number(closets[1]);
      rest = rest.replace(closets[0], " ");
    }

    const flag = (re: RegExp, apply: () => void) => {
      const m = rest.match(re);
      if (m) {
        apply();
        rest = rest.replace(m[0], " ");
      }
    };
    flag(/\b(?:only walls?|walls? only|just walls?)\b/i, () => {
      patch.walls = true;
      patch.ceiling = false;
    });
    flag(/\bno ceilings?\b/i, () => void (patch.ceiling = false));
    flag(/\bceilings? only\b/i, () => {
      patch.walls = false;
      patch.ceiling = true;
    });
    flag(/\bno walls\b/i, () => void (patch.walls = false));
    flag(/\bpopcorn\b/i, () => void (patch.popcorn = true));
    flag(/\bcrown\b/i, () => void (patch.crown = true));
    flag(/\b(?:3rd|third) coat\b/i, () => void (patch.thirdCoat = true));
    flag(/\btrim\b/i, () => {
      patch.trim = true;
      patch.trimCoats = patch.trimCoats ?? 1;
    });

    const name = rest
      .replace(/\bwith\b/gi, " ")
      .replace(/[^\p{L}\p{N}'’ -]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(?:and|&|also|then|plus|add)\s+/i, "")
      .replace(/^(?:a|an|the)\s+/i, "");

    if (!name && Object.keys(patch).length > 0 && out.length > 0) {
      // "…, 2 doors" — counts/flags only: attach to the previous room.
      out[out.length - 1].patch = { ...out[out.length - 1].patch, ...patch };
      continue;
    }
    if (!name && Object.keys(patch).length === 0) continue;
    out.push({ name: name || "Room", patch });
  }
  return out;
}

export function applyOp(quote: Quote, op: QuoteOp): Quote {
  const next = applyOpInner(quote, op);
  return next === quote ? quote : { ...next, updatedAt: new Date().toISOString() };
}

function applyOpInner(quote: Quote, op: QuoteOp): Quote {
  switch (op.type) {
    case "addRoom":
      return addRoomTo(quote, op.name, op.id, op.patch);

    case "updateRoom":
      return {
        ...quote,
        rooms: quote.rooms.map((room) => (room.id === op.roomId ? { ...room, ...op.patch } : room)),
      };

    case "removeRoom":
      return { ...quote, rooms: quote.rooms.filter((room) => room.id !== op.roomId) };

    case "duplicateRoom": {
      const source = quote.rooms.find((room) => room.id === op.roomId);
      if (!source) return quote;
      const { name, renames } = resolveRoomName(baseRoomName(source.name), quote.rooms);
      const copy: Room = { ...source, id: op.id ?? newId(), name };
      const rooms = withRenames(quote.rooms, renames);
      const index = rooms.findIndex((room) => room.id === op.roomId);
      rooms.splice(index + 1, 0, copy);
      return { ...quote, rooms };
    }

    case "addExteriorLine":
      return {
        ...quote,
        exterior: [...quote.exterior, { id: op.id ?? newId(), ...makeExteriorLine(op.itemId), ...op.patch }],
      };

    case "updateExteriorLine":
      return {
        ...quote,
        exterior: quote.exterior.map((line) => (line.id === op.lineId ? { ...line, ...op.patch } : line)),
      };

    case "removeExteriorLine":
      return { ...quote, exterior: quote.exterior.filter((line) => line.id !== op.lineId) };

    case "setWashing":
      return { ...quote, washing: op.choice };

    case "setPaintTier":
      return { ...quote, paintTier: op.tier };

    case "setRates":
      return { ...quote, rates: op.rates };

    case "bumpRates":
      return { ...quote, rates: bumpRates(quote.rates, op.percent, op.scope ?? "all") };

    case "setAdjustment":
      return { ...quote, adjustment: op.adjustment };

    case "setNotes":
      return { ...quote, notes: op.notes };

    case "setStatus":
      return { ...quote, status: op.status };

    case "renameQuote":
      return { ...quote, name: op.name };

    case "addRoomsFromText": {
      let next = quote;
      for (const { name, patch } of parseRoomsText(op.text)) {
        next = addRoomTo(next, name, undefined, patch);
      }
      return next;
    }

    case "clear":
      // Contents only — the rates snapshot, name, status and notes survive.
      return { ...quote, rooms: [], exterior: [], washing: "none", adjustment: null };
  }
}
