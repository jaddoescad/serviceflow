import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeRichText } from "../.test-dist/rich-text/rich-text.js";

const project = "11111111-1111-1111-1111-111111111111";
const doc = "22222222-2222-2222-2222-222222222222";
const image = "33333333-3333-3333-3333-333333333333";

test("keeps editor formatting", () => {
  const html =
    '<h1 style="text-align: center">Household</h1><p><strong>Bold</strong> <em>i</em> <u>u</u> <span style="color: rgb(211, 69, 62)">red</span></p>' +
    '<ul data-checklist="true"><li data-checked="true">Done</li><li data-checked="false">Todo</li></ul><ol><li>One</li></ol>' +
    '<table><tbody><tr><td colspan="2">Cell</td></tr></tbody></table><hr><hr data-page-break="true"><p><br></p>';
  assert.equal(sanitizeRichText(html), html);
});

test("keeps the inline styles Chrome writes for bold, italic and underline", () => {
  const html =
    '<span style="font-weight: bold; color: rgb(211, 69, 62)">b</span><span style="font-style: italic">i</span><span style="text-decoration-line: underline">u</span>';
  assert.equal(sanitizeRichText(html), html);
  assert.equal(sanitizeRichText('<span style="font-weight: expression(x)">x</span>'), "<span>x</span>");
});

test("strips scripts, handlers and unsafe URLs", () => {
  assert.equal(sanitizeRichText('<p onclick="x()">Hi<script>alert(1)</script></p>'), "<p>Hi</p>");
  assert.equal(sanitizeRichText('<img src=x onerror=alert(1)>'), "");
  assert.equal(sanitizeRichText('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeRichText('<a href="jav&#x09;ascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeRichText('<a href=" JaVaScRiPt:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeRichText('<svg><script>alert(1)</script></svg>ok'), "ok");
  assert.equal(sanitizeRichText('<iframe src="https://x"></iframe><style>*{}</style>ok'), "ok");
  assert.equal(sanitizeRichText('<p style="background:url(javascript:x);color:red">x</p>'), "<p>x</p>");
  assert.equal(sanitizeRichText('<p style="color: #d3453e; position: fixed">x</p>'), '<p style="color: #d3453e">x</p>');
  assert.equal(sanitizeRichText('<!-- <img src=x onerror=alert(1)> -->ok'), "ok");
  assert.equal(sanitizeRichText('1 < 2 > 0'), "1 &lt; 2 &gt; 0");
  assert.equal(sanitizeRichText('<div><form><input value=1></form>a</div>'), "<div>a</div>");
  assert.equal(sanitizeRichText('<p title="a"onmouseover="x">t</p>'), "<p>t</p>");
  assert.equal(sanitizeRichText('<scr<script>ipt>alert(1)</script>'), "ipt&gt;alert(1)");
});

test("links open safely and images must be page images", () => {
  assert.equal(
    sanitizeRichText('<a href="https://example.com/?a=1&amp;b=2">x</a>'),
    '<a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">x</a>',
  );
  const src = `/api/jobs/${project}/documents/${doc}/images/${image}`;
  assert.equal(sanitizeRichText(`<img src="${src}" alt="Wall">`), `<img src="${src}" alt="Wall">`);
  assert.equal(sanitizeRichText('<img src="https://evil.example/x.png">'), "");
});
