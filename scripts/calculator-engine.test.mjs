// Locks the calculator engine to the two source workbooks and covers the
// operations layer. Run with: npm run test:calculator
// (compiles src/lib/calculator/*.ts to .test-dist first — see package.json)
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RATES,
  baseRoomName,
  computeTotals,
  makeExteriorLine,
  makeQuote,
  makeRoom,
  priceExteriorLine,
  priceRoom,
  priceWashing,
  resolveRoomName,
  reviveProjectCalculator,
} from "../.test-dist/engine.js";
import { applyOp, bumpRates, parseRoomsText } from "../.test-dist/operations.js";
import { buildLabourBudgetDraft } from "../.test-dist/labour-budget.js";

const IR = DEFAULT_RATES.interior;
const ER = DEFAULT_RATES.exterior;
const room = (patch) => ({ id: "r", ...makeRoom("test"), ...patch });
const line = (itemId, patch) => ({ id: "l", ...makeExteriorLine(itemId), ...patch });
const close = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol, `got ${actual}, want ${expected}`);

// ---------------------------------------------------------------------------
// Interior — values from "_Interior Painting Calculator Assmaa.xlsx"
// ---------------------------------------------------------------------------

test("interior: ceiling-only rooms match the sheet (W2/X2, W20/X20)", () => {
  let p = priceRoom(room({ length: 16, width: 22, height: 8, walls: false, ceiling: true }), "duration", IR);
  close(p.total, 485.76);
  close(p.hours, 5.18144);
  p = priceRoom(room({ length: 37, width: 25, height: 8, walls: false, ceiling: true }), "duration", IR);
  close(p.total, 1276.5);
  close(p.hours, 13.616);
});

test("interior: full room combines walls, ceiling, doors, trim, crown", () => {
  const p = priceRoom(
    room({ length: 12, width: 14, height: 8, doors: 2, walls: true, ceiling: true, trim: true, trimCoats: 2, crown: true }),
    "duration",
    IR,
  );
  // walls 416×1.38 + ceiling 168×1.38 + doors 2×103.5 + trim 52×2.3×2 + crown 52×1.265
  close(p.total, 574.08 + 231.84 + 207 + 239.2 + 65.78, 1e-9);
  assert.equal(p.parts.thirdCoat, 0);
});

test("interior: plausible generated room rounds to the requested $1,220 target", () => {
  const p = priceRoom(
    room({
      length: 10,
      width: 21,
      height: 8,
      doors: 1,
      walls: true,
      ceiling: true,
      trim: true,
      trimCoats: 1,
    }),
    "duration",
    IR,
  );
  assert.equal(Math.round(p.total), 1220);
  assert.equal(Number(p.hours.toFixed(1)), 13);
});

test("interior: third coat is 35% of walls, opt-in", () => {
  const p = priceRoom(room({ length: 12, width: 14, height: 8, walls: true, ceiling: false, thirdCoat: true }), "duration", IR);
  close(p.parts.thirdCoat, 574.08 * 0.35, 1e-9);
});

test("interior: paint tiers and flat closets", () => {
  const hp = priceRoom(room({ length: 10, width: 10, height: 8, walls: true, ceiling: false }), "hp", IR);
  close(hp.parts.walls, 320 * 1.15, 1e-9);
  const closets = priceRoom(room({ length: 0, width: 0, height: 0, closets: 2, walls: false, ceiling: false }), "duration", IR);
  close(closets.total, 425.5, 1e-9);
});

// ---------------------------------------------------------------------------
// Exterior — values from "Exterior Painting Calculator.xlsx"
// ---------------------------------------------------------------------------

test("exterior: soffits line matches the sheet (G27/H27/I27/J27)", () => {
  const e = priceExteriorLine(line("soffits", { qty: 120, coats: 2 }), ER);
  close(e.hours, 2);
  close(e.labour, 80);
  close(e.materials, 46.92);
  close(e.cost, 126.92);
});

test("exterior: per-unit, prep, washing and fence lines", () => {
  close(priceExteriorLine(line("windowFrame", { qty: 5, coats: 2 }), ER).cost, 191.8928571);
  const prep = priceExteriorLine(line("prepMasking", { qty: 4 }), ER);
  close(prep.cost, 160);
  close(prep.hours, 4);
  close(priceWashing("minimum", ER).client, 199.98);
  const fence = priceExteriorLine(line("fenceSection", { qty: 10, coats: 2 }), ER);
  close(fence.hours, 15);
  close(fence.materials, 207);
});

test("whole estimate matches the sheet summary (H95/J95/J96/J97/J100/J101)", () => {
  const quote = makeQuote("t");
  quote.exterior = [
    line("soffits", { qty: 120, coats: 2 }),
    line("fascia", { qty: 120, coats: 2 }),
    line("windowFrame", { qty: 5, coats: 2 }),
    line("prepMasking", { qty: 4 }),
  ];
  const t = computeTotals(quote);
  close(t.exterior.cost, 621.7328571);
  close(t.exterior.client, 1243.465714);
  close(t.hst, 161.6505429);
  close(t.totalWithHst, 1405.116257);
  close(t.hours, 12.15);
  close(t.exterior.crewDays, 0.759375);
});

// ---------------------------------------------------------------------------
// Published painter task budget
// ---------------------------------------------------------------------------

test("labour budget: materializes rooms, exterior lines, and washing as tasks", () => {
  const quote = makeQuote("Selected option");
  quote.rooms = [
    room({
      id: "room-1",
      name: "Living room",
      length: 12,
      width: 14,
      height: 8,
      notes: "Repair the north wall first",
    }),
  ];
  quote.exterior = [line("soffits", { id: "line-1", qty: 120, coats: 2 })];
  quote.washing = "minimum";

  const draft = buildLabourBudgetDraft(quote);
  assert.equal(draft.tasks.length, 3);
  assert.deepEqual(
    draft.tasks.map((task) => [task.sourceKind, task.sourceItemId, task.title]),
    [
      ["room", "room-1", "Living room"],
      ["exterior", "line-1", "Soffits"],
      ["washing", "pressure-washing", "Pressure washing"],
    ],
  );
  assert.equal(draft.tasks[0].notes, "Repair the north wall first");
  assert.equal(draft.tasks[2].budgetedHours, 0);
  close(
    draft.totalBudgetedHours,
    draft.tasks[0].budgetedHours + draft.tasks[1].budgetedHours,
    1e-9,
  );
});

// ---------------------------------------------------------------------------
// Room numbering
// ---------------------------------------------------------------------------

test("room numbering: Bedroom → Bedroom 1/2/3", () => {
  assert.deepEqual(resolveRoomName("Bedroom", []), { name: "Bedroom", renames: [] });
  assert.deepEqual(resolveRoomName("Bedroom", [{ id: "a", name: "Bedroom" }]), {
    name: "Bedroom 2",
    renames: [{ id: "a", name: "Bedroom 1" }],
  });
  assert.deepEqual(
    resolveRoomName("Bedroom", [{ id: "a", name: "Bedroom 1" }, { id: "b", name: "Bedroom 2" }]),
    { name: "Bedroom 3", renames: [] },
  );
  assert.equal(resolveRoomName("bedroom", [{ id: "a", name: "Bedroom 1" }]).name, "bedroom 2");
  assert.deepEqual(resolveRoomName("Kitchen", [{ id: "a", name: "Bedroom 1" }]), { name: "Kitchen", renames: [] });
  assert.equal(baseRoomName("Bedroom 12"), "Bedroom");
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

test("ops: addRoom numbers repeats through the single mutation path", () => {
  let quote = makeQuote("t");
  quote = applyOp(quote, { type: "addRoom", name: "Bedroom" });
  quote = applyOp(quote, { type: "addRoom", name: "Bedroom" });
  quote = applyOp(quote, { type: "addRoom", name: "Bedroom" });
  assert.deepEqual(
    quote.rooms.map((r) => r.name),
    ["Bedroom 1", "Bedroom 2", "Bedroom 3"],
  );
});

test("ops: bumpRates scales interior prices and exterior client price exactly", () => {
  const bumped = bumpRates(DEFAULT_RATES, 5);
  close(bumped.interior.paintTiers.duration, 1.38 * 1.05, 1e-9);
  close(bumped.interior.door, 103.5 * 1.05, 1e-9);
  // hours follow price for interior, like the sheet
  const before = priceRoom(room({ length: 10, width: 10, height: 8 }), "duration", DEFAULT_RATES.interior);
  const after = priceRoom(room({ length: 10, width: 10, height: 8 }), "duration", bumped.interior);
  close(after.total, before.total * 1.05, 1e-9);
  // exterior: markup moves so every client price scales; costs stay truthful
  const lineBefore = priceExteriorLine(line("soffits", { qty: 120, coats: 2 }), DEFAULT_RATES.exterior);
  const lineAfter = priceExteriorLine(line("soffits", { qty: 120, coats: 2 }), bumped.exterior);
  close(lineAfter.client, lineBefore.client * 1.05, 1e-9);
  close(lineAfter.cost, lineBefore.cost, 1e-9);
});

test("ops: clear empties contents but keeps rates, name and status", () => {
  let quote = makeQuote("Option A");
  quote.status = "sent";
  quote = applyOp(quote, { type: "addRoom", name: "Kitchen" });
  quote = applyOp(quote, { type: "clear" });
  assert.equal(quote.rooms.length, 0);
  assert.equal(quote.name, "Option A");
  assert.equal(quote.status, "sent");
  close(quote.rates.interior.ceiling, 1.38, 1e-9);
});

// ---------------------------------------------------------------------------
// Measurement-message parser
// ---------------------------------------------------------------------------

test("parser: rooms, dims, trailing counts and flags", () => {
  const parsed = parseRoomsText("living room 16x22, master 15x25 with trim, 2 doors, basement 30x20x7 no ceiling");
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].name, "living room");
  assert.deepEqual([parsed[0].patch.length, parsed[0].patch.width], [16, 22]);
  assert.equal(parsed[1].name, "master");
  assert.equal(parsed[1].patch.trim, true);
  assert.equal(parsed[1].patch.doors, 2); // "2 doors" attaches to master
  assert.equal(parsed[2].name, "basement");
  assert.equal(parsed[2].patch.height, 7);
  assert.equal(parsed[2].patch.ceiling, false);
});

test("parser: run-on segments without commas split into separate rooms", () => {
  const parsed = parseRoomsText("a dining room 2x3x4 and a kitchen 3x4x6 only walls");
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "dining room");
  assert.deepEqual(
    [parsed[0].patch.length, parsed[0].patch.width, parsed[0].patch.height],
    [2, 3, 4],
  );
  assert.equal(parsed[1].name, "kitchen");
  assert.deepEqual(
    [parsed[1].patch.length, parsed[1].patch.width, parsed[1].patch.height],
    [3, 4, 6],
  );
  assert.equal(parsed[1].patch.ceiling, false); // "only walls" → no ceiling
  assert.equal(parsed[0].patch.ceiling, undefined); // first room untouched
});

test("parser: trailing flags stay with their room when splitting run-ons", () => {
  const parsed = parseRoomsText("living room 16x22 with trim and kitchen 10x10");
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "living room");
  assert.equal(parsed[0].patch.trim, true);
  assert.equal(parsed[1].name, "kitchen");
  assert.equal(parsed[1].patch.trim, undefined);
});

test("parser: singular wall-only phrases explicitly disable the ceiling", () => {
  for (const phrase of ["just wall", "only wall", "wall only"]) {
    const parsed = parseRoomsText(`office 12x10 ${phrase}`);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].patch.walls, true);
    assert.equal(parsed[0].patch.ceiling, false);
  }
});

test("parser feeds addRoomsFromText through ops", () => {
  let quote = makeQuote("t");
  quote = applyOp(quote, { type: "addRoomsFromText", text: "bedroom 12x11, bedroom 10x10" });
  assert.deepEqual(
    quote.rooms.map((r) => r.name),
    ["bedroom 1", "bedroom 2"],
  );
  close(computeTotals(quote).interior.total, priceRoom(quote.rooms[0], "duration", IR).total + priceRoom(quote.rooms[1], "duration", IR).total, 1e-9);
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

test("migration: v1 localStorage blob becomes a single-quote v2 document", () => {
  const v1 = {
    version: 1,
    updatedAt: "2026-07-17T20:00:00.000Z",
    paintTier: "superPaint",
    rooms: [{ id: "r1", ...makeRoom("Kitchen") }],
    exterior: [line("soffits", { qty: 120 })],
    washing: "minimum",
    rates: DEFAULT_RATES,
  };
  delete v1.rooms[0].notes; // old rooms had no notes field
  const doc = reviveProjectCalculator(v1);
  assert.equal(doc.version, 2);
  assert.equal(doc.quotes.length, 1);
  const q = doc.quotes[0];
  assert.equal(doc.activeQuoteId, q.id);
  assert.equal(q.name, "Quote 1");
  assert.equal(q.status, "draft");
  assert.equal(q.paintTier, "superPaint");
  assert.equal(q.rooms[0].notes, "");
  assert.equal(q.washing, "minimum");
});

test("migration: v2 documents round-trip", () => {
  let quote = makeQuote("Option A");
  quote = applyOp(quote, { type: "addRoom", name: "Kitchen" });
  const doc = { version: 2, activeQuoteId: quote.id, quotes: [quote] };
  const revived = reviveProjectCalculator(JSON.parse(JSON.stringify(doc)));
  assert.equal(revived.quotes[0].name, "Option A");
  assert.equal(revived.activeQuoteId, quote.id);
  assert.equal(revived.quotes[0].rooms[0].name, "Kitchen");
});

test("migration: legacy price adjustments are discarded", () => {
  const quote = makeQuote("Old quote");
  quote.rooms = [room({ length: 10, width: 10, height: 8 })];
  quote.adjustment = { mode: "amount", value: -150, label: "Discount" };
  const revived = reviveProjectCalculator({ version: 2, activeQuoteId: quote.id, quotes: [quote] });
  assert.equal("adjustment" in revived.quotes[0], false);
  close(
    computeTotals(revived.quotes[0]).price,
    priceRoom(quote.rooms[0], quote.paintTier, quote.rates.interior).total,
  );
});
