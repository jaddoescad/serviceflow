import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Agent, MaxTurnsExceededError, run, tool } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  CATALOG_BY_ID,
  EXTERIOR_CATALOG,
  PAINT_TIER_LABELS,
  PaintTierId,
  Quote,
  QuoteStatus,
  Room,
  WashingChoice,
  computeTotals,
  priceRoom,
  reviveQuote,
} from "@/lib/calculator/engine";
import { QuoteOp, applyOp, parseRoomsText } from "@/lib/calculator/operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INSTRUCTIONS = `You are the estimating assistant inside Ottawa Painters' job calculator. You help fill out painting quotes fast.

Facts about the calculator:
- Interior rooms are priced from Length × Width × Height in FEET. Rooms with no requested surface scope default to walls + ceiling included, 8 ft height.
- Room price categories: walls (rate depends on paint tier: HP / SuperPaint / Duration), ceiling, popcorn ceiling, doors, trim (per coat), crown molding, closets, optional 3rd coat (+35% of walls).
- Interior formulas: walls = 2 × height × (length + width) × wall rate; ceiling = length × width × ceiling rate; trim = 2 × (length + width) × trim rate × trim coats; doors = door count × door rate.
- Labour hours = interior price × labour% ÷ hourly rate; exterior hours come from production rates.
- Exterior items: siding (sf), trim/soffits/fascia (lf), doors & windows (each), decks, fences (panels), prep (hours), pressure washing.

How to behave:
- Users type fast, on site, with typos ("kitchrn", "anf"). Fix obvious typos yourself: clean, capitalized room names ("Kitchen", "Dining room"), no leading articles ("a dining room" → "Dining room").
- For a handful of rooms, prefer one add_room call PER room with exact fields — never combine two rooms into one.
- add_room.surfaces is the COMPLETE, EXACT selection for that room. Never include an unrequested surface. "wall", "walls", "just wall", "only walls", and "walls only" mean ["walls"] — never include ceiling. When the user gives no surface scope at all, use ["walls", "ceiling"].
- Surface modifiers apply only to the room they follow.
- Use add_rooms_from_text only for long comma/line-separated lists (4+ rooms) with no typos.
- Use the other tools for targeted changes. Resolve rooms by their visible name (e.g. "Bedroom 2").
- When the user pastes proposal-style text, save that text as quote notes and translate its "Areas of Application" into the room's exact surfaces and door count.
- When the user explicitly says to make up, invent, estimate, or "make it work" with measurements, that is permission to choose plausible measurements. Do not ask for measurements. Prefer one ordinary 8 ft-high room unless the user specifies multiple rooms. A singular "Door" in an application list means 1 door.
- For a requested target price, calculate a plausible room from the current rates before calling a mutation tool. The displayed client price rounds to the nearest dollar, so a result that rounds to the requested whole-dollar target is a match. Make at most one measurement correction after reading the mutation result; never enter a trial-and-error loop.
- Never change rates or use a manual adjustment merely to hit a target price. Only do those when the user explicitly asks for a rate change, discount, amount off, or adjustment.
- Treat corrections such as "no, what I meant" as replacing the immediately preceding measurements you invented, not adding another option. Clear that invented room/item set before creating the corrected one.
- Every mutating tool that affects price returns the resulting summary. Read that result directly; do not call get_summary immediately afterward. Use get_summary only for a read-only question or when no mutation result contains the state you need.
- Check the mutation result matches the request (room count, names, exact surfaces, target price). If the one permitted correction still misses, explain the closest result instead of continuing to call tools.
- Confirm in ONE short sentence with the new client price (pre-HST) and labour hours. Never invent totals or hours — read them from a tool result.
- If a request is ambiguous or a tool reports an error, ask a brief clarifying question instead of guessing.
- Keep replies to one or two sentences. No markdown headers or bullet lists unless asked.`;

const roomFields = {
  length: z.number().nullable().describe("Length in feet"),
  width: z.number().nullable().describe("Width in feet"),
  height: z.number().nullable().describe("Height in feet (default 8)"),
  doors: z.number().nullable().describe("Number of doors to paint"),
  closets: z.number().nullable().describe("Number of closets"),
  walls: z.boolean().nullable().describe("Include walls"),
  ceiling: z.boolean().nullable().describe("Include ceiling"),
  popcorn: z.boolean().nullable().describe("Popcorn ceiling"),
  crown: z.boolean().nullable().describe("Crown molding"),
  trim: z.boolean().nullable().describe("Include trim/baseboards"),
  trimCoats: z.number().nullable().describe("Trim coats (1-3)"),
  thirdCoat: z.boolean().nullable().describe("Add third coat on walls (+35% of wall price)"),
  notes: z.string().nullable().describe("Room notes"),
};

const newRoomFields = {
  length: roomFields.length,
  width: roomFields.width,
  height: roomFields.height,
  doors: roomFields.doors,
  closets: roomFields.closets,
  surfaces: z
    .array(z.enum(["walls", "thirdCoat", "ceiling", "popcorn", "trim", "crown"]))
    .describe(
      'Complete exact list of selected surfaces. For "just wall"/"walls only", pass only ["walls"]. If no surface scope is given, pass ["walls", "ceiling"].',
    ),
  trimCoats: roomFields.trimCoats,
  notes: roomFields.notes,
};

function roomPatch(input: Record<string, unknown>): Partial<Room> {
  const patch: Partial<Room> = {};
  for (const key of Object.keys(roomFields) as Array<keyof typeof roomFields>) {
    const value = input[key];
    if (value !== null && value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  return patch;
}

function newRoomPatch(input: Record<string, unknown>): Partial<Room> {
  const patch = roomPatch(input);
  const surfaces = new Set(Array.isArray(input.surfaces) ? input.surfaces : []);
  patch.walls = surfaces.has("walls") || surfaces.has("thirdCoat");
  patch.thirdCoat = surfaces.has("thirdCoat");
  patch.ceiling = surfaces.has("ceiling");
  patch.popcorn = surfaces.has("popcorn");
  patch.trim = surfaces.has("trim");
  patch.crown = surfaces.has("crown");
  return patch;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data: profile } = await supabase
    .from("employee_profiles")
    .select("role,is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_active || !["admin", "manager"].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      ok: false,
      configured: false,
      error: "OPENAI_API_KEY is not set in .env.local.",
    });
  }

  let body: { messages?: Array<{ role: string; content: string }>; quote?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const quote = reviveQuote(body.quote);
  if (!quote) return NextResponse.json({ ok: false, error: "Invalid quote payload." }, { status: 400 });

  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-30);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ ok: false, error: "No user message." }, { status: 400 });
  }

  // The agent works on a copy of the quote; every change is recorded as an op
  // (with explicit ids) so the client can replay the identical mutations.
  let working = quote;
  const ops: QuoteOp[] = [];
  const record = (op: QuoteOp) => {
    working = applyOp(working, op);
    ops.push(op);
  };

  const summarize = () => {
    const totals = computeTotals(working);
    return JSON.stringify({
      quote: working.name,
      status: working.status,
      paintTier: PAINT_TIER_LABELS[working.paintTier],
      clientPricePreHst: Math.round(totals.price),
      hstIncludedTotal: Math.round(totals.totalWithHst),
      labourHours: Number(totals.hours.toFixed(1)),
      rooms: working.rooms.map((room) => {
        const p = priceRoom(room, working.paintTier, working.rates.interior);
        return {
          name: room.name,
          feet: `${room.length ?? "?"}x${room.width ?? "?"}x${room.height ?? "?"}`,
          included: [
            room.walls && "walls",
            room.thirdCoat && "3rd coat",
            room.ceiling && "ceiling",
            room.popcorn && "popcorn",
            room.trim && `trim×${room.trimCoats ?? 1}`,
            room.crown && "crown",
          ].filter(Boolean),
          doors: room.doors ?? 0,
          closets: room.closets ?? 0,
          price: Math.round(p.total),
          hours: Number(p.hours.toFixed(1)),
        };
      }),
      exterior: working.exterior.map((line) => ({
        item: CATALOG_BY_ID[line.itemId]?.label ?? line.itemId,
        qty: line.qty,
        coats: line.coats,
      })),
      pressureWashing: working.washing,
    });
  };

  const findRoom = (ref: string): { id: string } | { error: string } => {
    const q = ref.trim().toLowerCase();
    const rooms = working.rooms;
    const exact = rooms.filter((r) => r.name.trim().toLowerCase() === q);
    if (exact.length === 1) return { id: exact[0].id };
    const partial = rooms.filter((r) => r.name.toLowerCase().includes(q));
    if (partial.length === 1) return { id: partial[0].id };
    if (partial.length > 1) return { error: `Ambiguous — matches: ${partial.map((r) => r.name).join(", ")}` };
    return { error: `No room named "${ref}". Rooms: ${rooms.map((r) => r.name).join(", ") || "none"}` };
  };

  const findCatalogItem = (ref: string): { id: string } | { error: string } => {
    const q = ref.trim().toLowerCase();
    const hit =
      EXTERIOR_CATALOG.find((item) => item.label.toLowerCase() === q || item.id.toLowerCase() === q) ??
      EXTERIOR_CATALOG.find((item) => item.label.toLowerCase().includes(q));
    if (hit) return { id: hit.id };
    return {
      error: `Unknown exterior item "${ref}". Options: ${EXTERIOR_CATALOG.map((item) => item.label).join(", ")}`,
    };
  };

  const tools = [
    tool({
      name: "add_rooms_from_text",
      description:
        "Parse a free-form measurements message (e.g. 'living room 16x22, master 15x25 with trim, 2 doors') and add every room found.",
      parameters: z.object({ text: z.string() }),
      async execute({ text }) {
        const parsed = parseRoomsText(text);
        if (parsed.length === 0) return "No rooms found in that text.";
        for (const { name, patch } of parsed) {
          record({ type: "addRoom", name, id: randomUUID(), patch });
        }
        return `Added ${parsed.length} room(s). ${summarize()}`;
      },
    }),
    tool({
      name: "add_room",
      description:
        "Add one interior room. surfaces is the complete exact selection; never add surfaces the user did not request.",
      parameters: z.object({ name: z.string(), ...newRoomFields }),
      async execute(input) {
        record({ type: "addRoom", name: input.name, id: randomUUID(), patch: newRoomPatch(input) });
        return `Room added. ${summarize()}`;
      },
    }),
    tool({
      name: "update_room",
      description: "Update fields on an existing room, referenced by its visible name.",
      parameters: z.object({
        room: z.string().describe("Current room name, e.g. 'Bedroom 2'"),
        rename: z.string().nullable().describe("New name, or null to keep"),
        ...roomFields,
      }),
      async execute(input) {
        const found = findRoom(input.room);
        if ("error" in found) return found.error;
        const patch = roomPatch(input);
        if (input.rename) patch.name = input.rename;
        record({ type: "updateRoom", roomId: found.id, patch });
        return `Updated. ${summarize()}`;
      },
    }),
    tool({
      name: "remove_room",
      description: "Remove a room by its visible name.",
      parameters: z.object({ room: z.string() }),
      async execute({ room }) {
        const found = findRoom(room);
        if ("error" in found) return found.error;
        record({ type: "removeRoom", roomId: found.id });
        return `Removed. ${summarize()}`;
      },
    }),
    tool({
      name: "add_exterior_item",
      description:
        "Add an exterior line item (siding, soffits, fascia, gutters, doors, windows, deck, fence, prep hours…).",
      parameters: z.object({
        item: z.string().describe("Item name, e.g. 'soffits', 'vinyl siding', 'entry door'"),
        qty: z.number().nullable().describe("Quantity in the item's unit (sf, lf, each, panels, hours)"),
        coats: z.number().nullable(),
      }),
      async execute({ item, qty, coats }) {
        if (item.trim().toLowerCase().includes("washing")) {
          record({ type: "setWashing", choice: "minimum" });
          return `Pressure washing set to minimum. ${summarize()}`;
        }
        const found = findCatalogItem(item);
        if ("error" in found) return found.error;
        const patch: Record<string, unknown> = {};
        if (qty != null) patch.qty = qty;
        if (coats != null) patch.coats = coats;
        record({ type: "addExteriorLine", itemId: found.id, id: randomUUID(), patch });
        return `Added ${found.id}. ${summarize()}`;
      },
    }),
    tool({
      name: "set_washing",
      description: "Set pressure washing: none, minimum, or big.",
      parameters: z.object({ choice: z.enum(["none", "minimum", "big"]) }),
      async execute({ choice }) {
        record({ type: "setWashing", choice: choice as WashingChoice });
        return `Washing: ${choice}. ${summarize()}`;
      },
    }),
    tool({
      name: "set_paint_tier",
      description: "Choose the interior wall paint line: hp, superPaint, or duration.",
      parameters: z.object({ tier: z.enum(["hp", "superPaint", "duration"]) }),
      async execute({ tier }) {
        record({ type: "setPaintTier", tier: tier as PaintTierId });
        return `Paint tier: ${tier}. ${summarize()}`;
      },
    }),
    tool({
      name: "bump_prices",
      description:
        "Raise or lower this quote's prices by a percentage (e.g. 5 = +5%, -10 = -10%). Interior rates scale directly; exterior markup scales so client prices move exactly.",
      parameters: z.object({
        percent: z.number(),
        scope: z.enum(["interior", "exterior", "all"]).nullable(),
      }),
      async execute({ percent, scope }) {
        record({ type: "bumpRates", percent, scope: scope ?? "all" });
        return `Rates bumped ${percent}% (${scope ?? "all"}). ${summarize()}`;
      },
    }),
    tool({
      name: "set_status",
      description: "Set the quote status: draft, sent, won, or lost.",
      parameters: z.object({ status: z.enum(["draft", "sent", "won", "lost"]) }),
      async execute({ status }) {
        record({ type: "setStatus", status: status as QuoteStatus });
        return `Status: ${status}.`;
      },
    }),
    tool({
      name: "set_notes",
      description: "Replace the quote-level notes.",
      parameters: z.object({ notes: z.string() }),
      async execute({ notes }) {
        record({ type: "setNotes", notes });
        return "Notes saved.";
      },
    }),
    tool({
      name: "clear_quote",
      description: "Remove every room and exterior item from this quote (rates and name survive).",
      parameters: z.object({}),
      async execute() {
        record({ type: "clear" });
        return `Cleared. ${summarize()}`;
      },
    }),
    tool({
      name: "get_summary",
      description: "Read the current quote: rooms, exterior items, prices, labour hours.",
      parameters: z.object({}),
      async execute() {
        return summarize();
      },
    }),
  ];

  // The browser sends the live quote separately from chat history. Put the
  // relevant state and exact rates in model context so target-price requests
  // can be calculated before the model mutates the quote.
  const instructions = `${INSTRUCTIONS}

Current calculator context at the start of this request:
${summarize()}

Current exact interior rates used by the formulas above:
${JSON.stringify(working.rates.interior)}`;

  const agent = new Agent({
    name: "Calculator assistant",
    instructions,
    model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
    tools,
  });

  const input = history.map((m) =>
    m.role === "user"
      ? ({ role: "user", content: m.content } as AgentInputItem)
      : ({
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: m.content }],
        } as AgentInputItem),
  );

  try {
    const result = await run(agent, input, { stream: true, maxTurns: 8 });
    const encoder = new TextEncoder();
    // ndjson stream: {kind:"tool"} lines as the agent works, one {kind:"final"}
    // (or {kind:"error"}) line at the end carrying the reply text and the ops.
    const body = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        try {
          for await (const event of result) {
            if (event.type === "run_item_stream_event" && event.name === "tool_called") {
              const raw = (event.item as { rawItem?: { name?: string; arguments?: string } }).rawItem;
              send({ kind: "tool", label: toolLabel(raw?.name, raw?.arguments) });
            }
          }
          await result.completed;
          send({ kind: "final", text: result.finalOutput ?? "Done.", ops });
        } catch (error) {
          if (error instanceof MaxTurnsExceededError) {
            // `working` is only a server-side copy. Do not send its partial ops
            // when the run did not complete successfully.
            send({
              kind: "final",
              text: "I couldn't safely finish that estimate, so I left the calculator unchanged. Please retry with the target price and painting areas in one message.",
              ops: [],
            });
          } else {
            send({ kind: "error", error: error instanceof Error ? error.message : "Assistant request failed." });
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Assistant request failed.",
    });
  }
}

function toolLabel(name: string | undefined, argsJson: string | undefined): string {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {}
  switch (name) {
    case "add_rooms_from_text":
      return "Parsing measurements";
    case "add_room":
      return `Adding ${args.name ?? "room"}`;
    case "update_room":
      return `Updating ${args.room ?? "room"}`;
    case "remove_room":
      return `Removing ${args.room ?? "room"}`;
    case "add_exterior_item":
      return `Adding ${args.item ?? "exterior item"}`;
    case "set_washing":
      return "Setting pressure washing";
    case "set_paint_tier":
      return `Switching paint tier`;
    case "bump_prices":
      return `Adjusting rates ${args.percent ?? ""}%`;
    case "set_status":
      return `Marking ${args.status ?? "status"}`;
    case "set_notes":
      return "Saving notes";
    case "clear_quote":
      return "Clearing quote";
    case "get_summary":
      return "Checking totals";
    default:
      return name ?? "Working";
  }
}
