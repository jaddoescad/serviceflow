import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceRequest, fetchSource } from "./lib/ottawa-read-sources.mjs";

test("Quo messages are GET-only, bounded, and use required filters", () => {
  const request = buildSourceRequest(
    ["quo", "messages", "--phone-number-id", "PN3Uvs2ITi", "--participant", "+16135551234", "--limit", "100"],
    { QUO_API_KEY: "secret" },
  );
  assert.equal(request.url.origin, "https://api.quo.com");
  assert.equal(request.url.pathname, "/v1/messages");
  assert.equal(request.url.searchParams.get("phoneNumberId"), "PN3Uvs2ITi");
  assert.deepEqual(request.url.searchParams.getAll("participants"), ["+16135551234"]);
  assert.equal(request.url.searchParams.get("maxResults"), "100");
});

test("CompanyCam photo requests are restricted to the project photo endpoint", () => {
  const request = buildSourceRequest(["companycam", "photos", "987", "--limit", "25"], { COMPANYCAM_API_KEY: "secret" });
  assert.equal(request.url.href, "https://api.companycam.com/v2/projects/987/photos?per_page=25");
  assert.equal(request.headers.Authorization, "Bearer secret");
});

test("source credentials and required conversation filters fail closed", () => {
  assert.throws(() => buildSourceRequest(["quo", "phone-numbers"], {}), /QUO_API_KEY is required/);
  assert.throws(() => buildSourceRequest(["quo", "messages", "--phone-number-id", "PN3Uvs2ITi"], { QUO_API_KEY: "x" }), /participant/);
  assert.throws(
    () => buildSourceRequest(["quo", "messages", "--phone-number-id", "PN4MVRByub", "--participant", "+16135551234"], { QUO_API_KEY: "x" }),
    /restricted to the Sales and Production/,
  );
  assert.throws(() => buildSourceRequest(["companycam", "photos", "1", "--limit", "101"], { COMPANYCAM_API_KEY: "x" }), /between 1 and 100/);
});

test("Quo phone-number discovery returns only Sales and Production", async () => {
  const request = buildSourceRequest(["quo", "phone-numbers"], { QUO_API_KEY: "secret" });
  const result = await fetchSource(request, async () => new Response(JSON.stringify({
    data: [
      { id: "PN4MVRByub", name: "New number" },
      { id: "PNHtOrvjNR", name: "Production" },
      { id: "PNM4XhFsCB", name: "Do not use-Out of commission" },
      { id: "PN3Uvs2ITi", name: "Sales" },
    ],
  }), { status: 200 }));
  assert.deepEqual(result.data.data.map(({ name }) => name).sort(), ["Production", "Sales"]);
});

test("fetchSource always sends GET and does not surface headers", async () => {
  let received;
  const result = await fetchSource(
    { source: "quo", url: new URL("https://api.quo.com/v1/phone-numbers"), headers: { Authorization: "secret" } },
    async (url, init) => {
      received = { url, init };
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  );
  assert.equal(received.init.method, "GET");
  assert.equal(result.data.data.length, 0);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
