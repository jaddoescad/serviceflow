import test from "node:test";
import assert from "node:assert/strict";
import { descriptionLines } from "../.test-dist/description-markdown/description-markdown.js";

const run = (text, style = {}) => ({ text, bold: false, italic: false, link: null, ...style });

test("plain descriptions read as written, dash lines as bullets", () => {
  const lines = descriptionLines("Two coats in the kitchen\n- walls\n\nGate code 1234");
  assert.deepEqual(lines.map((line) => line.kind), ["text", "bullet", "text", "text"]);
  assert.deepEqual(lines[0].runs, [run("Two coats in the kitchen")]);
  assert.deepEqual(lines[2].runs, []);
});

test("reads what the crew apps write", () => {
  // The same text ServiceFlowCore's RichText checks write.
  const lines = descriptionLines(
    [
      "Paint **all** rooms **_except_ the den**",
      "1. See [colours](https://example.com/a(1%29)",
      "2. _Call [Kim](tel:6135550101)_",
      "- 2\\*3 = 6\\_ \\[maybe\\] \\\\ ok",
      "\\- not a list",
      "\\1. not numbered either",
    ].join("\n"),
  );
  assert.deepEqual(lines[0].runs, [
    run("Paint "),
    run("all", { bold: true }),
    run(" rooms "),
    run("except", { bold: true, italic: true }),
    run(" the den", { bold: true }),
  ]);
  assert.equal(lines[1].kind, "numbered");
  assert.equal(lines[1].number, 1);
  assert.deepEqual(lines[1].runs, [run("See "), run("colours", { link: "https://example.com/a(1%29" })]);
  assert.deepEqual(lines[2].runs, [run("Call ", { italic: true }), run("Kim", { italic: true, link: "tel:6135550101" })]);
  assert.deepEqual(lines[3].runs, [run("2*3 = 6_ [maybe] \\ ok")]);
  assert.deepEqual(lines.slice(4).map((line) => [line.kind, line.runs]), [
    ["text", [run("- not a list")]],
    ["text", [run("1. not numbered either")]],
  ]);
});

test("unclosed markers and unsafe links stay text", () => {
  assert.deepEqual(descriptionLines("**bold ** and [x](javascript:alert(1))")[0].runs, [run("**bold ** and [x](javascript:alert(1))")]);
});
