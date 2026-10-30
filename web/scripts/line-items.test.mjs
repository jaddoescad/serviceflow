import test from "node:test";
import assert from "node:assert/strict";
import {
  chosenPackageId,
  depositCents,
  documentTotals,
  lineItemTotals,
  packageCents,
  reviveLineItems,
  revivePackages,
  syncPackageItems,
} from "../.test-dist/line-items/line-items.js";

const item = (overrides) => ({
  id: "x",
  name: "Item",
  description: "",
  quantity: 1,
  unitPriceCents: 0,
  optional: false,
  selected: true,
  ...overrides,
});

test("totals match the database: optional items count only when selected", () => {
  const items = [
    item({ unitPriceCents: 150000 }),
    item({ quantity: 2, unitPriceCents: 25050 }),
    item({ unitPriceCents: 40000, optional: true, selected: false }),
  ];
  assert.deepEqual(lineItemTotals(items, 13), { subtotalCents: 200100, taxCents: 26013, totalCents: 226113 });
  items[2].selected = true;
  // Same figures private.line_item_totals returned for this proposal.
  assert.deepEqual(lineItemTotals(items, 13), { subtotalCents: 240100, taxCents: 31213, totalCents: 271313 });
});

test("halves round away from zero like Postgres", () => {
  assert.equal(lineItemTotals([item({ quantity: 0.5, unitPriceCents: 5 })], 0).subtotalCents, 3);
  assert.equal(lineItemTotals([item({ quantity: 0.5, unitPriceCents: -5 })], 0).subtotalCents, -3);
});

test("deposit is a fixed amount or a percent of the total", () => {
  assert.equal(depositCents(257132, { percent: 25, cents: null }), 64283);
  assert.equal(depositCents(257132, { percent: null, cents: 50000 }), 50000);
  assert.equal(depositCents(257132, { percent: null, cents: null }), 0);
});

test("revived items keep optional items unselected unless chosen", () => {
  const [plain, optional] = reviveLineItems([
    { id: "a", name: "Walls", quantity: "2", unitPriceCents: 1000 },
    { id: "b", name: "Trim", unitPriceCents: 500, optional: true },
  ]);
  assert.equal(plain.quantity, 2);
  assert.equal(plain.selected, true);
  assert.equal(optional.selected, false);
});

// The discount and package figures below are the ones supabase/tests/proposal_controls.sql
// checks against private.line_item_totals and the proposal functions.

test("totals match the database: a percent discount comes off before tax", () => {
  const items = [item({ unitPriceCents: 150000 }), item({ quantity: 2, unitPriceCents: 25050 })];
  assert.deepEqual(documentTotals(items, 13, { percent: 10, cents: null }), {
    subtotalCents: 200100,
    discountCents: 20010,
    taxCents: 23412,
    totalCents: 203502,
  });
});

test("totals match the database: a fixed discount, capped at the subtotal", () => {
  const items = [item({ unitPriceCents: 150000 }), item({ quantity: 2, unitPriceCents: 25050 })];
  assert.deepEqual(documentTotals(items, 13, { percent: null, cents: 50000 }), {
    subtotalCents: 200100,
    discountCents: 50000,
    taxCents: 19513,
    totalCents: 169613,
  });
  const capped = documentTotals([item({ unitPriceCents: 1000 })], 13, { percent: null, cents: 5000 });
  assert.equal(capped.discountCents, 1000);
  assert.equal(capped.totalCents, 0);
});

test("no discount gives the same totals as before", () => {
  const items = [item({ unitPriceCents: 150000 }), item({ quantity: 2, unitPriceCents: 25050 })];
  const { discountCents, ...totals } = documentTotals(items, 13);
  assert.equal(discountCents, 0);
  assert.deepEqual(totals, lineItemTotals(items, 13));
});

const packages = [
  { id: "p-good", name: "Good", description: "" },
  { id: "p-better", name: "Better", description: "Most popular" },
];
const packagedItems = () => [
  item({ id: "base", unitPriceCents: 50000 }),
  item({ id: "good", unitPriceCents: 100000, packageId: "p-good" }),
  item({ id: "better", unitPriceCents: 150000, packageId: "p-better" }),
  item({ id: "addon", unitPriceCents: 20000, optional: true, selected: false }),
];

test("only the chosen package counts, like private.clean_proposal_items", () => {
  const items = syncPackageItems(packagedItems(), packages, chosenPackageId(packages, "p-better"));
  const good = items.find((line) => line.id === "good");
  const better = items.find((line) => line.id === "better");
  assert.equal(good.optional, true);
  assert.equal(good.selected, false);
  assert.equal(better.selected, true);
  // Prep + Better, less 10%, plus 13% tax: the saved proposal's amount.
  assert.equal(documentTotals(items, 13, { percent: 10, cents: null }).totalCents, 203400);
});

test("approving another package and an add-on recalculates like private.accept_proposal", () => {
  const items = syncPackageItems(packagedItems(), packages, "p-good").map((line) =>
    line.id === "addon" ? { ...line, selected: true } : line,
  );
  assert.equal(documentTotals(items, 13, { percent: 10, cents: null }).totalCents, 172890);
  assert.equal(packageCents(items, "p-better"), 150000);
});

test("a missing package falls back to the first; a removed package's lines become regular lines", () => {
  assert.equal(chosenPackageId(packages, "p-missing"), "p-good");
  assert.equal(chosenPackageId([], "p-good"), null);
  const items = syncPackageItems(packagedItems(), [packages[0]], "p-good");
  const better = items.find((line) => line.id === "better");
  assert.equal(better.packageId, undefined);
  assert.equal(better.optional, false);
  assert.equal(better.selected, true);
});

test("revived lines keep their package; packages need an id", () => {
  const [line] = reviveLineItems([{ id: "a", name: "Walls", optional: true, selected: true, packageId: "p-good" }]);
  assert.equal(line.packageId, "p-good");
  assert.equal(line.selected, true);
  assert.deepEqual(revivePackages([{ id: "p", name: "Best" }, { name: "No id" }, null]), [
    { id: "p", name: "Best", description: "" },
  ]);
});
