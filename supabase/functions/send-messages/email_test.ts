import { assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderHtml, sendEmail, type EmailMessage } from "./email.ts";

const message: EmailMessage = { id: "01234567-89ab-cdef-0123-456789abcdef", to: "customer@example.com", companyName: "Test & company", replyTo: "office@example.com", inReplyTo: "<thread@example.com>", attachments: [] };
const unsubscribe = "https://serviceflow-admin.vercel.app/u/test";

async function withRelay(fn: () => Promise<void>, mock: typeof fetch) {
  const originalFetch = globalThis.fetch;
  const keys = ["CLOUDFLARE_EMAIL_URL", "CLOUDFLARE_EMAIL_SECRET", "INBOUND_EMAIL_DOMAIN"];
  const saved = keys.map(key => Deno.env.get(key));
  Deno.env.set(keys[0], "https://relay.example/send");
  Deno.env.set(keys[1], "secret");
  Deno.env.delete(keys[2]);
  globalThis.fetch = mock;
  try { await fn(); } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => saved[index] === undefined ? Deno.env.delete(key) : Deno.env.set(key, saved[index]!));
  }
}

Deno.test("Cloudflare receives formatted email, reply address, threading and opt-out", async () => {
  await withRelay(async () => {
    assertEquals(await sendEmail(message, "Estimate", "Hello <Jane>\nThanks", unsubscribe, true), { status: "sent", providerId: "cf-1" });
  }, async (url, init) => {
    assertEquals(url, "https://relay.example/send");
    assertEquals(new Headers((init as { headers?: HeadersInit })?.headers).get("Authorization"), "Bearer secret");
    const body = JSON.parse(String((init as { body?: unknown })?.body));
    assertEquals(body.companyName, message.companyName);
    assertEquals(body.replyTo, message.replyTo);
    assertEquals(body.headers["In-Reply-To"], message.inReplyTo);
    assertEquals(body.headers["List-Unsubscribe"], `<${unsubscribe}>`);
    assertStringIncludes(body.html, "Hello &lt;Jane&gt;<br>Thanks");
    assertStringIncludes(body.text, `Unsubscribe: ${unsubscribe}`);
    return Response.json({ id: "cf-1" });
  });
});
Deno.test("manual email keeps reply token and has no footer", async () => {
  await withRelay(async () => {
    Deno.env.set("INBOUND_EMAIL_DOMAIN", "in.example.com");
    await sendEmail(message, "", "Hello", unsubscribe, false);
  }, async (_url, init) => {
    const body = JSON.parse(String((init as { body?: unknown })?.body));
    assertEquals(body.replyTo, "reply+0123456789abcdef0123456789abcdef@in.example.com");
    assertEquals(body.text, "Hello");
    assertEquals(body.subject, message.companyName);
    return Response.json({ id: "cf-2" });
  });
});
Deno.test("photo attachments are downloaded and encoded before sending", async () => {
  await withRelay(async () => {
    await sendEmail({ ...message, attachments: [{ url: "https://files.example/test.txt", name: "test.txt", contentType: "text/plain" }] }, "Test", "Hello", unsubscribe, false);
  }, async (url, init) => {
    if (String(url).startsWith("https://files.example")) return new Response("hello");
    assertEquals(JSON.parse(String((init as { body?: unknown })?.body)).attachments, [{ content: "aGVsbG8=", filename: "test.txt", type: "text/plain", disposition: "attachment" }]);
    return Response.json({ id: "cf-3" });
  });
});
Deno.test("unavailable attachments stop the email", async () => {
  await withRelay(async () => {
    await assertRejects(() => sendEmail({ ...message, attachments: [{ url: "https://files.example/missing", name: null, contentType: null }] }, "Test", "Hello", unsubscribe, false), Error, "Could not load email attachment");
  }, async () => new Response("Missing", { status: 404 }));
});
Deno.test("missing setup skips without a network call", async () => {
  await withRelay(async () => {
    Deno.env.delete("CLOUDFLARE_EMAIL_SECRET");
    assertEquals((await sendEmail(message, "", "Hi", unsubscribe, false)).status, "skipped");
  }, () => { throw new Error("must not fetch"); });
});
Deno.test("provider errors and malformed success cannot mark mail as sent", async () => {
  for (const response of [Response.json({ error: "Sender unverified" }, { status: 502 }), Response.json({})]) {
    await withRelay(async () => {
      assertEquals((await sendEmail(message, "Test", "Hi", unsubscribe, false)).status, "failed");
    }, async () => response);
  }
});
Deno.test("a sent document's link becomes a button under the company name", () => {
  const link = "https://serviceflowapp.com/p/abc123";
  const html = renderHtml("Test & company", `Hi Jane,\n\nYour proposal is ready.\n\n${link}\n\nThanks,\nTest`, null, { url: link, label: "View proposal" });
  assertStringIncludes(html, ">Test &amp; company</td>");
  assertStringIncludes(html, `<a href="${link}" style="display:inline-block`);
  assertStringIncludes(html, ">View proposal</a>");
  assertStringIncludes(html, "<p style=\"margin:0 0 16px\">Thanks,<br>Test</p>");
  assertEquals(html.includes(`>${link}</a>`), false);
  assertEquals(html.includes("Unsubscribe"), false);
  const older = renderHtml("Co", "https://serviceflow-admin.vercel.app/p/abc123", null, { url: link, label: "View proposal" });
  assertStringIncludes(older, `<a href="${link}" style="display:inline-block`);
});
Deno.test("links in a plain message are clickable", () => {
  const html = renderHtml("Co", "See https://example.com/a?b=1&c=2.", null);
  assertStringIncludes(html, `<a href="https://example.com/a?b=1&amp;c=2" style="color:#2563eb">https://example.com/a?b=1&amp;c=2</a>.`);
});
