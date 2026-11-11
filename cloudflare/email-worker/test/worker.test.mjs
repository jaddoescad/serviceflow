import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const payload = { to: "recipient@example.com", subject: "Estimate", text: "Hello", html: "<p>Hello</p>", companyName: "Test company", replyTo: "office@example.com", headers: { "In-Reply-To": "<thread@example.com>" }, attachments: [{ filename: "test.txt", type: "text/plain", disposition: "attachment", content: "aGk=" }] };
const request = (body = payload, token = "secret") => new Request("https://relay.example/send", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const env = (send) => ({ EMAIL_RELAY_SECRET: "secret", EMAIL_FROM: "notifications@serviceflowapp.com", EMAIL: { send } });

test("unauthenticated requests cannot send", async () => {
  const response = await worker.fetch(request(payload, "wrong"), env(() => assert.fail("must not send")));
  assert.equal(response.status, 401);
});
test("missing configuration fails closed", async () => {
  assert.equal((await worker.fetch(request(), {})).status, 503);
});
test("relay fixes sender and preserves replies, threading, and attachments", async () => {
  let sent;
  const response = await worker.fetch(request({ ...payload, from: "spoof@example.com", bcc: "hidden@example.com" }), env(async message => { sent = message; return { messageId: "<cloudflare-id>" }; }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "<cloudflare-id>" });
  assert.deepEqual(sent.from, { email: "notifications@serviceflowapp.com", name: "Test company" });
  assert.equal(sent.bcc, undefined);
  assert.equal(sent.replyTo, payload.replyTo);
  assert.deepEqual(sent.headers, payload.headers);
  assert.deepEqual(sent.attachments, payload.attachments);
});
test("Cloudflare rejection is never reported as sent", async () => {
  const response = await worker.fetch(request(), env(async () => { throw new Error("Sender not verified"); }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Sender not verified" });
});
test("missing provider acknowledgement fails", async () => {
  assert.equal((await worker.fetch(request(), env(async () => ({})))).status, 502);
});
test("invalid payload cannot send", async () => {
  assert.equal((await worker.fetch(request({}), env(() => assert.fail("must not send")))).status, 400);
});
