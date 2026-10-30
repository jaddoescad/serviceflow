import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseQuoCall, parseQuoEvent, verifyQuoSignature } from "./quo.ts";

const received = {
  id: "EV1",
  object: "event",
  createdAt: "2026-10-24T12:00:00.000Z",
  type: "message.received",
  data: {
    object: {
      id: "AC1",
      object: "message",
      from: "+16135550101",
      to: ["+16135550000"],
      direction: "incoming",
      body: "Is Tuesday ok?",
      media: [{ url: "https://example.com/photo.jpg", type: "image/jpeg" }],
      createdAt: "2026-10-24T11:59:58.000Z",
    },
  },
};

Deno.test("a received text becomes an inbound message with its photo", () => {
  assertEquals(parseQuoEvent(received), {
    channel: "sms",
    direction: "inbound",
    from: "+16135550101",
    to: "+16135550000",
    body: "Is Tuesday ok?",
    providerId: "AC1",
    receivedAt: "2026-10-24T11:59:58.000Z",
    attachments: [{ url: "https://example.com/photo.jpg", contentType: "image/jpeg", name: null }],
  });
});

Deno.test("a delivery report is an outbound message", () => {
  const delivered = { ...received, type: "message.delivered", data: { object: { ...received.data.object, direction: "outgoing", text: "Hi", body: undefined } } };
  const message = parseQuoEvent(delivered);
  assertEquals(message?.direction, "outbound");
  assertEquals(message?.body, "Hi");
});

Deno.test("calls and unknown events aren't messages", () => {
  assertEquals(parseQuoEvent({ type: "call.completed", data: { object: { object: "call" } } }), null);
  assertEquals(parseQuoEvent(null), null);
});

Deno.test("a missed call with a voicemail", () => {
  assertEquals(
    parseQuoCall({
      type: "call.completed",
      createdAt: "2026-10-24T12:01:00.000Z",
      data: {
        object: {
          id: "AC9",
          object: "call",
          direction: "incoming",
          from: "+16135550101",
          to: "+16135550000",
          status: "no-answer",
          answeredAt: null,
          completedAt: "2026-10-24T12:00:40.000Z",
          voicemail: { url: "https://example.com/vm.mp3", type: "audio/mpeg", duration: 12 },
          createdAt: "2026-10-24T12:00:00.000Z",
        },
      },
    }),
    {
      id: "AC9",
      direction: "incoming",
      from: "+16135550101",
      to: "+16135550000",
      status: "no-answer",
      createdAt: "2026-10-24T12:00:00.000Z",
      answered: false,
      voicemail: { duration: 12 },
    },
  );
});

Deno.test("an answered call's length comes from when it was answered and ended", () => {
  const call = parseQuoCall({
    type: "call.completed",
    data: {
      object: {
        id: "AC8",
        direction: "outgoing",
        from: "+16135550000",
        to: "+16135550101",
        status: "completed",
        answeredAt: "2026-10-24T12:00:05.000Z",
        completedAt: "2026-10-24T12:04:05.000Z",
        createdAt: "2026-10-24T12:00:00.000Z",
      },
    },
  });
  assertEquals(call?.answered, true);
  assertEquals(call?.duration, 240);
  assertEquals(parseQuoCall({ type: "call.recording.completed", data: { object: { id: "AC8", direction: "outgoing" } } })?.recorded, true);
  assertEquals(parseQuoCall({ type: "message.received", data: { object: { id: "AC1" } } }), null);
});

Deno.test("newer webhooks carry the message at data.resource and the numbers in data.context", () => {
  const message = parseQuoEvent({
    type: "message.received",
    data: {
      resource: { id: "AC2", direction: "incoming", text: "hello", media: [], status: "received", createdAt: "2026-10-24T12:00:00.000Z" },
      context: { phoneNumberId: "PN1", senderIdentifier: "+15550001111", recipientIdentifiers: ["+15550002222"] },
    },
  });
  assertEquals(message, {
    channel: "sms",
    direction: "inbound",
    from: "+15550001111",
    to: "+15550002222",
    body: "hello",
    providerId: "AC2",
    receivedAt: "2026-10-24T12:00:00.000Z",
    attachments: [],
  });
});

async function hmac(content: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("signing-key"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content)))));
}

Deno.test("legacy signatures are checked against the base64 key", async () => {
  const secret = btoa("signing-key");
  const raw = JSON.stringify(received);
  const digest = await hmac(`1700000000000.${raw}`);
  const signed = (header: string) => new Headers({ "openphone-signature": header });
  assert(await verifyQuoSignature(raw, signed(`hmac;1;1700000000000;${digest}`), secret));
  assert(await verifyQuoSignature(JSON.stringify(received, null, 2), signed(`hmac;1;1700000000000;${digest}`), secret));
  assert(!(await verifyQuoSignature(raw, signed(`hmac;1;1700000000001;${digest}`), secret)));
  assert(!(await verifyQuoSignature(raw, new Headers(), secret)));
});

Deno.test("newer signatures cover the delivery id and a recent timestamp", async () => {
  const secret = `whsec_${btoa("signing-key")}`;
  const raw = JSON.stringify(received);
  const now = String(Math.floor(Date.now() / 1000));
  const digest = await hmac(`msg_1.${now}.${raw}`);
  const signed = (timestamp: string, signature: string) =>
    new Headers({ "webhook-id": "msg_1", "webhook-timestamp": timestamp, "webhook-signature": signature });
  assert(await verifyQuoSignature(raw, signed(now, `v1,${digest}`), secret));
  assert(await verifyQuoSignature(raw, signed(now, `v1,bm9wZQ== v1,${digest}`), secret));
  assert(!(await verifyQuoSignature(raw, signed(now, `v1,${await hmac(`msg_2.${now}.${raw}`)}`), secret)));
  const old = String(Number(now) - 3600);
  assert(!(await verifyQuoSignature(raw, signed(old, `v1,${await hmac(`msg_1.${old}.${raw}`)}`), secret)));
});
