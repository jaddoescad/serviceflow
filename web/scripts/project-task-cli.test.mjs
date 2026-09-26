import assert from "node:assert/strict";
import test from "node:test";

import {
  findDuplicateTasks,
  parseCliArgs,
  parseTaskSpec,
  selectProject,
  validateTaskBatch,
} from "./project-task-cli.mjs";

test("parseCliArgs collects repeated task specs", () => {
  const args = parseCliArgs([
    "add-batch",
    "--project",
    "Elaine Keveney",
    "--task",
    "Entranceway - walls and trim|6.46",
    "--task=Kitchen - walls and trim|4.47",
    "--yes",
  ]);
  assert.equal(args.command, "add-batch");
  assert.equal(args.project, "Elaine Keveney");
  assert.deepEqual(args.taskSpecs, [
    "Entranceway - walls and trim|6.46",
    "Kitchen - walls and trim|4.47",
  ]);
  assert.equal(args.yes, true);
});

test("parseTaskSpec validates and rounds hours", () => {
  assert.deepEqual(parseTaskSpec("Dining room - walls and trim|4.974|Prep minor imperfections"), {
    title: "Dining room - walls and trim",
    budgetedHours: 4.97,
    notes: "Prep minor imperfections",
  });
  assert.throws(() => parseTaskSpec("Kitchen|nope"), /hours must be zero or greater/);
  assert.throws(() => parseTaskSpec("|2"), /title is required/);
});

test("selectProject prefers one exact normalized name", () => {
  const projects = [
    {
      companycam_id: "1",
      name: "Elaine Keveney",
      formatted_address: "1 Main Street",
      is_deleted: false,
    },
    {
      companycam_id: "2",
      name: "Elaine Keveney - old",
      formatted_address: "2 Main Street",
      is_deleted: false,
    },
  ];
  assert.equal(selectProject(projects, " elaine  keveney ").companycam_id, "1");
  assert.equal(selectProject(projects, null, "2").companycam_id, "2");
});

test("selectProject rejects ambiguous partial matches", () => {
  const projects = [
    { companycam_id: "1", name: "Elaine A", formatted_address: null, is_deleted: false },
    { companycam_id: "2", name: "Elaine B", formatted_address: null, is_deleted: false },
  ];
  assert.throws(() => selectProject(projects, "Elaine"), /More than one project matched/);
});

test("selectProject tolerates one customer-name typo when the match is unique", () => {
  const projects = [
    {
      companycam_id: "104132430",
      name: "Elaine Keverney",
      formatted_address: "474 Stalwart Crescent",
      is_deleted: false,
    },
    {
      companycam_id: "2",
      name: "Someone Else",
      formatted_address: "2 Main Street",
      is_deleted: false,
    },
  ];
  assert.equal(selectProject(projects, "Elaine Keveney").companycam_id, "104132430");
});

test("validateTaskBatch rejects duplicate titles", () => {
  assert.throws(
    () =>
      validateTaskBatch([
        { title: "Living room", budgetedHours: 1 },
        { title: " living   room ", budgetedHours: 2 },
      ]),
    /Duplicate task title/,
  );
});

test("findDuplicateTasks compares active titles only", () => {
  const duplicates = findDuplicateTasks(
    [
      { title: "Kitchen - walls and trim", is_active: true },
      { title: "Living room - walls and trim", is_active: false },
    ],
    [
      { title: " kitchen - WALLS and trim ", budgetedHours: 4.47 },
      { title: "Living room - walls and trim", budgetedHours: 7.45 },
    ],
  );
  assert.deepEqual(duplicates.map((task) => task.title), [" kitchen - WALLS and trim "]);
});
