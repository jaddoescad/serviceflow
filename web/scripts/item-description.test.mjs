import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanItemDescription,
  cleanItemDescriptions,
  isRichDescription,
  itemDescriptionHtml,
  itemDescriptionPlain,
  plainDescriptionToRich,
} from "../.test-dist/item-description/item-description.js";

test("imported plain text becomes headings and lists", () => {
  const text =
    "Areas of Application:\n\nWalls\n\nExclusions:\n\nClosets (not included in standard package; can\nbe quoted separately)\n\nMajor wall repairs";
  assert.equal(
    plainDescriptionToRich(text),
    "<h3>Areas of Application</h3><ul><li>Walls</li></ul><h3>Exclusions</h3><ul><li>Closets (not included in standard package; can be quoted separately)</li><li>Major wall repairs</li></ul>",
  );
});

test("plain paragraphs and dash lines", () => {
  assert.equal(plainDescriptionToRich("Two coats\n\n- walls\n- trim\n\nGate code 1 < 2"), "<p>Two coats</p><ul><li>walls</li><li>trim</li></ul><p>Gate code 1 &lt; 2</p>");
  assert.equal(itemDescriptionHtml("   "), "");
});

test("rich text keeps only what a description may hold", () => {
  const dirty =
    '<div style="color:red">Hi <b>there</b> <i>you</i><script>alert(1)</script></div><h1>Big</h1><ul><li>One<img src="x"></li></ul><p><a href="javascript:alert(1)">bad</a> <a href="https://example.com" onclick="x()">good</a></p><table><tr><td>cell</td></tr></table>';
  assert.equal(
    cleanItemDescription(dirty),
    '<p>Hi <strong>there</strong> <em>you</em></p><h3>Big</h3><ul><li>One</li></ul><p><a>bad</a> <a href="https://example.com" target="_blank" rel="noopener noreferrer">good</a></p>cell',
  );
});

test("an emptied editor saves nothing", () => {
  assert.equal(cleanItemDescription("<p><br></p>"), "");
  assert.equal(cleanItemDescription("<ul><li><br></li></ul><p>&nbsp;</p>"), "");
});

test("stored either way, shown the same way", () => {
  assert.equal(isRichDescription("<p>Hello</p>"), true);
  assert.equal(isRichDescription("Hello <b>world</b>"), false);
  assert.equal(itemDescriptionHtml("<p>Hello</p>"), "<p>Hello</p>");
  assert.equal(itemDescriptionHtml("a < b"), "<p>a &lt; b</p>");
  assert.equal(itemDescriptionPlain("<h3>Scope</h3><ul><li>Walls</li><li>Trim</li></ul>"), "Scope Walls Trim");
});

test("saving cleans rich descriptions and leaves plain ones alone", () => {
  const items = cleanItemDescriptions([
    { id: "a", description: '<p onclick="x()">Hi</p>' },
    { id: "b", description: "Plain: text" },
  ]);
  assert.deepEqual(items, [
    { id: "a", description: "<p>Hi</p>" },
    { id: "b", description: "Plain: text" },
  ]);
});
